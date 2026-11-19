// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import type { QueryInterface } from 'sequelize';

// Pairs with the core "Connectors"."disableOCPI" column
// (citrineos-core 20261118100000-add-disableOCPI-connector); safe to run before it.
export default {
  up: async (queryInterface: QueryInterface) => {
    // merge the connector's own disableOCPI into the payload flag
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION "ConnectorNotify"()
      RETURNS trigger AS $$
      DECLARE
        requiredFields text[] := ARRAY['id', 'tenantId', 'updatedAt', 'stationId', 'evseId'];
        requiredData jsonb;
        changedData jsonb;
        notificationData jsonb;
        tenantData jsonb;
        disableOcpiVal boolean;
        connectorDisableOcpiVal boolean;
        tenantId integer;
        isStatusChanged boolean := false;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          notificationData := to_jsonb(NEW);
          tenantId := NEW."tenantId";
          isStatusChanged := true;
        ELSIF TG_OP = 'UPDATE' THEN
          SELECT jsonb_object_agg(key, value) INTO requiredData
          FROM jsonb_each(to_jsonb(NEW))
          WHERE key = ANY(requiredFields);

          SELECT jsonb_object_agg(n.key, n.value) INTO changedData
          FROM jsonb_each(to_jsonb(NEW)) n
          JOIN jsonb_each(to_jsonb(OLD)) o ON n.key = o.key
          WHERE n.value IS DISTINCT FROM o.value
          AND n.key != ALL(requiredFields);

          IF changedData IS NULL OR changedData = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
          END IF;

          isStatusChanged := changedData ? 'status';

          notificationData := requiredData || COALESCE(changedData, '{}'::jsonb);
          tenantId := NEW."tenantId";
        END IF;

        SELECT row_to_json(t) INTO tenantData FROM (
          SELECT * FROM "Tenants" WHERE "id" = tenantId
        ) t;

        IF tenantData IS NOT NULL THEN
          notificationData := notificationData || jsonb_build_object('tenant', tenantData);
        END IF;

        SELECT l."disableOCPI" INTO disableOcpiVal
        FROM "ChargingStations" cs
        JOIN "Locations" l ON l."id" = cs."locationId"
        WHERE cs."id" = NEW."stationId";

        -- the connector's own flag; read via jsonb so this is null-safe (not an
        -- error) if the core column is not there yet
        connectorDisableOcpiVal := COALESCE((to_jsonb(NEW)->>'disableOCPI')::boolean, false);

        -- disableOCPI = location flag OR connector flag, so consumers checking
        -- this key skip both; connectorDisableOCPI = connector flag alone.
        -- Set explicitly: on UPDATE the payload only carries changed columns.
        notificationData := notificationData || jsonb_build_object(
          'disableOCPI', COALESCE(disableOcpiVal, false) OR connectorDisableOcpiVal,
          'connectorDisableOCPI', connectorDisableOcpiVal
        );

        PERFORM pg_notify(
          'ConnectorNotification',
          json_build_object(
            'operation', TG_OP,
            'isStatusChanged', isStatusChanged,
            'data', notificationData
          )::text
        );

        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    // back to 20260717150200: location flag only
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION "ConnectorNotify"()
      RETURNS trigger AS $$
      DECLARE
        requiredFields text[] := ARRAY['id', 'tenantId', 'updatedAt', 'stationId', 'evseId'];
        requiredData jsonb;
        changedData jsonb;
        notificationData jsonb;
        tenantData jsonb;
        disableOcpiVal boolean;
        tenantId integer;
        isStatusChanged boolean := false;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          notificationData := to_jsonb(NEW);
          tenantId := NEW."tenantId";
          isStatusChanged := true;
        ELSIF TG_OP = 'UPDATE' THEN
          SELECT jsonb_object_agg(key, value) INTO requiredData
          FROM jsonb_each(to_jsonb(NEW))
          WHERE key = ANY(requiredFields);

          SELECT jsonb_object_agg(n.key, n.value) INTO changedData
          FROM jsonb_each(to_jsonb(NEW)) n
          JOIN jsonb_each(to_jsonb(OLD)) o ON n.key = o.key
          WHERE n.value IS DISTINCT FROM o.value
          AND n.key != ALL(requiredFields);

          IF changedData IS NULL OR changedData = '{}'::jsonb THEN
            RETURN COALESCE(NEW, OLD);
          END IF;

          isStatusChanged := changedData ? 'status';

          notificationData := requiredData || COALESCE(changedData, '{}'::jsonb);
          tenantId := NEW."tenantId";
        END IF;

        SELECT row_to_json(t) INTO tenantData FROM (
          SELECT * FROM "Tenants" WHERE "id" = tenantId
        ) t;

        IF tenantData IS NOT NULL THEN
          notificationData := notificationData || jsonb_build_object('tenant', tenantData);
        END IF;

        SELECT l."disableOCPI" INTO disableOcpiVal
        FROM "ChargingStations" cs
        JOIN "Locations" l ON l."id" = cs."locationId"
        WHERE cs."id" = NEW."stationId";

        notificationData := notificationData || jsonb_build_object('disableOCPI', COALESCE(disableOcpiVal, false));

        PERFORM pg_notify(
          'ConnectorNotification',
          json_build_object(
            'operation', TG_OP,
            'isStatusChanged', isStatusChanged,
            'data', notificationData
          )::text
        );

        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);
  },
};
