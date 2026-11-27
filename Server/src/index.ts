// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import type { Constructable } from '@zetra/citrineos-base';
import {
  EventGroup,
  eventGroupFromString,
  type ICache,
  type IModule,
  type IModuleApi,
} from '@zetra/citrineos-base';
import { MemoryCache, RedisCache } from '@zetra/citrineos-util';
import type { IDtoModule, OcpiConfig } from '@citrineos/ocpi-base';
import {
  Container,
  getDtoEventHandlerMetaData,
  getOcpiSystemConfig,
  OcpiModule,
  OcpiServer,
  ServiceReadiness,
} from '@citrineos/ocpi-base';
import { CommandsModule } from '@citrineos/ocpi-commands';
import { VersionsModule } from '@citrineos/ocpi-versions';
import { CredentialsModule } from '@citrineos/ocpi-credentials';
import { LocationsModule } from '@citrineos/ocpi-locations';
import { SessionsModule } from '@citrineos/ocpi-sessions';
import { ChargingProfilesModule } from '@citrineos/ocpi-charging-profiles';
import { TariffsModule } from '@citrineos/ocpi-tariffs';
import { CdrsModule } from '@citrineos/ocpi-cdrs';
import { TokensModule } from '@citrineos/ocpi-tokens';
import { DtoRouter } from '@citrineos/dto-router';
import { createLocalOcpiConfig } from './config/envs/local.js';
import { createDockerOcpiConfig } from './config/envs/docker.js';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import { AdminModule } from '@citrineos/ocpi-admin';

/**
 * Upper bound for a graceful shutdown. Keep below the pod's terminationGracePeriodSeconds minus
 * its preStop delay.
 */
const SHUTDOWN_TIMEOUT_MS = 25_000;

export class CitrineOSServer {
  /**
   * Fields
   */
  private readonly modules: IModule[] = [];
  private readonly apis: IModuleApi[] = [];
  private ocpiConfig?: OcpiConfig;
  private _logger?: Logger<ILogObj>;
  private _cache?: ICache;
  private host?: string;
  private port?: number;
  private eventGroup?: EventGroup;
  private ocpiServer?: OcpiServer;
  private dtoRouter?: DtoRouter;
  private shuttingDown = false;

  /**
   * Constructor for the class.
   *
   * @param {EventGroup} appName - app type
   * @param {OcpiConfig} config - config
   * @param {FastifyInstance} server - optional Fastify server instance
   * @param {ICache} cache - cache
   */
  // todo rename event group to type
  constructor(appName: string) {
    // Set event group
    this.eventGroup = eventGroupFromString(appName);

    for (const signal of ['SIGINT', 'SIGTERM', 'SIGQUIT'] as const) {
      process.on(signal, () => void this.shutdown(signal));
    }
  }

  async initialize(): Promise<void> {
    // Initialize parent logger
    this.initLogger();

    // init cache
    this.initCache();
  }

  async shutdown(signal?: string) {
    if (this.shuttingDown) {
      return;
    }
    this.shuttingDown = true;
    this._logger?.info(`Shutting down${signal ? ` on ${signal}` : ''}...`);
    const forceExit = setTimeout(() => {
      console.error('Graceful shutdown timed out, exiting.');
      process.exit(1);
    }, SHUTDOWN_TIMEOUT_MS);
    forceExit.unref();

    try {
      Container.get(ServiceReadiness).markNotReady();
      // Stops LISTEN, stops the modules' consumers and releases the event-processing lock, so
      // that another instance takes over right away.
      await this.dtoRouter?.shutdown();
      for (const module of this.modules) {
        await module.shutdown();
      }
      for (const module of this.ocpiServer?.modules ?? []) {
        await (module as Partial<IDtoModule>).shutdown?.();
      }
      await this.ocpiServer?.close();
    } catch (error) {
      this._logger?.error('Error during shutdown', error);
    }
    console.log('Exiting...');
    process.exit(0);
  }

  async initConfig() {
    switch (process.env.APP_ENV) {
      case 'docker':
        this.ocpiConfig = getOcpiSystemConfig(createDockerOcpiConfig());
        break;
      default:
        this.ocpiConfig = getOcpiSystemConfig(createLocalOcpiConfig());
    }
  }

  async run(): Promise<void> {
    try {
      await this.initConfig();
      await this.initialize();
      await this.startOcpiServer();
    } catch (error) {
      await Promise.reject(error);
    }
  }

  protected getOcpiModuleConfig(): Constructable<OcpiModule | IDtoModule>[] {
    return [
      VersionsModule,
      CredentialsModule,
      CommandsModule,
      LocationsModule,
      SessionsModule,
      ChargingProfilesModule,
      TariffsModule,
      CdrsModule,
      TokensModule,
      AdminModule,
    ];
  }

  private initLogger() {
    this._logger = new Logger<ILogObj>({
      name: 'CitrineOS Logger',
      minLevel: this.ocpiConfig!.logLevel,
      hideLogPositionForProduction: this.ocpiConfig!.env === 'production',
      // Disable colors for cloud deployment as some cloud logging environments such as cloudwatch can not interpret colors
      stylePrettyLogs: process.env.DEPLOYMENT_TARGET !== 'cloud',
    });
  }

  private initCache() {
    this._cache = this.ocpiConfig!.cache.redis
      ? new RedisCache({
          socket: {
            host: this.ocpiConfig!.cache.redis.host,
            port: this.ocpiConfig!.cache.redis.port,
          },
        })
      : new MemoryCache();
  }

  private async startOcpiServer() {
    this.ocpiServer = new OcpiServer(
      this.ocpiConfig!,
      this._cache!,
      this._logger!,
      this.getOcpiModuleConfig(),
    );
    // With leader election, the modules' event handlers start only on the elected instance.
    const leaderElection =
      this.ocpiConfig!.events?.leaderElection?.enabled ?? true;
    await this.ocpiServer.initialize({ deferEventHandlers: leaderElection });
    await this.initDtoRouter(this.ocpiServer);
    Container.get(ServiceReadiness).markReady(
      () => this.dtoRouter?.isLeader() ?? false,
    );
  }

  private async initDtoRouter(ocpiServer: OcpiServer) {
    const dtoRouter: DtoRouter = Container.get(DtoRouter);
    this.dtoRouter = dtoRouter;
    await dtoRouter.init();
    for (const module of ocpiServer.modules) {
      const eventHandlers = getDtoEventHandlerMetaData(module);
      for (const eventHandler of eventHandlers) {
        const subscribed = await dtoRouter.subscribe(
          eventHandler.eventId,
          eventHandler.eventType,
          eventHandler.objectType,
        );
        this._logger?.info(
          `Subscribed successfully (${subscribed}) to event: ${eventHandler.eventId} of type: ${eventHandler.eventType} for object: ${eventHandler.objectType}`,
        );
      }
    }
    dtoRouter.addLeadershipListener({
      onAcquired: async () => {
        this._logger?.info('This instance now processes events');
        await ocpiServer.startEventProcessing();
      },
      onLost: async () => {
        this._logger?.warn('This instance no longer processes events');
        await ocpiServer.stopEventProcessing();
      },
    });
    dtoRouter.startLeaderElection();
  }
}

new CitrineOSServer(process.env.APP_NAME as EventGroup)
  .run()
  .catch((error: any) => {
    console.error(error);
    process.exit(1);
  });
