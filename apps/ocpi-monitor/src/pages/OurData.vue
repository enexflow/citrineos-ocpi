<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-6 d-flex flex-wrap align-center justify-space-between ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1" style="color: #153651">
          Our data
        </h1>
        <p class="text-body-2 mb-0" style="color: #587474">
          Our own network — locations we operate directly (not received from a
          partner, not roaming) and published over OCPI.
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

    <v-tabs v-model="tab" class="mb-4" color="#3687c9">
      <v-tab value="locations"> Locations ({{ locations.length }}) </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="locations">
        <p class="text-body-2 mb-3" style="color: #587474">
          Locations with <code>ownerTenantPartnerId</code> and
          <code>roamingPartnerId</code> null, not deleted, and
          <code>disableOCPI</code> not true.
        </p>
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
            <code class="id-code">{{ item.ocpiId }}</code>
          </template>
          <template #item.address="{ item }">
            {{ item.address }}, {{ item.city }} ({{ item.country }})
          </template>
          <template #item.lastUpdated="{ item }">
            {{ formatDate(item.lastUpdated) }}
          </template>
          <template #no-data>
            <div class="py-8 text-center text-medium-emphasis">
              No OCPI-enabled locations found.
            </div>
          </template>
        </v-data-table>
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

<script lang="ts" setup>
import type { OcpiLocationReceived } from '@/types/partner';
import { onMounted, ref } from 'vue';
import { fetchOurLocations } from '@/api/ourData';
import LocationsMap from '@/components/LocationsMap.vue';

const locations = ref<OcpiLocationReceived[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const tab = ref('locations');

const locationHeaders = [
  { title: 'OCPI location id', key: 'ocpiId' },
  { title: 'Name', key: 'name' },
  { title: 'Address', key: 'address', sortable: false },
  { title: 'EVSEs', key: 'evseCount' },
  { title: 'Last updated', key: 'lastUpdated' },
];

function formatDate(value: string | null) {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return value;
  }
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    locations.value = await fetchOurLocations();
  } catch (error_) {
    locations.value = [];
    error.value = error_ instanceof Error ? error_.message : String(error_);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
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
