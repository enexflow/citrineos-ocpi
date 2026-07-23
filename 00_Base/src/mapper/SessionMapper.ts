// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { Service } from 'typedi';
import type { Session } from '../model/Session.js';
import type {
  MeterValueDto,
  TariffDto,
  TransactionDto,
  TransactionEventDto,
} from '@zetra/citrineos-base';
import { OCPP2_0_1 } from '@zetra/citrineos-base';
import { AuthMethod } from '../model/AuthMethod.js';
import type { ChargingPeriod } from '../model/ChargingPeriod.js';
import { ChargingPeriodsMode } from '../model/ChargingPeriod.js';
import { CdrDimensionType } from '../model/CdrDimensionType.js';
import type { CdrToken } from '../model/CdrToken.js';
import { SessionStatus } from '../model/SessionStatus.js';
import type { ILogObj } from 'tslog';
import { Logger } from 'tslog';
import type { CdrDimension } from '../model/CdrDimension.js';
import type { TokenDTO } from '../model/DTO/TokenDTO.js';
import { BaseTransactionMapper } from './BaseTransactionMapper.js';
import { LocationsService } from '../services/LocationsService.js';
import type { LocationDTO } from '../model/DTO/LocationDTO.js';
import { UID_FORMAT } from '../model/DTO/EvseDTO.js';
import { OcpiGraphqlClient } from '../graphql/index.js';
import { ChargingStateEnum } from '@zetra/citrineos-base';

@Service()
export class SessionMapper extends BaseTransactionMapper {
  constructor(
    protected logger: Logger<ILogObj>,
    protected locationsService: LocationsService,
    protected ocpiGraphqlClient: OcpiGraphqlClient,
  ) {
    super(logger, locationsService, ocpiGraphqlClient);
  }

  /**
   * Maps a single transaction to a session
   */
  public async mapTransactionToSession(
    transaction: TransactionDto,
    chargingPeriodsMode: ChargingPeriodsMode,
  ): Promise<Session> {
    const [locationMap, tokenMap, tariffMap] =
      await this.getLocationsTokensAndTariffsMapsForTransactions([transaction]);

    const location = locationMap.get(transaction.transactionId!);
    const token = tokenMap.get(transaction.transactionId!);
    const tariff = tariffMap.get(transaction.transactionId!);

    if (!location || !token || !tariff) {
      const missing = [];
      if (!location) missing.push('location');
      if (!token) missing.push('token');
      if (!tariff) missing.push('tariff');

      throw new Error(
        `Cannot map transaction ${transaction.transactionId} to session. Missing: ${missing.join(', ')}`,
      );
    }

    return this.mapTransactionWithContextToSession(
      transaction,
      location,
      token,
      tariff,
      chargingPeriodsMode,
    );
  }

  /**
   * Maps a partial transaction to a partial session
   */
  public async mapPartialTransactionToPartialSession(
    transaction: Partial<TransactionDto>,
  ): Promise<Partial<Session>> {
    // If we don't have a transaction ID, we can only map basic fields
    const locationResponse = await this.locationsService.getLocationById(
      transaction.locationId!,
    );

    if (!locationResponse.data) {
      throw new Error(
        `Location ${transaction.locationId} not found: ${locationResponse.status_message}`,
      );
    }

    const locationDto: LocationDTO = locationResponse.data;
    if (!transaction.transactionId) {
      return this.mapPartialTransactionWithoutContext(transaction, locationDto);
    }

    try {
      // Try to fetch context data, but handle failures gracefully
      const [locationMap, tokenMap, tariffMap] =
        await this.getLocationsTokensAndTariffsMapsForTransactions([
          transaction as TransactionDto,
        ]);

      const location = locationMap.get(transaction.transactionId);
      const token = tokenMap.get(transaction.transactionId);
      const tariff = tariffMap.get(transaction.transactionId);

      return this.mapPartialTransactionWithContext(
        transaction,
        location,
        token,
        tariff,
      );
    } catch (error) {
      this.logger.warn(
        `Failed to fetch context for partial transaction ${transaction.transactionId}. Mapping without context.`,
        error,
      );
      return this.mapPartialTransactionWithoutContext(transaction, locationDto);
    }
  }

