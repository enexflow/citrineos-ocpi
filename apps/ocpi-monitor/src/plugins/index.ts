// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

// Types
import type { App } from 'vue';
import { createPinia } from 'pinia';
import router from '../router/index.js';
/**
 * plugins/index.ts
 *
 * Automatically included in `./src/main.ts`
 */

import i18n from './i18n.js';

// Plugins
import vuetify from './vuetify.js';

export function registerPlugins(app: App) {
  app.use(vuetify);
  app.use(createPinia());
  app.use(i18n);
  app.use(router);
}
