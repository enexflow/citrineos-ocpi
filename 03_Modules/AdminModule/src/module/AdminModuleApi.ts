// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  AsAdminEndpoint,
  BaseController,
  BodyWithSchema,
  CdrsService,
  DEFAULT_LIMIT,
  DEFAULT_OFFSET,
  GET_ALL_TENANT_PARTNERS,
  GET_TENANT_PARTNER_BY_ID,
  GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY,
  InvalidParamException,
  LocationsPullService,
  NotFoundException,
  OcpiGraphqlClient,
  OcpiHeaders,
  OcpiLogger,
  OcpiResponseStatusCode,
  OpenAPI,
  OnboardRoamingPartnerBodySchema,
  OnboardRoamingPartnerBodySchemaName,
  OnboardRoamingPartnerEmspBodySchema,
  OnboardRoamingPartnerEmspBodySchemaName,
  OnboardTenantPartnerEmspBodySchema,
  OnboardTenantPartnerEmspBodySchemaName,
  OnboardRoamingNetworkCpoBodySchema,
  OnboardRoamingNetworkCpoBodySchemaName,
  OnboardRoamingNetworkEmspBodySchema,
  OnboardRoamingNetworkEmspBodySchemaName,
  Paginated,
  PaginatedParams,
  PENNYLANE_PARTNER_ALREADY_LINKED,
  PennylaneService,
  SessionsService,
  UnsuccessfulRequestException,
  type GetAllTenantPartnersQueryResult,
  type GetAllTenantPartnersQueryVariables,
  type GetTenantPartnerByIdQueryResult,
  type GetTenantPartnerByCpoClientAndModuleIdQueryResult,
  type GetTenantPartnerByCpoClientAndModuleIdQueryVariables,
  type GetTenantPartnerByIdQueryVariables,
  DeleteLocationBodySchema,
  DeleteLocationBodySchemaName,
  TariffsService,
  LocationsService,
  type OnboardRoamingPartnerBody,
  type DeleteLocationBody,
  type DeleteLocationSummary,
  type OnboardRoamingPartnerEmspBody,
  type OnboardTenantPartnerEmspBody,
  type OnboardRoamingNetworkCpoBody,
  type OnboardRoamingNetworkEmspBody,
  type PennylaneBilling,
  type PennylaneCompanyCustomerRequest,
} from '@citrineos/ocpi-base';
import {
  Get,
  HeaderParam,
  JsonController,
  Param,
  Post,
} from 'routing-controllers';
import { Service } from 'typedi';
import { RoamingPartnerService } from '@citrineos/ocpi-base';
import {
  selectNetworkOperations,
  type SelectedOperation,
  type SkippedOperation,
} from './network.js';

type UpsertOutcome = 'created' | 'role_added' | 'unchanged';

/** OCPI identity of one roaming partner to pull, behind its hub. */
type PullTarget = {
  ourCountryCode: string;
  ourPartyId: string;
  partnerCountryCode: string;
  partnerPartyId: string;
  roamingPartnerCountryCode: string;
  roamingPartnerPartyId: string;
};

/** Per-operation result of a network route. */
type NetworkOperationResult = {
  operation: string;
  status: string;
  pennylaneCustomerId?: number;
  error?: string;
};

const UPSERT_STATUS = {
  created: 'roaming partner created',
  role_added: 'role added to existing roaming partner',
  unchanged: 'roaming partner already exists',
} as const;

const pennylaneStatus = (created: boolean) =>
  created ? 'pennylane customer created' : 'existing pennylane customer linked';

// BodyWithSchema only feeds the OpenAPI spec, it does not validate requests.
const parseBody = <T>(
  schema: { safeParse: (data: unknown) => any },
  rawBody: unknown,
): T => {
  const parsed = schema.safeParse(rawBody);
  if (!parsed.success) {
    throw new InvalidParamException(
      parsed.error.issues
        .map(
          (issue: { path: (string | number)[]; message: string }) =>
            `${issue.path.join('.')}: ${issue.message}`,
        )
        .join('; '),
    );
  }
  return parsed.data;
};

