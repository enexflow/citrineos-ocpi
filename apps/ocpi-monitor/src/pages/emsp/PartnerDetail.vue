<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-4">
      <v-btn
        color="#3687c9"
        prepend-icon="mdi-arrow-left"
        variant="text"
        @click="router.push({ name: 'emsp-partners' })"
      >
        Back to partners
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

    <div v-if="loading" class="py-12 text-center" style="color: #587474">
      Loading partner…
    </div>

    <template v-else-if="detail">
      <div class="mb-6 d-flex flex-wrap align-end justify-space-between ga-3">
        <div>
          <div class="overview-kicker mb-2">Received &amp; stored</div>
          <h1 class="text-h4 font-weight-bold mb-1" style="color: #153651">
            {{ detail.partner.name }}
          </h1>
          <p class="text-body-1 mb-0" style="color: #587474">
            {{ detail.partner.countryCode }}/{{ detail.partner.partyId }} ·
            {{ detail.partner.role }} · id {{ detail.partner.id }}
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

      <v-row class="mb-6" dense>
        <v-col
          v-for="stat in stats"
          :key="stat.label"
          cols="6"
          lg="2"
          md="4"
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

      <v-tabs v-model="tab" class="mb-4" color="#3687c9">
        <v-tab value="locations">
          Locations ({{ detail.locations.length }})
        </v-tab>
        <v-tab value="sessions">
          Sessions ({{ detail.sessions.length }})
        </v-tab>
        <v-tab value="cdrs">
          CDRs ({{ detail.cdrs.length }})
        </v-tab>
      </v-tabs>

      <v-tabs-window v-model="tab">
        <v-tabs-window-item value="locations">
          <p class="text-body-2 mb-3" style="color: #587474">
            Locations pushed to us by this CPO/HUB partner
            (Locations.ownerTenantPartnerId).
          </p>
          <LocationsMap class="mb-4" :locations="detail.locations" />
          <v-data-table
            class="partners-table rounded-lg"
            :headers="locationHeaders"
            hover
            item-value="id"
            :items="detail.locations"
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
                No locations received from this partner yet.
              </div>
            </template>
          </v-data-table>
        </v-tabs-window-item>

        <v-tabs-window-item value="sessions">
          <p class="text-body-2 mb-3" style="color: #587474">
            Sessions received and stored for this partner (Sessions.tenantPartnerId).
          </p>
          <v-data-table
            class="partners-table rounded-lg"
            :headers="sessionHeaders"
            hover
            item-value="id"
            :items="detail.sessions"
          >
            <template #item.ocpiSessionId="{ item }">
              <code class="id-code">{{ item.ocpiSessionId }}</code>
            </template>
            <template #item.status="{ item }">
              <span class="role-pill role-pill--hub">{{
                item.status ?? '—'
              }}</span>
            </template>
            <template #item.kwh="{ item }">
              {{ formatNumber(item.kwh) }}
            </template>
            <template #item.totalCost="{ item }">
              {{ formatCost(item.totalCost, item.currency) }}
            </template>
            <template #item.startDateTime="{ item }">
              {{ formatDate(item.startDateTime) }}
            </template>
            <template #item.endDateTime="{ item }">
              {{ formatDate(item.endDateTime) }}
            </template>
            <template #no-data>
              <div class="py-8 text-center text-medium-emphasis">
                No sessions received from this partner yet.
              </div>
            </template>
          </v-data-table>
        </v-tabs-window-item>

        <v-tabs-window-item value="cdrs">
          <p class="text-body-2 mb-3" style="color: #587474">
            CDRs received from this partner (Cdrs.fromTenantPartnerId) — money we owe them.
          </p>
          <v-data-table
            class="partners-table rounded-lg"
            :headers="cdrHeaders"
            hover
            item-value="id"
            :items="detail.cdrs"
          >
            <template #item.ocpiCdrId="{ item }">
              <code class="id-code">{{ item.ocpiCdrId }}</code>
            </template>
            <template #item.sessionId="{ item }">
              <code class="id-code">{{ item.sessionId ?? '—' }}</code>
            </template>
            <template #item.totalEnergy="{ item }">
              {{ formatNumber(item.totalEnergy) }}
            </template>
            <template #item.totalCost="{ item }">
              {{ formatCost(item.totalCost, item.currency) }}
            </template>
            <template #item.startDateTime="{ item }">
              {{ formatDate(item.startDateTime) }}
            </template>
            <template #item.endDateTime="{ item }">
              {{ formatDate(item.endDateTime) }}
            </template>
            <template #no-data>
              <div class="py-8 text-center text-medium-emphasis">
                No CDRs received from this partner yet.
              </div>
            </template>
          </v-data-table>
        </v-tabs-window-item>
      </v-tabs-window>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type { EmspPartnerDetail } from '@/types/partner'
  import { computed, onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { fetchEmspPartnerDetail } from '@/api/partners'
  import LocationsMap from '@/components/LocationsMap.vue'

  const route = useRoute()
  const router = useRouter()
  const detail = ref<EmspPartnerDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const tab = ref('locations')

  const locationHeaders = [
    { title: 'OCPI location id', key: 'ocpiId' },
    { title: 'Name', key: 'name' },
    { title: 'Address', key: 'address', sortable: false },
    { title: 'EVSEs', key: 'evseCount' },
    { title: 'Last updated', key: 'lastUpdated' },
  ]

  const sessionHeaders = [
    { title: 'OCPI session id', key: 'ocpiSessionId' },
    { title: 'Status', key: 'status' },
    { title: 'Start', key: 'startDateTime' },
    { title: 'End', key: 'endDateTime' },
    { title: 'kWh', key: 'kwh' },
    { title: 'Cost', key: 'totalCost' },
  ]

  const cdrHeaders = [
    { title: 'OCPI CDR id', key: 'ocpiCdrId' },
    { title: 'Session id', key: 'sessionId' },
    { title: 'Start', key: 'startDateTime' },
    { title: 'End', key: 'endDateTime' },
    { title: 'Energy', key: 'totalEnergy' },
    { title: 'Cost', key: 'totalCost' },
  ]

  const stats = computed(() => {
    const d = detail.value
    if (!d) return []
    return [
      { label: 'Locations', value: d.locations.length },
      { label: 'Sessions', value: d.sessions.length },
      { label: 'CDRs', value: d.cdrs.length },
      {
        label: 'Total kWh',
        value: formatNumber(d.totalKwh),
        hint: 'Sum of kwh across all sessions received and stored for this partner (Sessions_aggregate.sum.kwh).',
      },
      {
        label: 'Total owed',
        value: totalOwed.value,
        hint: 'Sum of CDR totalCost (incl. VAT when available) across all currencies received from this partner — money we owe them.',
      },
    ]
  })

  const totalOwed = computed(() => {
    const d = detail.value
    if (!d) return '—'
    const byCurrency = new Map<string, number>()
    for (const cdr of d.cdrs) {
      byCurrency.set(
        cdr.currency,
        (byCurrency.get(cdr.currency) ?? 0) + amountOf(cdr.totalCost),
      )
    }
    if (byCurrency.size === 0) return '—'
    return [...byCurrency.entries()]
      .map(([currency, amount]) => `${formatNumber(amount)} ${currency}`)
      .join(', ')
  })

  function amountOf (totalCost: unknown): number {
    if (typeof totalCost === 'number') return totalCost
    if (totalCost != null && typeof totalCost === 'object') {
      const price = totalCost as { incl_vat?: number | null, excl_vat?: number }
      return price.incl_vat ?? price.excl_vat ?? 0
    }
    return 0
  }

  function formatDate (value: string | null) {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleString()
    } catch {
      return value
    }
  }

  function formatNumber (value: number | null) {
    if (value == null || Number.isNaN(value)) return '—'
    return value.toLocaleString(undefined, { maximumFractionDigits: 3 })
  }

  function formatCost (value: unknown, currency: string) {
    if (value == null) return '—'
    if (typeof value === 'number') return `${formatNumber(value)} ${currency}`
    if (typeof value === 'object' && value !== null && 'incl_vat' in value) {
      const incl = (value as { incl_vat?: number }).incl_vat
      return incl == null ? JSON.stringify(value) : `${formatNumber(incl)} ${currency}`
    }
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  async function load () {
    const id = Number(route.params.id)
    if (!Number.isFinite(id)) {
      error.value = 'Invalid partner id'
      detail.value = null
      return
    }

    loading.value = true
    error.value = null
    try {
      detail.value = await fetchEmspPartnerDetail(id)
      if (!detail.value) error.value = `Partner ${id} not found`
    } catch (error_) {
      detail.value = null
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  watch(() => route.params.id, load)
  onMounted(load)
</script>

<style scoped>
.overview-kicker {
  display: inline-block;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: #dadff1;
  color: #293a70;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

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

.id-code {
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  color: #205179;
}

.role-pill {
  display: inline-flex;
  align-items: center;
  padding: 0.15rem 0.55rem;
  border-radius: 999px;
  font-size: 0.75rem;
  font-weight: 700;
}

.role-pill--hub {
  background: #dde3ee;
  color: #324467;
}
</style>
