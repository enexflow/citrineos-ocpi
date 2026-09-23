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
import CpoHub from '@/pages/cpo/Hub.vue'
import CpoPartnerDetail from '@/pages/cpo/PartnerDetail.vue'
import CpoPartners from '@/pages/cpo/Partners.vue'
import CpoRoamingPartnerDetail from '@/pages/cpo/RoamingPartnerDetail.vue'
import EmspHub from '@/pages/emsp/Hub.vue'
import EmspPartnerDetail from '@/pages/emsp/PartnerDetail.vue'
import EmspPartners from '@/pages/emsp/Partners.vue'
import EmspRoamingPartnerDetail from '@/pages/emsp/RoamingPartnerDetail.vue'
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
          meta: { title: 'eMSP · Peer-to-peer partners' },
        },
        {
          path: 'emsp/partners/:id',
          name: 'emsp-partner-detail',
          component: EmspPartnerDetail,
          meta: { title: 'eMSP · Partner detail' },
        },
        {
          path: 'emsp/hub',
          name: 'emsp-hub',
          component: EmspHub,
          meta: { title: 'eMSP · Hub' },
        },
        {
          path: 'emsp/hub/roaming/:id',
          name: 'emsp-roaming-detail',
          component: EmspRoamingPartnerDetail,
          meta: { title: 'eMSP · Roaming partner detail' },
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
          meta: { title: 'CPO · Peer partners' },
        },
        {
          path: 'cpo/partners/:id',
          name: 'cpo-partner-detail',
          component: CpoPartnerDetail,
          meta: { title: 'CPO · Partner detail' },
        },
        {
          path: 'cpo/hub',
          name: 'cpo-hub',
          component: CpoHub,
          meta: { title: 'CPO · Hub' },
        },
        {
          path: 'cpo/hub/roaming/:id',
          name: 'cpo-roaming-detail',
          component: CpoRoamingPartnerDetail,
          meta: { title: 'CPO · Roaming partner detail' },
        },
      ],
    },
  ],
})

export default router