  public async getLocationsTokensAndTariffsMapsForTransactions(
    transactions: TransactionDto[],
  ): Promise<
    [Map<string, LocationDTO>, Map<string, TokenDTO>, Map<string, TariffDto>]
  > {
    return await Promise.all([
      this.getLocationDTOsForTransactions(transactions),
      this.getTokensForTransactions(transactions),
      this.getTariffsForTransactions(transactions),
    ]);
  }

  public async mapTransactionsToSessions(
    transactions: TransactionDto[],
    chargingPeriodsMode: ChargingPeriodsMode = ChargingPeriodsMode.Append,
  ): Promise<Session[]> {
    const [
      transactionIdToLocationMap,
      transactionIdToTokenMap,
      transactionIdToTariffMap,
    ] =
      await this.getLocationsTokensAndTariffsMapsForTransactions(transactions);
    return await this.mapTransactionsToSessionsHelper(
      transactions,
      transactionIdToLocationMap,
      transactionIdToTokenMap,
      transactionIdToTariffMap,
      chargingPeriodsMode,
    );
  }

  public async mapTransactionsToSessionsHelper(
    transactions: TransactionDto[],
    transactionIdToLocationMap: Map<string, LocationDTO>,
    transactionIdToTokenMap: Map<string, TokenDTO>,
    transactionIdToTariffMap: Map<string, TariffDto>,
    chargingPeriodsMode: ChargingPeriodsMode = ChargingPeriodsMode.Append,
  ): Promise<Session[]> {
    const result: Session[] = [];
    for (const transaction of transactions) {
      const location = transactionIdToLocationMap.get(
        transaction.transactionId!,
      );
      const token = transactionIdToTokenMap.get(transaction.transactionId!);
      const tariff = transactionIdToTariffMap.get(transaction.transactionId!);

      if (location && token && tariff) {
        result.push(
          this.mapTransactionWithContextToSession(
            transaction,
            location,
            token,
            tariff,
            chargingPeriodsMode ?? ChargingPeriodsMode.Append,
          ),
        );
      } else {
        this.logger.debug(`Skipped transaction ${transaction.transactionId}`);
      }
    }
    return result;
  }

  public async mapIncrementalSessionPatch(
    transaction: TransactionDto,
  ): Promise<Partial<Session>> {
    const [locationMap, tokenMap, tariffMap] =
      await this.getLocationsTokensAndTariffsMapsForTransactions([transaction]);
    const tariff = tariffMap.get(transaction.transactionId!);
    if (!tariff) {
      throw new Error(
        `Tariff not found for transaction ${transaction.transactionId}`,
      );
    }
    const sorted = [...(transaction.meterValues ?? [])].sort(
      (a, b) =>
        new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
    );
    const periods =
      sorted.length > 1
        ? this.getChargingPeriods(
            { ...transaction, meterValues: sorted.slice(-2) },
            String(tariff.ocpiTariffId),
            ChargingPeriodsMode.Append,
          ).slice(-1)
        : undefined;

    return {
      id: transaction.transactionId,
      end_date_time: transaction.endTime ? new Date(transaction.endTime) : null,
      kwh: transaction.totalKwh || 0,
      status: this.getTransactionStatus(transaction),
      last_updated: transaction.updatedAt,
      total_cost:
        this.calculateTotalCost(transaction.totalKwh || 0, tariff) ?? null,
      ...(periods ? { charging_periods: periods } : {}),
    };
  }

