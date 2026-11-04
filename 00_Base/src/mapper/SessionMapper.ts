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
import { roundOcpiNumber, toRoundedHours } from '../util/Util.js';

interface SessionStart {
  timestamp: Date;
  energyKwh?: number;
  // Only used to identify the transaction when meterStart is rejected
  transactionId?: string;
}

interface SessionEnd {
  timestamp: Date;
  totalKwh?: number;
}

// Rounding slack when comparing session boundaries with register readings (kWh)
const ENERGY_TOLERANCE_KWH = 1e-6;
// Per-phase energy registers, summed when a station sends no total (core MeterValueUtils order)
const PHASE_GROUPS: string[][] = [
  ['L1', 'L2', 'L3'],
  ['L1-N', 'L2-N', 'L3-N'],
];

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
    );
  }

  /**
   * Maps a partial transaction to a partial session
   */
  public async mapPartialTransactionToPartialSession(
    transaction: Partial<TransactionDto>,
  ): Promise<Partial<Session>> {
    // If we don't have a transaction ID, we can only map basic fields
    const locationMap = await this.getLocationDTOsForTransactions([
      transaction as TransactionDto,
    ]);
    const locationDto = locationMap.get(transaction.transactionId as string);

    if (!locationDto) {
      throw new Error(`Location ${transaction.locationId} not found`);
    }
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
    );
  }

  public async mapTransactionsToSessionsHelper(
    transactions: TransactionDto[],
    transactionIdToLocationMap: Map<string, LocationDTO>,
    transactionIdToTokenMap: Map<string, TokenDTO>,
    transactionIdToTariffMap: Map<string, TariffDto>,
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
    const [, , tariffMap] =
      await this.getLocationsTokensAndTariffsMapsForTransactions([transaction]);
    const tariff = tariffMap.get(transaction.transactionId!);
    if (!tariff) {
      throw new Error(
        `Tariff not found for transaction ${transaction.transactionId}`,
      );
    }
    // PATCH appends charging_periods: send only the period closed by the latest reading
    const periods = this.getChargingPeriods(
      transaction.meterValues ?? [],
      String(tariff.ocpiTariffId),
      this.getSessionStart(transaction),
      this.getSessionEnd(transaction),
    ).slice(-1);
    // total_cost from the kwh sent, so it matches kwh x price and the CDR total_cost
    const kwh = roundOcpiNumber(transaction.totalKwh || 0);

    return {
      id: transaction.transactionId,
      end_date_time: transaction.endTime ? new Date(transaction.endTime) : null,
      kwh,
      status: this.getTransactionStatus(transaction),
      // OCPI DateTime must be UTC with "Z" (§16.2); Hasura returns "+00:00"
      last_updated: transaction.updatedAt
        ? new Date(transaction.updatedAt)
        : undefined,
      total_cost: this.calculateTotalCost(kwh, tariff) ?? null,
      ...(periods.length > 0 ? { charging_periods: periods } : {}),
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
      session.kwh = roundOcpiNumber(transaction.totalKwh || 0);
    }

    if (transaction.updatedAt !== undefined) {
      session.last_updated = new Date(transaction.updatedAt!);
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
    if (transaction.meterValues && tariff) {
      session.charging_periods = this.getChargingPeriods(
        transaction.meterValues,
        String(tariff.ocpiTariffId),
        this.getSessionStart(transaction),
        this.getSessionEnd(transaction),
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
      session.kwh = roundOcpiNumber(transaction.totalKwh || 0);
    }

    if (transaction.updatedAt !== undefined) {
      session.last_updated = new Date(transaction.updatedAt!);
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
  ): Session {
    // total_cost from the kwh sent, so it matches kwh x price and the CDR total_cost
    const kwh = roundOcpiNumber(transaction.totalKwh || 0);
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
      kwh,
      cdr_token: this.createCdrToken(token),
      // TODO: Implement other auth methods
      auth_method: this.resolveAuthMethod(transaction),
      location_id: this.getLocationId(location),
      evse_uid: this.getEvseUid(transaction, location),
      connector_id: transaction.connectorId!.toString(),
      currency: tariff.currency,
      charging_periods: this.getChargingPeriods(
        transaction.meterValues,
        String(tariff?.ocpiTariffId),
        this.getSessionStart(transaction),
        this.getSessionEnd(transaction),
      ),
      status: this.getTransactionStatus(transaction),
      last_updated: new Date(transaction.updatedAt!),
      // TODO: Fill in optional values
      authorization_reference:
        transaction.authorization?.ocpiAuthReference ?? null,
      total_cost: transaction.endTime
        ? this.calculateTotalCost(kwh, tariff)
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
    _location: LocationDTO,
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

  /**
   * OCPI ChargingPeriod: a period starts at start_date_time and ends when the next one starts,
   * so each period runs from one reading to the next and carries what was charged in between.
   * When the session start is given, it is used as the first reading so the energy charged
   * before the first meter value (meterStart -> first sample) is not lost. Likewise the session
   * end of a finished transaction closes the last period (last sample -> meterStop).
   * A finished session without meter values gets a single start -> end period, since a CDR
   * needs at least one.
   */
  public getChargingPeriods(
    meterValues: MeterValueDto[] = [],
    tariffId: string,
    sessionStart?: SessionStart,
    sessionEnd?: SessionEnd,
  ): ChargingPeriod[] {
    const readings = this.mergeMeterValuesByTimestamp(meterValues);
    const startKwh = this.getTrustedStartKwh(readings, sessionStart);
    if (
      sessionStart &&
      (readings.length === 0 ||
        sessionStart.timestamp.getTime() <
          new Date(readings[0].timestamp).getTime())
    ) {
      readings.unshift(
        this.toBoundaryReading(sessionStart.timestamp, startKwh),
      );
    }
    if (readings.length === 0) {
      return [];
    }
    const lastReading = readings[readings.length - 1];

    if (
      sessionEnd &&
      sessionEnd.timestamp.getTime() > new Date(lastReading.timestamp).getTime()
    ) {
      const lastKwh = this.getEnergyKwh(lastReading);
      const endKwh =
        startKwh !== undefined && sessionEnd.totalKwh !== undefined
          ? startKwh + sessionEnd.totalKwh
          : undefined;
      readings.push(
        this.toBoundaryReading(
          sessionEnd.timestamp,
          endKwh !== undefined &&
            (lastKwh === undefined || endKwh >= lastKwh - ENERGY_TOLERANCE_KWH)
            ? Math.max(endKwh, lastKwh ?? endKwh)
            : undefined,
        ),
      );
    }

    return readings.slice(0, -1).map((from, index) => ({
      start_date_time: new Date(from.timestamp),
      dimensions: this.getCdrDimensions(readings[index + 1], from, startKwh),
      tariff_id: tariffId,
    }));
  }

  /**
   * Transactions started before core stored meterStart in kWh still hold Wh, and some
   * stations take meterStart from another register: only trust a finite, non-negative start
   * energy that is not above the first energy reading. A rejected meterStart drops the start
   * and end period energy and ENERGY_IMPORT, so it is logged.
   */
  private getTrustedStartKwh(
    readings: MeterValueDto[],
    sessionStart?: SessionStart,
  ): number | undefined {
    const startKwh = sessionStart?.energyKwh;
    if (startKwh === undefined) {
      return undefined;
    }
    if (!Number.isFinite(startKwh) || startKwh < 0) {
      this.logger.warn(
        `Ignoring meterStart ${startKwh} kWh of transaction ${sessionStart?.transactionId}: not a finite non-negative energy`,
      );
      return undefined;
    }
    const firstKwh = readings
      .map((reading) => this.getEnergyKwh(reading))
      .find((kwh) => kwh !== undefined);
    if (firstKwh !== undefined && startKwh > firstKwh + ENERGY_TOLERANCE_KWH) {
      this.logger.warn(
        `Ignoring meterStart ${startKwh} kWh of transaction ${sessionStart?.transactionId}: above first energy reading ${firstKwh} kWh`,
      );
      return undefined;
    }
    return startKwh;
  }

  private getSessionStart(
    transaction: Partial<TransactionDto>,
  ): SessionStart | undefined {
    if (!transaction.startTime) {
      return undefined;
    }
    return {
      timestamp: new Date(transaction.startTime),
      // Transaction.meterStart is stored in kWh (core normalizes 1.6 Wh meterStart)
      energyKwh:
        transaction.meterStart === null || transaction.meterStart === undefined
          ? undefined
          : Number(transaction.meterStart),
      transactionId: transaction.transactionId,
    };
  }

  private getSessionEnd(
    transaction: Partial<TransactionDto>,
  ): SessionEnd | undefined {
    if (transaction.isActive !== false || !transaction.endTime) {
      return undefined;
    }
    return {
      timestamp: new Date(transaction.endTime),
      // Final totalKwh = (meterStop - meterStart) on 1.6, last register - meterStart on 2.0.1
      totalKwh:
        transaction.totalKwh === null || transaction.totalKwh === undefined
          ? undefined
          : Number(transaction.totalKwh),
    };
  }

  /**
   * Energy register in kWh, picked like core MeterValueUtils: a missing measurand is
   * Energy.Active.Import.Register (OCPP default), and without a usable non-phased register
   * the L1/L2/L3 (else L1-N/L2-N/L3-N) registers are summed.
   */
  private getEnergyKwh(meterValue?: MeterValueDto): number | undefined {
    const registers = (meterValue?.sampledValue ?? []).filter(
      (sampledValue) =>
        !sampledValue.measurand ||
        sampledValue.measurand ===
          OCPP2_0_1.MeasurandEnumType.Energy_Active_Import_Register,
    );
    const total = registers.find((sampledValue) => !sampledValue.phase);
    const totalKwh = total ? this.toKwh(total) : undefined;
    if (totalKwh !== undefined) {
      return totalKwh;
    }
    for (const phases of PHASE_GROUPS) {
      const phaseKwh = registers
        .filter((sampledValue) => phases.includes(sampledValue.phase ?? ''))
        .map((sampledValue) => this.toKwh(sampledValue))
        .filter((kwh): kwh is number => kwh !== undefined);
      if (phaseKwh.length > 0) {
        return phaseKwh.reduce((sum, kwh) => sum + kwh, 0);
      }
    }
    return undefined;
  }

  /**
   * Synthetic reading at a session boundary (start or end), carrying the register in kWh when
   * it is known; without energy it only contributes TIME to its period.
   */
  private toBoundaryReading(
    timestamp: Date,
    energyKwh: number | undefined,
  ): MeterValueDto {
    return {
      timestamp: timestamp.toISOString(),
      sampledValue:
        energyKwh === undefined
          ? []
          : [
              {
                value: energyKwh,
                measurand:
                  OCPP2_0_1.MeasurandEnumType.Energy_Active_Import_Register,
                unitOfMeasure: { unit: 'kWh', multiplier: 0 },
              },
            ],
    } as unknown as MeterValueDto;
  }

  /**
   * Stations can send the same reading twice (OCPP 1.6 StopTransaction transactionData,
   * OCPP 2.0.1 TransactionEvent Ended): merge readings sharing a timestamp so each
   * timestamp gives one charging period, keeping one sampled value per measurand/phase/location.
   * Returns the readings sorted by timestamp, without mutating the input.
   */
  private mergeMeterValuesByTimestamp(
    meterValues: MeterValueDto[],
  ): MeterValueDto[] {
    const byTimestamp = new Map<number, MeterValueDto>();
    for (const meterValue of meterValues) {
      const time = new Date(meterValue.timestamp).getTime();
      const merged = byTimestamp.get(time);
      if (!merged) {
        byTimestamp.set(time, {
          ...meterValue,
          sampledValue: [
            ...meterValue.sampledValue,
          ] as MeterValueDto['sampledValue'],
        });
        continue;
      }
      for (const sampledValue of meterValue.sampledValue) {
        const alreadyMerged = merged.sampledValue.some(
          (existing) =>
            existing.measurand === sampledValue.measurand &&
            existing.phase === sampledValue.phase &&
            existing.location === sampledValue.location,
        );
        if (!alreadyMerged) {
          merged.sampledValue.push(sampledValue);
        }
      }
    }
    return [...byTimestamp.entries()]
      .sort(([a], [b]) => a - b)
      .map(([, meterValue]) => meterValue);
  }

  private getCdrDimensions(
    meterValue: MeterValueDto,
    previousMeterValue?: MeterValueDto,
    sessionStartKwh?: number,
  ): CdrDimension[] {
    const cdrDimensions: CdrDimension[] = [];
    // OCPI ENERGY / ENERGY_IMPORT are in kWh, registers come in the station's unit
    const energyKwh = this.getEnergyKwh(meterValue);
    if (energyKwh !== undefined) {
      if (sessionStartKwh !== undefined) {
        cdrDimensions.push({
          type: CdrDimensionType.ENERGY_IMPORT,
          volume: roundOcpiNumber(energyKwh - sessionStartKwh),
        });
      }
      const previousEnergyKwh = this.getEnergyKwh(previousMeterValue);
      if (previousEnergyKwh !== undefined) {
        // Difference of rounded registers: the 4-decimal periods still add up to the total
        cdrDimensions.push({
          type: CdrDimensionType.ENERGY,
          volume: roundOcpiNumber(
            roundOcpiNumber(energyKwh) - roundOcpiNumber(previousEnergyKwh),
          ),
        });
      }
    }
    for (const sampledValue of meterValue.sampledValue) {
      switch (sampledValue.measurand) {
        case OCPP2_0_1.MeasurandEnumType.Current_Import:
          if (sampledValue.phase === 'N') {
            cdrDimensions.push({
              type: CdrDimensionType.CURRENT,
              volume: roundOcpiNumber(Number(sampledValue.value)),
            });
          }
          break;
        case OCPP2_0_1.MeasurandEnumType.SoC:
          cdrDimensions.push({
            type: CdrDimensionType.STATE_OF_CHARGE,
            volume: roundOcpiNumber(Number(sampledValue.value)),
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

  /**
   * Same normalization as core MeterValueUtils: no unit means Wh (OCPP default),
   * multiplier is a power of ten. Returns undefined for a non-energy unit or a non-numeric value.
   */
  private toKwh(
    sampledValue: MeterValueDto['sampledValue'][number],
  ): number | undefined {
    const value = Number(sampledValue.value);
    if (isNaN(value)) {
      return undefined;
    }
    const multiplier = sampledValue.unitOfMeasure?.multiplier ?? 0;
    switch (sampledValue.unitOfMeasure?.unit?.toUpperCase()) {
      case 'KWH':
        return value * 10 ** multiplier;
      case 'WH':
      case undefined:
        return value * 10 ** (multiplier - 3);
      default:
        return undefined;
    }
  }

  private getTimeElapsedForMeterValue(
    meterValue: MeterValueDto,
    previousMeterValue?: MeterValueDto,
  ): number {
    if (!previousMeterValue) {
      return 0;
    }
    // Difference of rounded instants (in hours): the 4-decimal periods still add up to total_time
    return roundOcpiNumber(
      toRoundedHours(new Date(meterValue.timestamp)) -
        toRoundedHours(new Date(previousMeterValue.timestamp)),
    );
  }

  private getTransactionStatus(transaction: TransactionDto): SessionStatus {
    // TODO: Implement other session status
    if (transaction.chargingState === ChargingStateEnum.EVConnected) {
      return SessionStatus.PENDING;
    }
    return transaction.endTime ? SessionStatus.COMPLETED : SessionStatus.ACTIVE;
  }
}
