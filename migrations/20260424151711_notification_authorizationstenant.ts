// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  up: async (queryInterface: QueryInterface) => {
    // Shared notify function: collects all tenants into an array and fires a single notification
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION "AuthorizationNotify"()
      RETURNS trigger AS $$
      DECLARE
        authorizationData jsonb;
        tenantsData jsonb;
        notificationData jsonb;
        authorizationId integer;
        eventType text;
      BEGIN
        -- Determine authorizationId and eventType
        IF TG_TABLE_NAME = 'AuthorizationTenants' THEN
          IF TG_OP = 'DELETE' THEN
            authorizationId := OLD."authorizationId";
          ELSE
            authorizationId := NEW."authorizationId";
          END IF;
          eventType := TG_OP;
        ELSIF TG_TABLE_NAME = 'Authorizations' THEN
          IF TG_OP = 'DELETE' THEN
            authorizationId := OLD."id";
          ELSE
            authorizationId := NEW."id";
          END IF;
          eventType := TG_OP;
        END IF;
    
        -- Get authorization data
        IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'Authorizations' THEN
          authorizationData := to_jsonb(OLD);
        ELSE
          SELECT to_jsonb(a) INTO authorizationData
          FROM "Authorizations" a
          WHERE a."id" = authorizationId;
        END IF;
    
        -- Get tenants data
        IF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'AuthorizationTenants' THEN
          -- Junction row is being deleted: fetch the single tenant being unlinked
          SELECT jsonb_agg(to_jsonb(t.*)) INTO tenantsData
          FROM "Tenants" t
          WHERE t."id" = OLD."tenantId";
        ELSIF TG_OP = 'DELETE' AND TG_TABLE_NAME = 'Authorizations' THEN
          -- Authorization row is being deleted: at BEFORE DELETE time,
          -- AuthorizationTenants rows still exist (no cascade has run yet)
          SELECT jsonb_agg(to_jsonb(t.*)) INTO tenantsData
          FROM "Tenants" t
          INNER JOIN "AuthorizationTenants" at ON at."tenantId" = t."id"
          WHERE at."authorizationId" = authorizationId;
        ELSE
          -- INSERT/UPDATE: fetch current linked tenants
          SELECT jsonb_agg(to_jsonb(t.*)) INTO tenantsData
          FROM "Tenants" t
          INNER JOIN "AuthorizationTenants" at ON at."tenantId" = t."id"
          WHERE at."authorizationId" = authorizationId;
        END IF;
    
        notificationData := COALESCE(authorizationData, '{}'::jsonb)
          || jsonb_build_object('tenants', COALESCE(tenantsData, '[]'::jsonb));
    
        PERFORM pg_notify(
          'AuthorizationNotification',
          json_build_object(
            'operation', TG_OP,
            'data', notificationData
          )::text
        );
    
        RETURN COALESCE(NEW, OLD);
      END;
      $$ LANGUAGE plpgsql;
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER "AuthorizationTenantNotification"
      AFTER INSERT OR UPDATE OR DELETE ON "AuthorizationTenants"
      FOR EACH ROW
      EXECUTE FUNCTION "AuthorizationNotify"();
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER "AuthorizationNotification"
      AFTER UPDATE ON "Authorizations"
      FOR EACH ROW
      EXECUTE FUNCTION "AuthorizationNotify"();
    `);

    await queryInterface.sequelize.query(`
      CREATE TRIGGER "AuthorizationDeleteNotification"
      BEFORE DELETE ON "Authorizations"
      FOR EACH ROW
      EXECUTE FUNCTION "AuthorizationNotify"();
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS "AuthorizationTenantNotification" ON "AuthorizationTenants";
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS "AuthorizationNotification" ON "Authorizations";
    `);

    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS "AuthorizationDeleteNotification" ON "Authorizations";
    `);

    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS "AuthorizationNotify"();
    `);
  },
};