const toPennylaneCompanyCustomer = (
  name: string,
  body: PennylaneBilling,
): PennylaneCompanyCustomerRequest => ({
  name,
  payment_conditions: body.paymentConditions,
  emails: body.emails,
  billing_address: {
    address: body.billingAddress.address,
    postal_code: body.billingAddress.postalCode,
    city: body.billingAddress.city,
    country_alpha2: body.billingAddress.countryAlpha2,
  },
  vat_number: body.vatNumber,
  reg_no: body.regNo,
  phone: body.phone,
  recipient: body.recipient,
  billing_iban: body.billingIban,
  notes: body.notes,
  billing_language: body.billingLanguage,
  reference: body.reference,
  external_reference: body.externalReference,
});

@JsonController('/admin')
@Service()
export class AdminModuleApi extends BaseController {
  constructor(
    readonly logger: OcpiLogger,
    readonly roamingPartnerService: RoamingPartnerService,
    readonly tariffsService: TariffsService,
    readonly locationsPullService: LocationsPullService,
    readonly sessionsService: SessionsService,
    readonly cdrsService: CdrsService,
    readonly ocpiGraphqlClient: OcpiGraphqlClient,
    readonly locationsService: LocationsService,
    readonly pennylaneService: PennylaneService,
  ) {
    super();
  }

  // One network pull at a time, so the hub never serves two of them at once.
  // In-memory: assumes a single OCPI replica.
  private networkPullRunning = false;

  /** Pulls tariffs, then locations, of one roaming partner. */
  private async pullRoamingPartnerData(target: PullTarget): Promise<void> {
    const tariffs = await this.tariffsService.pullPartnerTariffs({
      ...target,
      offset: 0,
      limit: 100,
    });
    this.logger.info('Tariffs pull completed', tariffs);

    const locations = await this.locationsPullService.PullPartnerLocations({
      ...target,
      offset: 0,
      limit: 20,
    });
    this.logger.info('Locations pull completed', locations);
  }

  /**
   * Creates (or links) the Pennylane customer of a roaming partner. Throws
   * UnsuccessfulRequestException on a TS API failure; the partner is kept and
   * retrying is safe.
   */
  private async linkRoamingPartnerToPennylane(
    name: string,
    body: PennylaneBilling & { contractNb: string },
    partner: { id: number; tenantPartnerId: number; outcome: UpsertOutcome },
    authorization?: string,
  ): Promise<{ status: string; pennylaneCustomerId?: number }> {
    const upsertStatus = UPSERT_STATUS[partner.outcome];
    // Called for every outcome: the TS API is idempotent on the
    // (tenant_partner_id, roaming_partner_id) link, so a retry after a failure,
    // a CPO partner gaining EMSP and a backfilled partner all get a customer.
    try {
      const { customer, created } =
        await this.pennylaneService.createCompanyCustomer(
          {
            ...toPennylaneCompanyCustomer(name, body),
            tenant_partner_id: partner.tenantPartnerId,
            roaming_partner_id: partner.id,
            contract_nb: body.contractNb,
          },
          authorization,
        );
      return {
        status: `${upsertStatus}; ${pennylaneStatus(created)}`,
        pennylaneCustomerId: customer.id,
      };
    } catch (err) {
      if (
        err instanceof UnsuccessfulRequestException &&
        err.statusCode === 409 &&
        err.code === PENNYLANE_PARTNER_ALREADY_LINKED
      ) {
        return {
          status: `${upsertStatus}; pennylane customer already linked`,
        };
      }
      this.logger.error('Failed to create Pennylane customer', err);
      throw new UnsuccessfulRequestException(
        `${upsertStatus}; pennylane customer creation failed: ${
          (err as Error)?.message
        }`,
        undefined,
        err instanceof UnsuccessfulRequestException
          ? { statusCode: err.statusCode, code: err.code }
          : undefined,
      );
    }
  }

