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
  getters: {
    enabled(): boolean {
      return Boolean(
        readEnv('VITE_KEYCLOAK_URL') && readEnv('VITE_KEYCLOAK_REALM'),
      );
    },
  },
  actions: {
    async init() {
      if (!this.enabled) {
        this.initialized = true;
        return;
      }

      keycloak = new Keycloak({
        url: readEnv('VITE_KEYCLOAK_URL')!,
        realm: readEnv('VITE_KEYCLOAK_REALM')!,
        clientId: readEnv('VITE_KEYCLOAK_CLIENT_ID') ?? 'ocpi-monitor',
      });

      this.authenticated = await keycloak.init({
        onLoad: 'login-required',
        checkLoginIframe: false,
        pkceMethod: 'S256',
      });
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
