// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

import { fileURLToPath, URL } from 'node:url';
import tailwindcss from '@tailwindcss/vite';
import Vue from '@vitejs/plugin-vue';
import Fonts from 'unplugin-fonts/vite';
import { defineConfig, loadEnv } from 'vite';
import Vuetify, { transformAssetUrls } from 'vite-plugin-vuetify';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, fileURLToPath(new URL('.', import.meta.url)), '');
  const hasuraTarget = env.VITE_HASURA_TARGET || 'http://localhost:8491';

  return {
    plugins: [
      tailwindcss(),
      Vue({
        template: { transformAssetUrls },
      }),
      Vuetify({
        autoImport: true,
        styles: {
          configFile: 'src/styles/settings.scss',
        },
      }),
      Fonts({
        fontsource: {
          families: [
            {
              name: 'Roboto Mono',
              weights: [400, 700],
            },
            {
              name: 'Roboto',
              weights: [100, 300, 400, 500, 700, 900],
              styles: ['normal', 'italic'],
            },
          ],
        },
      }),
    ],
    define: { 'process.env': {} },
    resolve: {
      alias: {
        '@': fileURLToPath(new URL('src', import.meta.url)),
      },
      extensions: ['.js', '.json', '.jsx', '.mjs', '.ts', '.tsx', '.vue'],
    },
    server: {
      port: 3000,
      proxy: {
        '/graphql': {
          target: hasuraTarget,
          changeOrigin: true,
          rewrite: (pathName) => pathName.replace(/^\/graphql/, '/v1/graphql'),
        },
        '/ocpi': {
          target: env.VITE_OCPI_TARGET || 'http://localhost:8085',
          changeOrigin: true,
        },
      },
      allowedHosts: ['driftless-overcommon-cynthia.ngrok-free.dev'],
    },
  };
});
