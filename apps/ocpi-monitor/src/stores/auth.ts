// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import Keycloak from 'keycloak-js';
import { defineStore } from 'pinia';
import { readEnv } from '@/config';

let keycloak: Keycloak | undefined;

export const useAuthStore = defineStore('auth', {
  state: () => ({
    authenticated: false,
    initialized: false,
  }),
  actions: {
    async init() {
      const url = readEnv('VITE_KEYCLOAK_URL');
      const realm = readEnv('VITE_KEYCLOAK_REALM');

      if (!url || !realm) {
        throw new Error(
          'Keycloak is not configured: VITE_KEYCLOAK_URL/VITE_KEYCLOAK_REALM are required.',
        );
      }

      keycloak = new Keycloak({
        url,
        realm,
        clientId: readEnv('VITE_KEYCLOAK_CLIENT_ID') ?? 'ocpi-monitor',
      });

      this.authenticated = await keycloak.init({
        onLoad: 'login-required',
        checkLoginIframe: false,
        pkceMethod: 'S256',
      });

      const clientId = readEnv('VITE_KEYCLOAK_CLIENT_ID') ?? 'ocpi-monitor';
      const roles = keycloak.resourceAccess?.[clientId]?.roles ?? [];
      if (this.authenticated && !roles.includes('ocpi-monitor-user')) {
        this.authenticated = false;
        await keycloak.logout({ redirectUri: `${window.location.origin}/` });
        return;
      }

      this.initialized = true;
    },
    login() {
      return keycloak?.login();
    },
    logout() {
      return keycloak?.logout({ redirectUri: `${window.location.origin}/` });
    },
    async getToken(): Promise<string | undefined> {
      if (!keycloak) {
        return undefined;
      }
      await keycloak.updateToken(30);
      return keycloak.token;
    },
  },
});