  /**
   * Maps a partial transaction with available context data
   */
  private mapPartialTransactionWithContext(
    transaction: Partial<TransactionDto>,
    location?: LocationDTO,
    token?: TokenDTO,
    tariff?: TariffDto,
    chargingPeriodsMode: ChargingPeriodsMode = ChargingPeriodsMode.Append,
  ): Partial<Session> {
    const session: Partial<Session> = {};

    // Map basic transaction fields
    if (transaction.transactionId !== undefined) {
      session.id = transaction.transactionId;
    }

    if (transaction.startTime !== undefined) {
      session.start_date_time = transaction.startTime
        ? new Date(transaction.startTime)
        : undefined;
    }

    if (transaction.endTime !== undefined) {
      session.end_date_time = transaction.endTime
        ? new Date(transaction.endTime)
        : null;
    }

    if (transaction.totalKwh !== undefined) {
      session.kwh = transaction.totalKwh || 0;
    }

    if (transaction.updatedAt !== undefined) {
      session.last_updated = transaction.updatedAt!;
    }

    // Map context-dependent fields if available
    session.country_code = transaction.tenant!.countryCode!;
    session.party_id = transaction.tenant!.partyId!;

    if (transaction.locationId) {
      session.location_id = transaction.locationId.toString();
    }

    if (token) {
      session.cdr_token = this.createCdrToken(token);
    }

    if (tariff) {
      session.currency = tariff.currency;
      if (
        transaction.totalKwh !== undefined &&
        transaction.endTime !== undefined
      ) {
        session.total_cost = transaction.endTime
          ? this.calculateTotalCost(transaction.totalKwh || 0, tariff)
          : null;
      }
    }

    // Map fields that depend on transaction structure
    if (transaction.evseId && transaction.stationId) {
      session.evse_uid = this.getEvseUid(
        transaction as TransactionDto,
        location as LocationDTO,
      );
    }

    if (transaction.connectorId) {
      session.connector_id = transaction.connectorId.toString();
    }

    // Map meter values if available
    if (transaction.meterValues && tariff && transaction.transactionId) {
      session.charging_periods = this.getChargingPeriods(
        transaction as TransactionDto,
        String(tariff.ocpiTariffId),
        chargingPeriodsMode ?? ChargingPeriodsMode.Append,
      );
    }

    // Map status if we can determine it
    if (transaction.endTime !== undefined) {
      session.status = this.getTransactionStatus(transaction as TransactionDto);
    }

    // Set default auth method
    session.auth_method = this.resolveAuthMethod(transaction);

    // Set optional fields that are typically null in your implementation
    session.authorization_reference =
      transaction.authorization?.ocpiAuthReference ?? null;
    session.meter_id = null;

    return session;
  }

  /**
   * Maps a partial transaction without context data (location, token, tariff)
   */
  private mapPartialTransactionWithoutContext(
    transaction: Partial<TransactionDto>,
    location: LocationDTO,
  ): Partial<Session> {
    const session: Partial<Session> = {};

    if (transaction.transactionId !== undefined) {
      session.id = transaction.transactionId;
    }

    if (transaction.startTime !== undefined) {
      session.start_date_time = transaction.startTime
        ? new Date(transaction.startTime)
        : undefined;
    }

    if (transaction.endTime !== undefined) {
      session.end_date_time = transaction.endTime
        ? new Date(transaction.endTime)
        : null;
    }

    if (transaction.totalKwh !== undefined) {
      session.kwh = transaction.totalKwh || 0;
    }

    if (transaction.updatedAt !== undefined) {
      session.last_updated = transaction.updatedAt!;
    }

    if (transaction.evseId && transaction.stationId) {
      session.evse_uid = this.getEvseUid(
        transaction as TransactionDto,
        location as LocationDTO,
      );
    }

    if (transaction.connectorId) {
      session.connector_id = transaction.connectorId.toString();
    }

    if (transaction.endTime !== undefined) {
      session.status = this.getTransactionStatus(transaction as TransactionDto);
    }

    // Set defaults for fields that don't depend on external context
    session.auth_method = this.resolveAuthMethod(transaction);
    session.authorization_reference =
      transaction.authorization?.ocpiAuthReference ?? null;
    session.meter_id = null;

    return session;
  }

  private mapTransactionWithContextToSession(
    transaction: TransactionDto,
    location: LocationDTO,
    token: TokenDTO,
    tariff: TariffDto,
    chargingPeriodsMode: ChargingPeriodsMode,
  ): Session {
    return {
      country_code: location.country_code,
      party_id: location.party_id,
      id: transaction.transactionId!,
      start_date_time: transaction.startTime
        ? new Date(transaction.startTime)
        : (() => {
            this.logger.error(
              `Transaction ${transaction.transactionId} has no startTime. Using createdAt as placeholder.`,
            );
            return transaction.createdAt!;
          })(),
      end_date_time: transaction.endTime ? new Date(transaction.endTime) : null,
      kwh: transaction.totalKwh || 0,
      cdr_token: this.createCdrToken(token),
      auth_method: this.resolveAuthMethod(transaction),
      location_id: this.getLocationId(location),
      evse_uid: this.getEvseUid(transaction, location),
      connector_id: transaction.connectorId!.toString(),
      currency: tariff.currency,
      charging_periods: this.getChargingPeriods(
        transaction,
        String(tariff?.ocpiTariffId),
        chargingPeriodsMode,
      ),
      status: this.getTransactionStatus(transaction),
      last_updated: transaction.updatedAt!,
      authorization_reference:
        transaction.authorization?.ocpiAuthReference ?? null,
      total_cost: transaction.endTime
        ? this.calculateTotalCost(transaction.totalKwh || 0, tariff)
        : null,
      meter_id: null,
    };
  }

