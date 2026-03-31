// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION "AuthorizationNotify"()
      RETURNS trigger AS $$
      DECLARE
        requiredFields text[] := ARRAY['id', 'tenantId', 'updatedAt'];
        requiredData jsonb;
        changedData jsonb;
        notificationData jsonb;
        tenantData jsonb;
        tenantId integer;
      BEGIN
        IF TG_OP = 'INSERT' THEN
          notificationData := to_jsonb(NEW);
          tenantId := NEW."tenantId";
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

          notificationData := requiredData || COALESCE(changedData, '{}'::jsonb);
          tenantId := NEW."tenantId";
        END IF;

        SELECT row_to_json(t) INTO tenantData FROM (
          SELECT * FROM "Tenants" WHERE "id" = tenantId
        ) t;

        IF tenantData IS NOT NULL THEN
          notificationData := notificationData || jsonb_build_object('tenant', tenantData);
        END IF;

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
      CREATE TRIGGER "AuthorizationNotification"
      AFTER INSERT OR UPDATE ON "Authorizations"
      FOR EACH ROW
      EXECUTE FUNCTION "AuthorizationNotify"();
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS "AuthorizationNotification" ON "Authorizations";
    `);

    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS "AuthorizationNotify"();
    `);
  },
};
