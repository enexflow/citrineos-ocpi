<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <PartnersTable
    description="Direct (peer-to-peer) CPO partners that push locations and tariffs into this eMSP. Hub-relayed partners are under Hub."
    heading="Peer-to-peer partners"
    :loader="fetchEmspPartners"
    view="emsp"
  />
</template>

<script lang="ts" setup>
  import { fetchEmspPartners } from '@/api/partners'
  import PartnersTable from '@/components/PartnersTable.vue'
</script>