  private getLatestEvent(transactionEvents: TransactionEventDto[]): Date {
    return transactionEvents.reduce((latestDate, current) => {
      const currentDate = new Date(current.timestamp);
      if (!latestDate || currentDate > latestDate) {
        return currentDate;
      }
      return latestDate;
    }, new Date(transactionEvents[0].timestamp));
  }

  private createCdrToken(token: TokenDTO): CdrToken {
    return {
      uid: token?.uid,
      type: token?.type,
      contract_id: token?.contract_id,
      country_code: token?.country_code,
      party_id: token?.party_id,
    };
  }

  private getLocationId(location: LocationDTO) {
    if (!location.id) {
      this.logger.warn(`Location missing for location ${location.id}`);
    }

    return location.id ?? '';
  }

  private resolveAuthMethod(
    transaction: TransactionDto | Partial<TransactionDto>,
  ): AuthMethod {
    const method = transaction.authorization?.ocpiAuthMethod;
    if (
      method === AuthMethod.AUTH_REQUEST ||
      method === AuthMethod.COMMAND ||
      method === AuthMethod.WHITELIST
    ) {
      return method as AuthMethod;
    }
    return AuthMethod.WHITELIST;
  }

  private getEvseUid(
    transaction: TransactionDto,
    location: LocationDTO,
  ): string {
    const evseTypeId = this.resolveEvseTypeId(transaction);

    if (evseTypeId != null) {
      return UID_FORMAT(transaction.stationId, evseTypeId);
    }

    throw new Error(
      `Cannot resolve evse_uid for transaction ${transaction.transactionId}`,
    );
  }

  private resolveEvseTypeId(transaction: TransactionDto): number | undefined {
    const station = transaction.location?.chargingPool?.find(
      (s) => s.id === transaction.stationId,
    );
    return station?.evses?.find((e) => e.id === transaction.evseId)?.evseTypeId;
  }

  private getCurrency(location: LocationDTO): string {
    switch (location.country_code) {
      case 'US':
      default:
        return '';
    }
  }

  public getChargingPeriods(
    transaction: TransactionDto,
    tariffId: string,
    chargingPeriodsMode: ChargingPeriodsMode,
  ): ChargingPeriod[] {
    const meterValues = transaction.meterValues ?? [];

    const periods = meterValues
      .sort(
        (a, b) =>
          new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      )
      .map((meterValue, index, sortedMeterValues) => {
        const previousMeterValue =
          index > 0 ? sortedMeterValues[index - 1] : undefined;
        return this.mapMeterValueToChargingPeriod(
          meterValue,
          tariffId,
          previousMeterValue,
        );
      });

    if (chargingPeriodsMode === ChargingPeriodsMode.Cumulative) {
      return this.collapseToCumulativePeriod(transaction, periods, tariffId);
    }

    return periods;
  }

  private collapseToCumulativePeriod(
    transaction: TransactionDto,
    periods: ChargingPeriod[],
    tariffId: string,
  ): ChargingPeriod[] {
    if (periods.length === 0) return [];
    const sum = (type: CdrDimensionType) =>
      periods.reduce(
        (acc, p) =>
          acc + (p.dimensions.find((d) => d.type === type)?.volume ?? 0),
        0,
      );

    const start = new Date(transaction.startTime ?? transaction.createdAt!);
    const end = transaction.endTime
      ? new Date(transaction.endTime)
      : new Date(transaction.updatedAt ?? Date.now());
    const timeHours = Math.max(
      0,
      (end.getTime() - start.getTime()) / 3_600_000,
    );

    return [
      {
        start_date_time: periods[0].start_date_time,
        dimensions: [
          { type: CdrDimensionType.ENERGY, volume: transaction.totalKwh ?? 0 },
          // { type: CdrDimensionType.TIME, volume: sum(CdrDimensionType.TIME) },
          { type: CdrDimensionType.TIME, volume: timeHours },
        ].filter((d) => d.volume > 0 || d.type === CdrDimensionType.ENERGY),
        tariff_id: tariffId,
      },
    ];
  }

