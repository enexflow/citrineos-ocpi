<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <v-app>
    <AppNavigation />
    <v-main>
      <v-container class="py-6" fluid>
        <router-view />
      </v-container>
    </v-main>
  </v-app>
</template>

<script lang="ts" setup>
  import AppNavigation from '@/components/AppNavigation.vue'
</script>
