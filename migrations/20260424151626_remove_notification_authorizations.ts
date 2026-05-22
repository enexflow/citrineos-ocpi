// SPDX-FileCopyrightText: 2025 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

'use strict';

import type { QueryInterface } from 'sequelize';

export default {
  up: async (queryInterface: QueryInterface) => {
    await queryInterface.sequelize.query(`
      DROP TRIGGER IF EXISTS "AuthorizationNotification" ON "Authorizations";
    `);

    await queryInterface.sequelize.query(`
      DROP FUNCTION IF EXISTS "AuthorizationNotify"();
    `);
  },

  down: async (queryInterface: QueryInterface) => {
    // Recreate the old (broken) function and trigger if rolling back
    await queryInterface.sequelize.query(`
      CREATE OR REPLACE FUNCTION "AuthorizationNotify"()
      RETURNS trigger AS $$
      DECLARE
        tenantId integer;
      BEGIN
        PERFORM pg_notify(
          'AuthorizationNotification',
          json_build_object('operation', TG_OP, 'data', to_jsonb(NEW))::text
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
};
