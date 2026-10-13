<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <v-app>
    <AppNavigation />
    <v-main>
      <v-container class="app-page" fluid>
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import AppNavigation from '@/components/AppNavigation.vue'
</script>

<style scoped>
/* Comfortable page gutters, and cap the line length on very wide screens */
.app-page {
  max-width: 1480px;
  margin-inline: auto;
  padding: 2rem 2.5rem 4rem;
}

@media (max-width: 840px) {
  .app-page {
    padding: 1.25rem 1rem 3rem;
  }
}
</style>