  private mapMeterValueToChargingPeriod(
    meterValue: MeterValueDto,
    tariffId: string,
    previousMeterValue?: MeterValueDto,
  ): ChargingPeriod {
    return {
      start_date_time: new Date(meterValue.timestamp),
      dimensions: this.getCdrDimensions(meterValue, previousMeterValue),
      tariff_id: tariffId,
    };
  }

  private getCdrDimensions(
    meterValue: MeterValueDto,
    previousMeterValue?: MeterValueDto,
  ): CdrDimension[] {
    const cdrDimensions: CdrDimension[] = [];
    for (const sampledValue of meterValue.sampledValue) {
      switch (sampledValue.measurand) {
        case OCPP2_0_1.MeasurandEnumType.Current_Import:
          if (sampledValue.phase === 'N') {
            cdrDimensions.push({
              type: CdrDimensionType.CURRENT,
              volume: Number(sampledValue.value),
            });
          }
          break;
        case OCPP2_0_1.MeasurandEnumType.Energy_Active_Import_Register:
          if (!sampledValue.phase) {
            cdrDimensions.push({
              type: CdrDimensionType.ENERGY_IMPORT,
              volume: Number(sampledValue.value),
            });
            const previousEnergyImport =
              this.getEnergyImportForMeterValue(previousMeterValue);
            if (
              previousEnergyImport !== undefined &&
              !isNaN(Number(previousEnergyImport)) &&
              !isNaN(Number(sampledValue.value))
            ) {
              cdrDimensions.push({
                type: CdrDimensionType.ENERGY,
                volume:
                  Number(sampledValue.value) - Number(previousEnergyImport),
              });
            }
          }
          break;
        case OCPP2_0_1.MeasurandEnumType.SoC:
          cdrDimensions.push({
            type: CdrDimensionType.STATE_OF_CHARGE,
            volume: Number(sampledValue.value),
          });
          break;
      }
    }
    cdrDimensions.push({
      type: CdrDimensionType.TIME,
      volume: this.getTimeElapsedForMeterValue(meterValue, previousMeterValue),
    });
    return cdrDimensions;
  }

  private getEnergyImportForMeterValue(meterValue?: MeterValueDto) {
    return (
      meterValue?.sampledValue.find(
        (sampledValue) =>
          sampledValue.measurand ===
            OCPP2_0_1.MeasurandEnumType.Energy_Active_Import_Register &&
          !sampledValue.phase,
      )?.value ?? undefined
    );
  }

  private getTimeElapsedForMeterValue(
    meterValue: MeterValueDto,
    previousMeterValue?: MeterValueDto,
  ): number {
    const timeDiffMs = previousMeterValue
      ? new Date(meterValue.timestamp).getTime() -
        new Date(previousMeterValue.timestamp).getTime()
      : 0;

    // Convert milliseconds to hours
    return timeDiffMs / (1000 * 60 * 60); // 1000 ms/sec * 60 sec/min * 60 min/hour
  }

  private getTransactionStatus(transaction: TransactionDto): SessionStatus {
    // TODO: Implement other session status
    if (transaction.chargingState === ChargingStateEnum.EVConnected) {
      return SessionStatus.PENDING;
    }
    return transaction.endTime ? SessionStatus.COMPLETED : SessionStatus.ACTIVE;
  }

  // public getCumulativeChargingPeriod(
  //   transaction: TransactionDto,
  //   tariffId: string,
  // ): ChargingPeriod[] {
  //   const start = transaction.startTime ?? transaction.createdAt;
  //   return [{
  //     start_date_time: new Date(start!),
  //     dimensions: [
  //       { type: 'ENERGY', volume: transaction.totalKwh ?? 0 },
  //       { type: 'TIME', volume: /* hours since start */ },
  //       // optional PARKING_TIME if you have it
  //     ],
  //     tariff_id: tariffId,
  //   }];
  // }
}
