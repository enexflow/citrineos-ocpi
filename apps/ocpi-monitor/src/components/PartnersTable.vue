<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-6 d-flex flex-wrap align-center justify-space-between ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1" style="color: #153651">
          {{ heading }}
        </h1>
        <p class="text-body-2 mb-0" style="color: #587474">
          {{ description }}
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

    <v-row class="mb-4" dense>
      <v-col
        v-for="stat in summaryStats"
        :key="stat.label"
        cols="6"
        :lg="view === 'cpo' ? 2 : 3"
        :md="view === 'cpo' ? 4 : 3"
      >
        <div class="stat-tile">
          <div class="stat-tile__label">
            {{ stat.label }}
            <v-tooltip v-if="stat.hint" location="top" max-width="280">
              <template #activator="{ props: tooltipProps }">
                <v-icon
                  v-bind="tooltipProps"
                  class="stat-tile__hint"
                  icon="mdi-information-outline"
                  size="14"
                />
              </template>
              {{ stat.hint }}
            </v-tooltip>
          </div>
          <div class="stat-tile__value">{{ stat.value }}</div>
        </div>
      </v-col>
    </v-row>

    <v-data-table
      class="partners-table partners-table--clickable rounded-lg"
      :headers="headers"
      hover
      item-value="id"
      :items="partners"
      :loading="loading"
      @click:row="onRowClick"
    >
      <template #item.identity="{ item }">
        <div class="py-2">
          <div class="font-weight-medium" style="color: #153651">
            {{ item.name }}
          </div>
          <div class="text-caption" style="color: #587474">
            {{ item.countryCode }}/{{ item.partyId }}
            <span class="mx-1">·</span>
            id {{ item.id }}
          </div>
        </div>
      </template>

      <template #item.role="{ item }">
        <span :class="['role-pill', `role-pill--${roleKey(item.role)}`]">
          {{ item.role }}
        </span>
      </template>

      <template #item.locationCount="{ item }">
        <span class="font-weight-medium">{{ item.locationCount }}</span>
      </template>

      <template #item.tariffCount="{ item }">
        <span class="font-weight-medium">{{ item.tariffCount }}</span>
      </template>

      <template #item.tokenCount="{ item }">
        <span class="font-weight-medium">{{ item.tokenCount }}</span>
      </template>

      <template #item.sessionCount="{ item }">
        <span class="font-weight-medium">{{ item.sessionCount }}</span>
      </template>

      <template #item.sessionsSentCount="{ item }">
        <span class="font-weight-medium">{{ item.sessionsSentCount }}</span>
      </template>

      <template #item.cdrCount="{ item }">
        <span class="font-weight-medium">{{ item.cdrCount }}</span>
      </template>

      <template #item.cdrsSentCount="{ item }">
        <span class="font-weight-medium">{{ item.cdrsSentCount }}</span>
      </template>

      <template #item.actions="{ item }">
        <v-btn
          color="#3687c9"
          size="small"
          variant="text"
          @click.stop="openPartner(item.id)"
        >
          {{ view === 'cpo' ? 'Sent data' : 'Received data' }}
        </v-btn>
      </template>

      <template #item.website="{ item }">
        <a
          v-if="item.website"
          class="text-primary text-decoration-none"
          :href="item.website"
          rel="noopener noreferrer"
          target="_blank"
          @click.stop
        >
          {{ hostLabel(item.website) }}
        </a>
        <span v-else class="text-medium-emphasis">—</span>
      </template>

      <template #no-data>
        <div class="py-8 text-center text-medium-emphasis">
          No partners found for this view.
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script lang="ts" setup>
  import type { PartnerOverview, PartnersView } from '@/types/partner'
  import { computed, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'

  const props = withDefaults(
    defineProps<{
      heading: string
      description: string
      loader: () => Promise<PartnerOverview[]>
      view?: PartnersView
    }>(),
    {
      view: 'emsp',
    },
  )

  const router = useRouter()
  const partners = ref<PartnerOverview[]>([])
  const loading = ref(false)
  const error = ref<string | null>(null)

  const headers = computed(() => {
    const common = [
      { title: 'Partner', key: 'identity', sortable: false },
      { title: 'Role', key: 'role' },
    ]

    if (props.view === 'cpo') {
      return [
        ...common,
        { title: 'Tokens', key: 'tokenCount' },
        { title: 'Tx ended', key: 'sessionCount' },
        { title: 'Sessions (from tx)', key: 'sessionsSentCount' },
        { title: 'CDRs (stored)', key: 'cdrsSentCount' },
        { title: '', key: 'actions', sortable: false },
      ]
    }

    return [
      ...common,
      { title: 'Locations', key: 'locationCount' },
      { title: 'Tariffs', key: 'tariffCount' },
      { title: 'Sessions', key: 'sessionCount' },
      { title: 'CDRs', key: 'cdrCount' },
      { title: 'Website', key: 'website', sortable: false },
      { title: '', key: 'actions', sortable: false },
    ]
  })

  const summaryStats = computed(() => {
    if (props.view === 'cpo') {
      return [
        { label: 'Partners', value: partners.value.length },
        {
          label: 'Tokens',
          value: partners.value.reduce((sum, p) => sum + p.tokenCount, 0),
          hint: 'Authorization/token records we have on file for these partners.',
        },
        {
          label: 'Tx ended',
          value: partners.value.reduce((sum, p) => sum + p.sessionCount, 0),
          hint: 'Transactions that have finished charging (endTime set).',
        },
        {
          label: 'Sessions (tx)',
          value: partners.value.reduce((sum, p) => sum + p.sessionsSentCount, 0),
          hint: 'All transactions for these partners, finished or in progress — one OCPI session per transaction.',
        },
        {
          label: 'CDRs (tx)',
          value: partners.value.reduce((sum, p) => sum + p.cdrsSentCount, 0),
          hint: 'CDRs actually stored in our database as sent to these partners (Cdrs.toTenantPartnerId).',
        },
      ]
    }

    return [
      { label: 'Partners', value: partners.value.length },
      {
        label: 'Locations',
        value: partners.value.reduce((sum, p) => sum + p.locationCount, 0),
      },
      {
        label: 'Tariffs',
        value: partners.value.reduce((sum, p) => sum + p.tariffCount, 0),
      },
      {
        label: 'Sessions',
        value: partners.value.reduce((sum, p) => sum + p.sessionCount, 0),
      },
    ]
  })

  function roleKey (role: string) {
    switch (role) {
      case 'CPO': {
        return 'cpo'
      }
      case 'EMSP': {
        return 'emsp'
      }
      case 'HUB': {
        return 'hub'
      }
      default: {
        return 'other'
      }
    }
  }

  function hostLabel (url: string) {
    try {
      return new URL(url).host
    } catch {
      return url
    }
  }

  function openPartner (id: number) {
    const name = props.view === 'cpo' ? 'cpo-partner-detail' : 'emsp-partner-detail'
    router.push({ name, params: { id: String(id) } })
  }

  function onRowClick (_event: unknown, row: { item: PartnerOverview }) {
    openPartner(row.item.id)
  }

  async function load () {
    loading.value = true
    error.value = null
    try {
      partners.value = await props.loader()
    } catch (error_) {
      partners.value = []
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  onMounted(load)
</script>

<style scoped>
.stat-tile {
  background: #ffffff;
  border: 1px solid #c5d3d3;
  border-left: 4px solid #3687c9;
  border-radius: 0.75rem;
  padding: 1rem 1.1rem;
}

.stat-tile__label {
  color: #587474;
  font-size: 0.75rem;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 0.25rem;
}

.stat-tile__hint {
  cursor: help;
  opacity: 0.7;
}

.stat-tile__value {
  color: #153651;
  font-size: 1.5rem;
  font-weight: 700;
  margin-top: 0.15rem;
}

.partners-table {
  background: #ffffff !important;
  border: 1px solid #c5d3d3;
  overflow: hidden;
}

:deep(.partners-table--clickable .v-data-table__tr) {
  cursor: pointer;
}

.role-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.02em;
}

.role-pill--cpo {
  background: #cff8fc;
  color: #065760;
}

.role-pill--emsp {
  background: #dadff1;
  color: #293a70;
}

.role-pill--hub {
  background: #dde3ee;
  color: #324467;
}

.role-pill--other {
  background: #e2e9e9;
  color: #425757;
}
</style>