  /** 404 when the hub TenantPartner does not exist, before any write. */
  private async assertTenantPartnerExists(identity: {
    ourCountryCode: string;
    ourPartyId: string;
    partnerCountryCode: string;
    partnerPartyId: string;
  }): Promise<void> {
    const result = await this.ocpiGraphqlClient.request<
      GetTenantPartnerByCpoClientAndModuleIdQueryResult,
      GetTenantPartnerByCpoClientAndModuleIdQueryVariables
    >(GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY, {
      ourCountryCode: identity.ourCountryCode,
      ourPartyId: identity.ourPartyId,
      partnerCountryCode: identity.partnerCountryCode,
      partnerPartyId: identity.partnerPartyId,
    });
    if (!result.TenantPartners[0]) {
      throw new NotFoundException(
        `Tenant partner ${identity.partnerCountryCode}-${identity.partnerPartyId} not found for ${identity.ourCountryCode}-${identity.ourPartyId}`,
      );
    }
  }

  /** Upsert body of one network operation: shared contract data + its identity. */
  private toRoamingPartnerBody(
    body: OnboardRoamingNetworkCpoBody | OnboardRoamingNetworkEmspBody,
    operation: SelectedOperation,
  ): OnboardRoamingPartnerBody {
    return {
      ourCountryCode: body.ourCountryCode,
      ourPartyId: body.ourPartyId,
      partnerCountryCode: body.partnerCountryCode,
      partnerPartyId: body.partnerPartyId,
      roamingPartnerCountryCode: operation.countryCode,
      roamingPartnerPartyId: operation.partyId,
      roamingPartnerName: body.roamingPartnerName,
      roamingPartnerSignatureDate: body.roamingPartnerSignatureDate,
      roamingPartnerContractStartDate: body.roamingPartnerContractStartDate,
      roamingPartnerIsHdv: body.roamingPartnerIsHdv,
    };
  }

  /** Pulls each target in turn; one failure does not stop the others. */
  private async pullNetwork(targets: PullTarget[]): Promise<void> {
    let failed = 0;
    try {
      for (const [index, target] of targets.entries()) {
        const label = `${target.roamingPartnerCountryCode}*${target.roamingPartnerPartyId}`;
        this.logger.info(
          `Network pull ${index + 1}/${targets.length}: ${label}`,
        );
        try {
          await this.pullRoamingPartnerData(target);
        } catch (err) {
          failed++;
          this.logger.error(`Network pull failed for ${label}`, err);
        }
      }
      this.logger.info('Network pull completed', {
        total: targets.length,
        failed,
      });
    } finally {
      this.networkPullRunning = false;
    }
  }

  /**
   * Resolves a TenantPartner id to the OCPI from/to identity needed to call
   * SessionsService/CdrsService directly — no partner credential required,
   * since this is an internal server-side lookup, not an OCPI protocol call.
   */
  private async resolvePartnerHeaders(partnerId: number): Promise<OcpiHeaders> {
    const result = await this.ocpiGraphqlClient.request<
      GetTenantPartnerByIdQueryResult,
      GetTenantPartnerByIdQueryVariables
    >(GET_TENANT_PARTNER_BY_ID, { id: partnerId });

    const partner = result.TenantPartners_by_pk;
    if (!partner?.tenant?.countryCode || !partner.tenant?.partyId) {
      throw new NotFoundException(`Partner ${partnerId} not found`);
    }

    return new OcpiHeaders(
      partner.countryCode,
      partner.partyId,
      partner.tenant.countryCode,
      partner.tenant.partyId,
    );
  }

  /**
   * Projects only the safe identity fields out of partnerProfileOCPI —
   * serverCredentials/credentials never leave this method.
   */
  private toIdentity(row: {
    id: number;
    countryCode: string;
    partyId: string;
    partnerProfileOCPI?: unknown;
  }) {
    const profile = row.partnerProfileOCPI as
      | {
          roles?: Array<{
            role?: string;
            businessDetails?: { name?: string; website?: string };
          }>;
        }
      | null
      | undefined;
    const primaryRole = profile?.roles?.[0];

    return {
      id: row.id,
      countryCode: row.countryCode,
      partyId: row.partyId,
      role: primaryRole?.role ?? 'OTHER',
      businessDetails: primaryRole?.businessDetails ?? null,
    };
  }

