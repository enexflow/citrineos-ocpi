<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <PartnersTable
    description="Direct (peer-to-peer) eMSP partners — tokens and transactions we map to OCPI sessions/CDRs (sender path). Open a partner to see SessionMapper/CdrMapper JSON via OCPI GET. Hub-relayed partners are under Hub."
    heading="Peer partners"
    :loader="fetchCpoPartners"
    view="cpo"
  />
</template>

<script lang="ts" setup>
  import { fetchCpoPartners } from '@/api/partners'
  import PartnersTable from '@/components/PartnersTable.vue'
</script>
