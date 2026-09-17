// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * main.ts
 *
 * Bootstraps Vuetify and other plugins then mounts the App`
 */

import { createPinia } from 'pinia';

// Composables
import { createApp } from 'vue';

// Plugins
import { registerPlugins } from '@/plugins';

import { useAuthStore } from '@/stores/auth';
// Components
import App from './App.vue';

import 'unfonts.css';
import './styles/tailwind.css';
import './styles/main.scss';

const app = createApp(App);
const pinia = createPinia();
app.use(pinia);

const authStore = useAuthStore();
await authStore.init();

// init() already triggered a Keycloak login/logout redirect when
// unauthenticated or missing the required role — don't mount the app
// underneath that redirect, since router-view has no auth guard of its own.
if (authStore.authenticated) {
  registerPlugins(app);
  app.mount('#app');
}