  /**
   * Admin UI: partner identity (role/business details) for every partner.
   * Replaces the frontend's direct GraphQL read of partnerProfileOCPI, which
   * also exposed serverCredentials/credentials tokens (SEC-001).
   */
  @Get('/partners')
  @AsAdminEndpoint()
  async listPartners() {
    const result = await this.ocpiGraphqlClient.request<
      GetAllTenantPartnersQueryResult,
      GetAllTenantPartnersQueryVariables
    >(GET_ALL_TENANT_PARTNERS, {});

    return { data: result.TenantPartners.map((row) => this.toIdentity(row)) };
  }

  /**
   * Admin UI: partner identity for a single partner. See listPartners().
   */
  @Get('/partners/:id')
  @AsAdminEndpoint()
  async getPartner(@Param('id') idParam: string) {
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`Partner ${idParam} not found`);
    }

    const result = await this.ocpiGraphqlClient.request<
      GetTenantPartnerByIdQueryResult,
      GetTenantPartnerByIdQueryVariables
    >(GET_TENANT_PARTNER_BY_ID, { id });

    const partner = result.TenantPartners_by_pk;
    if (!partner) {
      throw new NotFoundException(`Partner ${id} not found`);
    }

    return { data: this.toIdentity(partner) };
  }

  /**
   * Admin UI: sessions we hold for a given partner, resolved server-side.
   * Never exposes the partner's serverCredentials.token to the caller.
   */
  @Get('/partners/:id/sessions')
  @AsAdminEndpoint()
  async getPartnerSessions(
    @Param('id') idParam: string,
    @Paginated() paginatedParams?: PaginatedParams,
  ) {
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`Partner ${idParam} not found`);
    }

    const ocpiHeaders = await this.resolvePartnerHeaders(id);
    const { data, count } = await this.sessionsService.getSessions(
      ocpiHeaders,
      paginatedParams,
    );

    return {
      data,
      total: count,
      offset: paginatedParams?.offset ?? DEFAULT_OFFSET,
      limit: paginatedParams?.limit ?? DEFAULT_LIMIT,
      status_code: OcpiResponseStatusCode.GenericSuccessCode,
      timestamp: new Date(),
    };
  }

  /**
   * Admin UI: CDRs we hold for a given partner, resolved server-side.
   * Never exposes the partner's serverCredentials.token to the caller.
   */
  @Get('/partners/:id/cdrs')
  @AsAdminEndpoint()
  async getPartnerCdrs(
    @Param('id') idParam: string,
    @Paginated() paginatedParams?: PaginatedParams,
  ) {
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      throw new NotFoundException(`Partner ${idParam} not found`);
    }

    const ocpiHeaders = await this.resolvePartnerHeaders(id);
    const result = await this.cdrsService.getCdrs(
      ocpiHeaders.fromCountryCode,
      ocpiHeaders.fromPartyId,
      ocpiHeaders.toCountryCode,
      ocpiHeaders.toPartyId,
      paginatedParams?.dateFrom,
      paginatedParams?.dateTo,
      paginatedParams?.offset,
      paginatedParams?.limit,
    );

    return {
      ...result,
      status_code: OcpiResponseStatusCode.GenericSuccessCode,
      timestamp: new Date(),
    };
  }

  @Post('/onboard-roaming-partner-cpo')
  @OpenAPI({
    summary: 'Onboard a CPO behind a hub',
    description:
      'Upserts a RoamingPartner with role `CPO` on the hub TenantPartner, then pulls tariffs and then locations **in the background**. Returns `accepted`, or `already onboarded` (no pull). See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async onboardRoamingPartnerCpo(
    @BodyWithSchema(
      OnboardRoamingPartnerBodySchema,
      OnboardRoamingPartnerBodySchemaName,
    )
    body: OnboardRoamingPartnerBody,
  ): Promise<{ status: string }> {
    const { outcome } = await this.roamingPartnerService.upsertRoamingPartner(
      body,
      'CPO',
    );
    if (outcome === 'unchanged') {
      return { status: 'already onboarded' };
    }
    void this.pullRoamingPartnerData({
      ourCountryCode: body.ourCountryCode,
      ourPartyId: body.ourPartyId,
      partnerCountryCode: body.partnerCountryCode,
      partnerPartyId: body.partnerPartyId,
      roamingPartnerCountryCode: body.roamingPartnerCountryCode,
      roamingPartnerPartyId: body.roamingPartnerPartyId,
    }).catch((err) => this.logger.error('Failed to pull partner data', err));

    return { status: 'accepted' };
  }

  @Post('/create-roaming-partner-cpo')
  @OpenAPI({
    summary: 'Register a CPO behind a hub (no data pull)',
    description:
      'Upserts a RoamingPartner with role `CPO` on the hub TenantPartner. Does not pull tariffs or locations. See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async createRoamingPartnerCpo(
    @BodyWithSchema(
      OnboardRoamingPartnerBodySchema,
      OnboardRoamingPartnerBodySchemaName,
    )
    body: OnboardRoamingPartnerBody,
  ): Promise<{ status: string }> {
    const { outcome } = await this.roamingPartnerService.upsertRoamingPartner(
      body,
      'CPO',
    );
    return { status: UPSERT_STATUS[outcome] };
  }

  @Post('/create-roaming-partner-emsp')
  @OpenAPI({
    summary: 'Register an EMSP behind a hub (no billing)',
    description:
      'Upserts a RoamingPartner with role `EMSP` on the hub TenantPartner. Does not create a Pennylane customer. See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async createRoamingPartnerEmsp(
    @BodyWithSchema(
      OnboardRoamingPartnerBodySchema,
      OnboardRoamingPartnerBodySchemaName,
    )
    body: OnboardRoamingPartnerBody,
  ): Promise<{ status: string }> {
    const { outcome } = await this.roamingPartnerService.upsertRoamingPartner(
      body,
      'EMSP',
    );
    return { status: UPSERT_STATUS[outcome] };
  }

  @Post('/onboard-roaming-partner-emsp')
  @OpenAPI({
    summary: 'Onboard an EMSP behind a hub',
    description:
      'Upserts a RoamingPartner with role `EMSP` on the hub TenantPartner. Creates the Pennylane customer only if the partner is new. Billing is validated before anything is written. See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async onboardRoamingPartnerEmsp(
    @BodyWithSchema(
      OnboardRoamingPartnerEmspBodySchema,
      OnboardRoamingPartnerEmspBodySchemaName,
    )
    rawBody: OnboardRoamingPartnerEmspBody,
    // Forwarded to the TS API, which trusts the same Keycloak realm.
    @HeaderParam('authorization') authorization?: string,
  ): Promise<{ status: string; pennylaneCustomerId?: number }> {
    // Validate before the upsert so a bad billing body never leaves a partner
    // without its Pennylane customer.
    const body = parseBody<OnboardRoamingPartnerEmspBody>(
      OnboardRoamingPartnerEmspBodySchema,
      rawBody,
    );

    const partner = await this.roamingPartnerService.upsertRoamingPartner(
      body,
      'EMSP',
    );

    // The roaming partner is kept on a TS API failure; retrying is safe.
    return this.linkRoamingPartnerToPennylane(
      body.roamingPartnerName,
      body,
      partner,
      authorization,
    );
  }

  @Post('/onboard-roaming-network-cpo')
  @OpenAPI({
    summary: 'Onboard a whole CPO network behind a hub',
    description:
      'Takes a hub operations export (`operations`, e.g. the Gireve CSV converted to JSON) and upserts one RoamingPartner with role `CPO` per operation, all with the same name and contract dates. Then pulls tariffs and locations **in the background, one partner after another**. Returns the per-operation result straight away. See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async onboardRoamingNetworkCpo(
    @BodyWithSchema(
      OnboardRoamingNetworkCpoBodySchema,
      OnboardRoamingNetworkCpoBodySchemaName,
    )
    rawBody: OnboardRoamingNetworkCpoBody,
  ): Promise<{
    status: string;
    pullQueued: number;
    operations: NetworkOperationResult[];
    skipped: SkippedOperation[];
  }> {
    const body = parseBody<OnboardRoamingNetworkCpoBody>(
      OnboardRoamingNetworkCpoBodySchema,
      rawBody,
    );
    const { selected, skipped } = selectNetworkOperations(
      body.operations,
      body.operationOwner,
    );
    if (this.networkPullRunning) {
      throw new InvalidParamException(
        'A network pull is already running; retry when it has completed (see logs)',
      );
    }
    // Claimed before the first await so two requests cannot both start a pull;
    // released below unless the pull starts (pullNetwork releases it then).
    this.networkPullRunning = true;
    let pullStarted = false;
    try {
      return await this.registerNetworkCpo(body, selected, skipped, () => {
        pullStarted = true;
      });
    } finally {
      if (!pullStarted) {
        this.networkPullRunning = false;
      }
    }
  }

  private async registerNetworkCpo(
    body: OnboardRoamingNetworkCpoBody,
    selected: SelectedOperation[],
    skipped: SkippedOperation[],
    onPullStarted: () => void,
  ): Promise<{
    status: string;
    pullQueued: number;
    operations: NetworkOperationResult[];
    skipped: SkippedOperation[];
  }> {
    await this.assertTenantPartnerExists(body);

    const results: NetworkOperationResult[] = [];
    const targets: PullTarget[] = [];
    for (const operation of selected) {
      try {
        const { outcome } =
          await this.roamingPartnerService.upsertRoamingPartner(
            this.toRoamingPartnerBody(body, operation),
            'CPO',
          );
        results.push({
          operation: operation.operation,
          status: UPSERT_STATUS[outcome],
        });
        if (outcome !== 'unchanged' || body.forcePull) {
          targets.push({
            ourCountryCode: body.ourCountryCode,
            ourPartyId: body.ourPartyId,
            partnerCountryCode: body.partnerCountryCode,
            partnerPartyId: body.partnerPartyId,
            roamingPartnerCountryCode: operation.countryCode,
            roamingPartnerPartyId: operation.partyId,
          });
        }
      } catch (err) {
        results.push({
          operation: operation.operation,
          status: 'failed',
          error: (err as Error)?.message,
        });
      }
    }

    if (targets.length > 0) {
      onPullStarted();
      void this.pullNetwork(targets);
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    return {
      status: `${results.length - failed}/${results.length} operations registered; ${targets.length} queued for pull`,
      pullQueued: targets.length,
      operations: results,
      skipped,
    };
  }

  @Post('/onboard-roaming-network-emsp')
  @OpenAPI({
    summary: 'Onboard a whole EMSP network behind a hub',
    description:
      'Takes a hub operations export (`operations`, e.g. the Gireve CSV converted to JSON) and, one operation after another, upserts a RoamingPartner with role `EMSP` and links it to the Pennylane customer named `roamingPartnerName` (created on the first operation, reused by the TS API for the others). Returns the per-operation result. See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async onboardRoamingNetworkEmsp(
    @BodyWithSchema(
      OnboardRoamingNetworkEmspBodySchema,
      OnboardRoamingNetworkEmspBodySchemaName,
    )
    rawBody: OnboardRoamingNetworkEmspBody,
    // Forwarded to the TS API, which trusts the same Keycloak realm.
    @HeaderParam('authorization') authorization?: string,
  ): Promise<{
    status: string;
    pennylaneCustomerIds: number[];
    operations: NetworkOperationResult[];
    skipped: SkippedOperation[];
  }> {
    const body = parseBody<OnboardRoamingNetworkEmspBody>(
      OnboardRoamingNetworkEmspBodySchema,
      rawBody,
    );
    const { selected, skipped } = selectNetworkOperations(
      body.operations,
      body.operationOwner,
    );
    await this.assertTenantPartnerExists(body);

    // Synchronous and in order: the caller's token is forwarded to the TS API,
    // and the first operation creates the customer the others are linked to.
    const results: NetworkOperationResult[] = [];
    for (const operation of selected) {
      try {
        const partner = await this.roamingPartnerService.upsertRoamingPartner(
          this.toRoamingPartnerBody(body, operation),
          'EMSP',
        );
        const linked = await this.linkRoamingPartnerToPennylane(
          body.roamingPartnerName,
          body,
          partner,
          authorization,
        );
        results.push({ operation: operation.operation, ...linked });
      } catch (err) {
        results.push({
          operation: operation.operation,
          status: 'failed',
          error: (err as Error)?.message,
        });
      }
    }

    const pennylaneCustomerIds = [
      ...new Set(
        results
          .map((r) => r.pennylaneCustomerId)
          .filter((id): id is number => id !== undefined),
      ),
    ];
    if (pennylaneCustomerIds.length > 1) {
      this.logger.warn(
        `Network ${body.roamingPartnerName} is linked to ${pennylaneCustomerIds.length} Pennylane customers`,
        pennylaneCustomerIds,
      );
    }

    const failed = results.filter((r) => r.status === 'failed').length;
    return {
      status: `${results.length - failed}/${results.length} operations onboarded`,
      pennylaneCustomerIds,
      operations: results,
      skipped,
    };
  }

  /**
   * Deletes a location from the OCPI system this does not delete the location from the CPO system.
   * it change disableOCPI field to true in the location table.
   * and send PUT with EVSE status to REMOVED
   * @param body The request body containing location details.
   * @returns A promise resolving to the deletion status.
   */
  @Post('/disable-location-ocpi')
  @AsAdminEndpoint()
  async deleteLocationOCPI(
    @BodyWithSchema(DeleteLocationBodySchema, DeleteLocationBodySchemaName)
    body: DeleteLocationBody,
  ): Promise<{ status: string } & DeleteLocationSummary> {
    return await this.locationsService.deleteLocationOCPI(body);
  }

  /**
   * Creates the Pennylane customer of a direct (peer-to-peer) EMSP partner.
   * The TenantPartner is never created here: it comes from the credentials
   * exchange, so it must already exist. Nothing is written locally, so any TS
   * API failure is returned to the caller as is.
   */
  @Post('/onboard-tenant-partner-emsp')
  @OpenAPI({
    summary: 'Set up billing for a direct EMSP (no hub)',
    description:
      'Creates the Pennylane customer for an existing TenantPartner (404 if the credentials exchange has not been done). Writes nothing to OCPI. See 03_Modules/AdminModule/README.md.',
  })
  @AsAdminEndpoint()
  async onboardTenantPartnerEmsp(
    @BodyWithSchema(
      OnboardTenantPartnerEmspBodySchema,
      OnboardTenantPartnerEmspBodySchemaName,
    )
    rawBody: OnboardTenantPartnerEmspBody,
    // Forwarded to the TS API, which trusts the same Keycloak realm.
    @HeaderParam('authorization') authorization?: string,
  ): Promise<{ status: string; pennylaneCustomerId: number }> {
    const body = parseBody<OnboardTenantPartnerEmspBody>(
      OnboardTenantPartnerEmspBodySchema,
      rawBody,
    );

    const result = await this.ocpiGraphqlClient.request<
      GetTenantPartnerByCpoClientAndModuleIdQueryResult,
      GetTenantPartnerByCpoClientAndModuleIdQueryVariables
    >(GET_TENANT_PARTNER_BY_OUR_AND_PARTNER_IDENTITY, {
      ourCountryCode: body.ourCountryCode,
      ourPartyId: body.ourPartyId,
      partnerCountryCode: body.partnerCountryCode,
      partnerPartyId: body.partnerPartyId,
    });
    const tenantPartner = result.TenantPartners[0];
    if (!tenantPartner) {
      throw new NotFoundException(
        `Tenant partner ${body.partnerCountryCode}-${body.partnerPartyId} not found for ${body.ourCountryCode}-${body.ourPartyId}; run the credentials exchange first`,
      );
    }

    // No roaming_partner_id: a direct contract, not one through a hub.
    const { customer, created } =
      await this.pennylaneService.createCompanyCustomer(
        {
          ...toPennylaneCompanyCustomer(body.tenantPartnerName, body),
          tenant_partner_id: tenantPartner.id,
        },
        authorization,
      );
    return {
      status: pennylaneStatus(created),
      pennylaneCustomerId: customer.id,
    };
  }
}
