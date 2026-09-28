// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0
import {
  AsAdminEndpoint,
  BaseController,
  BodyWithSchema,
  LocationsPullService,
  OcpiLogger,
  OnboardRoamingPartnerBodySchema,
  OnboardRoamingPartnerBodySchemaName,
  DeleteLocationBodySchema,
  DeleteLocationBodySchemaName,
  DeleteLocationSummarySchema,
  TariffsService,
  LocationsService,
  type OnboardRoamingPartnerBody,
  type DeleteLocationBody,
  type DeleteLocationSummary,
} from '@citrineos/ocpi-base';
import { JsonController, Post, Body, Delete } from 'routing-controllers';
import { Service } from 'typedi';
import { RoamingPartnerService } from '@citrineos/ocpi-base';

@JsonController('/admin')
@Service()
export class AdminModuleApi extends BaseController {
  constructor(
    readonly logger: OcpiLogger,
    readonly roamingPartnerService: RoamingPartnerService,
    readonly tariffsService: TariffsService,
    readonly locationsPullService: LocationsPullService,
    readonly locationsService: LocationsService,
  ) {
    super();
  }

  @Post('/onboard-roaming-partner-cpo')
  @AsAdminEndpoint()
  async onboardRoamingPartner(
    @BodyWithSchema(
      OnboardRoamingPartnerBodySchema,
      OnboardRoamingPartnerBodySchemaName,
    )
    body: OnboardRoamingPartnerBody,
  ): Promise<{ status: string }> {
    const roamingPartnerId =
      await this.roamingPartnerService.createRoamingPartner(body);
    if (!roamingPartnerId) {
      return { status: 'failed To create roaming partner' };
    }
    const pullBody = {
      ourCountryCode: body.ourCountryCode,
      ourPartyId: body.ourPartyId,
      partnerCountryCode: body.partnerCountryCode,
      partnerPartyId: body.partnerPartyId,
      roamingPartnerCountryCode: body.roamingPartnerCountryCode,
      roamingPartnerPartyId: body.roamingPartnerPartyId,
      offset: 0,
      limit: 20,
    };

    void (async () => {
      try {
        const tariffs = await this.tariffsService.pullPartnerTariffs({
          ...pullBody,
          offset: 0,
          limit: 100,
        });
        this.logger.info('Tariffs pull completed', tariffs);

        const locations = await this.locationsPullService.PullPartnerLocations({
          ...pullBody,
          offset: 0,
          limit: 20,
        });
        this.logger.info('Locations pull completed', locations);
      } catch (err) {
        this.logger.error('Failed to pull partner data', err);
      }
    })();

    return { status: 'accepted' };
  }

  @Post('/create-roaming-partner-cpo')
  @AsAdminEndpoint()
  async createRoamingPartner(
    @BodyWithSchema(
      OnboardRoamingPartnerBodySchema,
      OnboardRoamingPartnerBodySchemaName,
    )
    body: OnboardRoamingPartnerBody,
  ): Promise<{ status: string }> {
    const roamingPartnerId =
      await this.roamingPartnerService.createRoamingPartner(body);
    if (!roamingPartnerId) {
      return { status: 'failed To create roaming partner' };
    }
    return { status: 'roaming partner created' };
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
    @BodyWithSchema(
      DeleteLocationBodySchema,
      DeleteLocationBodySchemaName,
    )
    body: DeleteLocationBody,
  ): Promise<{ status: string } & DeleteLocationSummary> {
    return await this.locationsService.deleteLocationOCPI(body);
  }
}
