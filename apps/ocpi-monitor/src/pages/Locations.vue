<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-6 d-flex flex-wrap align-center justify-space-between ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1" style="color: #153651">
          Locations
        </h1>
        <p class="text-body-2 mb-0" style="color: #587474">
          All locations in the database — our own network and everything
          received from CPO partners (peer-to-peer or via a hub).
        </p>
      </div>

      <v-btn
        color="#3687c9"
        :loading="loading"
        prepend-icon="mdi-refresh"
        variant="flat"
        @click="load"
      >
        Refresh
      </v-btn>
    </div>

    <v-alert
      v-if="error"
      class="mb-4"
      density="comfortable"
      type="error"
      variant="tonal"
    >
      {{ error }}
    </v-alert>

    <LocationsMap class="mb-4" :locations="locations" />

    <v-data-table
      class="partners-table rounded-lg"
      :headers="locationHeaders"
      hover
      item-value="id"
      :items="locations"
      :loading="loading"
    >
      <template #item.ocpiId="{ item }">
        <code class="id-code">{{
          item.ownership === 'partner' ? item.ocpiId : item.id
        }}</code>
      </template>
      <template #item.address="{ item }">
        {{ item.address }}, {{ item.city }} ({{ item.country }})
      </template>
      <template #item.ownership="{ item }">
        <v-chip
          :color="item.ownership === 'partner' ? '#f2b705' : '#3687c9'"
          size="small"
          variant="flat"
        >
          {{ item.ownership === 'partner' ? 'Partner' : 'Our network' }}
        </v-chip>
      </template>
      <template #item.lastUpdated="{ item }">
        {{ formatDate(item.lastUpdated) }}
      </template>
      <template #no-data>
        <div class="py-8 text-center text-medium-emphasis">
          No locations found.
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script lang="ts" setup>
  import type { OcpiLocationReceived } from '@/types/partner'
  import { onMounted, ref } from 'vue'
  import { fetchAllLocationsForMap } from '@/api/locations'
  import LocationsMap from '@/components/LocationsMap.vue'

  const locations = ref<OcpiLocationReceived[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const locationHeaders = [
    { title: 'OCPI location id', key: 'ocpiId' },
    { title: 'Name', key: 'name' },
    { title: 'Address', key: 'address', sortable: false },
    { title: 'Ownership', key: 'ownership' },
    { title: 'EVSEs', key: 'evseCount' },
    { title: 'Last updated', key: 'lastUpdated' },
  ]

  function formatDate (value: string | null) {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleString()
    } catch {
      return value
    }
  }

  async function load () {
    loading.value = true
    error.value = null
    try {
      locations.value = await fetchAllLocationsForMap()
    } catch (error_) {
      locations.value = []
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
</script>

<style scoped>
.partners-table {
  background: #ffffff !important;
  border: 1px solid #c5d3d3;
  overflow: hidden;
}

.id-code {
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  color: #205179;
}
</style>
