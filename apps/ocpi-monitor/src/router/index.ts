// SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project
//
// SPDX-License-Identifier: Apache-2.0

/**
 * router/index.ts
 *
 * Manual routes for ./src/pages/*.vue
 */

import { createRouter, createWebHistory } from 'vue-router'
import AppLayout from '@/layouts/AppLayout.vue'
import CpoPartnerDetail from '@/pages/cpo/PartnerDetail.vue'
import CpoPartners from '@/pages/cpo/Partners.vue'
import EmspPartnerDetail from '@/pages/emsp/PartnerDetail.vue'
import EmspPartners from '@/pages/emsp/Partners.vue'
import Home from '@/pages/index.vue'
import OurData from '@/pages/OurData.vue'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      component: AppLayout,
      children: [
        {
          path: '',
          name: 'home',
          component: Home,
          meta: { title: 'Overview' },
        },
        {
          path: 'emsp/partners',
          name: 'emsp-partners',
          component: EmspPartners,
          meta: { title: 'eMSP · Partners' },
        },
        {
          path: 'emsp/partners/:id',
          name: 'emsp-partner-detail',
          component: EmspPartnerDetail,
          meta: { title: 'eMSP · Partner detail' },
        },
        {
          path: 'cpo/our-data',
          name: 'cpo-our-data',
          component: OurData,
          meta: { title: 'CPO · Our data' },
        },
        {
          path: 'cpo/partners',
          name: 'cpo-partners',
          component: CpoPartners,
          meta: { title: 'CPO · Partners' },
        },
        {
          path: 'cpo/partners/:id',
          name: 'cpo-partner-detail',
          component: CpoPartnerDetail,
          meta: { title: 'CPO · Partner detail' },
        },
      ],
    },
  ],
})

export default router
