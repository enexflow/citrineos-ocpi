<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <v-navigation-drawer
    v-model="drawer"
    class="brand-drawer"
    color="#153651"
    :permanent="!mobile"
    :temporary="mobile"
    theme="dark"
    width="272"
  >
    <div class="brand-drawer__header px-5 py-6">
      <div class="brand-drawer__mark mb-3">
        <v-icon color="#0edaf1" icon="mdi-lightning-bolt" size="28" />
      </div>
      <div
        class="text-caption text-uppercase"
        style="color: #86b7df; letter-spacing: 0.12em"
      >
        OCPI Monitor
      </div>
      <div class="text-h5 font-weight-bold text-white mt-1">CitrineOS</div>
    </div>

    <v-list
      bg-color="transparent"
      class="px-3"
      color="#0edaf1"
      density="comfortable"
      nav
    >
      <v-list-item
        base-color="#aecfea"
        prepend-icon="mdi-view-dashboard-outline"
        rounded="lg"
        title="Overview"
        :to="{ name: 'home' }"
      />

      <v-list-subheader class="mt-4 mb-1"> Views </v-list-subheader>

      <v-list-group fluid value="emsp">
        <template #activator="{ props }">
          <v-list-item
            v-bind="props"
            base-color="#aecfea"
            prepend-icon="mdi-cellphone-wireless"
            subtitle="Received from CPOs"
            title="eMSP"
          />
        </template>

        <v-list-item
          base-color="#aecfea"
          prepend-icon="mdi-account-group-outline"
          rounded="lg"
          title="Partners"
          :to="{ name: 'emsp-partners' }"
        />
      </v-list-group>

      <v-list-group fluid value="cpo">
        <template #activator="{ props }">
          <v-list-item
            v-bind="props"
            base-color="#aecfea"
            prepend-icon="mdi-ev-station"
            subtitle="Our network"
            title="CPO"
          />
        </template>

        <v-list-item
          base-color="#aecfea"
          prepend-icon="mdi-account-group-outline"
          rounded="lg"
          title="Partners"
          :to="{ name: 'cpo-partners' }"
        />

        <v-list-item
          base-color="#aecfea"
          prepend-icon="mdi-map-marker-outline"
          rounded="lg"
          title="Our data"
          :to="{ name: 'cpo-our-data' }"
        />
      </v-list-group>
    </v-list>

    <template #append>
      <v-list
        v-if="authStore.enabled"
        bg-color="transparent"
        class="px-3 py-2"
        color="#0edaf1"
        density="comfortable"
        nav
      >
        <v-list-item
          base-color="#aecfea"
          prepend-icon="mdi-logout"
          rounded="lg"
          title="Log out"
          @click="authStore.logout()"
        />
      </v-list>
    </template>
  </v-navigation-drawer>

  <v-app-bar class="brand-app-bar" color="#f0f4f4" elevation="0" flat>
    <template v-if="mobile" #prepend>
      <v-app-bar-nav-icon @click="drawer = !drawer" />
    </template>

    <v-app-bar-title class="font-weight-bold" style="color: #153651">
      {{ title }}
    </v-app-bar-title>

    <template #append>
      <v-chip class="mr-3" color="#3687c9" size="small" variant="flat">
        {{ viewLabel }}
      </v-chip>
    </template>
  </v-app-bar>
</template>

<script lang="ts" setup>
  import { computed, ref, watch } from 'vue'
  import { useRoute } from 'vue-router'
  import { useDisplay } from 'vuetify'
  import { useAuthStore } from '@/stores/auth'

  const route = useRoute()
  const { mobile } = useDisplay()
  const drawer = ref(!mobile.value)
  const authStore = useAuthStore()

  watch(mobile, isMobile => {
    drawer.value = !isMobile
  })

  const title = computed(() => (route.meta.title as string) ?? 'OCPI Monitor')
  const viewLabel = computed(() => {
    if (route.path.startsWith('/cpo')) return 'CPO view'
    if (route.path.startsWith('/emsp')) return 'eMSP view'
    if (route.name === 'home') return 'Overview'
    return 'Monitor'
  })
</script>

<style scoped>
.brand-drawer {
  border-right: none !important;
  background: #153651 !important;
}

.brand-drawer__mark {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  background: color-mix(in srgb, #0edaf1 18%, transparent);
  border: 1px solid color-mix(in srgb, #0edaf1 35%, transparent);
}

.brand-app-bar {
  border-bottom: 1px solid #c5d3d3 !important;
}
</style>
