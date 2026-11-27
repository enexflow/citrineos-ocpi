<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-8 d-flex flex-wrap align-center justify-space-between ga-4">
      <div>
        <h1 class="text-headline-medium font-weight-bold mb-1" style="color: #153651">
          Our data
        </h1>
        <p class="text-body-medium mb-0" style="color: #587474">
          Our own network — locations we operate directly (not received from a
          partner, not roaming), with their roaming state and Gireve static
          data checks.
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

    <v-alert
      v-if="complianceError"
      class="mb-4"
      density="comfortable"
      title="Gireve compliance unavailable"
      type="warning"
      variant="tonal"
    >
      {{ complianceError }}
    </v-alert>

    <v-tabs v-model="tab" class="mb-6" color="#3687c9">
      <v-tab value="locations"> Locations ({{ filteredLocations.length }}) </v-tab>
    </v-tabs>

    <v-tabs-window v-model="tab">
      <v-tabs-window-item value="locations">
        <div class="d-flex flex-wrap align-center justify-space-between ga-4 mb-3">
          <p class="text-body-medium mb-0" style="color: #587474">
            Locations with <code>ownerTenantPartnerId</code> and
            <code>roamingPartnerId</code> null and not deleted. Roaming off
            means <code>disableOCPI</code> is true: partners do not see it.
          </p>
          <v-btn-toggle
            v-model="roamingFilter"
            color="#3687c9"
            density="compact"
            mandatory
            variant="outlined"
          >
            <v-btn value="enabled">Roaming on</v-btn>
            <v-btn value="disabled">Roaming off</v-btn>
            <v-btn value="all">All</v-btn>
          </v-btn-toggle>
        </div>
        <LocationsMap class="mb-4" :locations="filteredLocations" />
        <v-data-table
          class="partners-table rounded-lg"
          :headers="locationHeaders"
          hover
          item-value="id"
          :items="filteredLocations"
          :loading="loading"
          show-expand
        >
          <template #item.disableOCPI="{ item }">
            <v-chip
              :color="item.disableOCPI ? 'grey' : 'cpo'"
              size="small"
              variant="tonal"
            >
              {{ item.disableOCPI ? 'Off' : 'On' }}
            </v-chip>
          </template>
          <template #item.compliance="{ item }">
            <v-chip
              :color="complianceChip(complianceById.get(item.id)).color"
              :prepend-icon="complianceChip(complianceById.get(item.id)).icon"
              size="small"
              variant="tonal"
            >
              {{ complianceChip(complianceById.get(item.id)).label }}
            </v-chip>
          </template>
          <template #expanded-row="{ columns, item }">
            <tr>
              <td class="compliance-row" :colspan="columns.length">
                <GireveComplianceDetail
                  :compliance="complianceById.get(item.id)"
                />
              </td>
            </tr>
          </template>
          <template #item.ocpiId="{ item }">
            <code class="id-code">{{ item.ocpiId }}</code>
          </template>
          <template #item.address="{ item }">
            {{ item.address }}, {{ item.city }} ({{ item.country }})
          </template>
          <template #item.tariffs="{ item }">
            <div class="tariff-chips">
              <v-tooltip
                v-for="tariff in item.tariffs"
                :key="tariff.ocpiTariffId"
                location="top"
                max-width="360"
              >
                <template #activator="{ props: tooltipProps }">
                  <v-chip
                    v-bind="tooltipProps"
                    :class="[
                      'tariff-chip',
                      { 'tariff-chip--inactive': tariff.appliesNowOn === 0 },
                    ]"
                    color="#3687c9"
                    size="small"
                    variant="tonal"
                  >
                    <v-icon
                      v-if="tariff.appliesNowOn > 0"
                      class="mr-1"
                      icon="mdi-check-circle"
                      size="14"
                    />
                    <span class="tariff-chip__id">{{ tariff.ocpiTariffId }}</span>
                    <span class="tariff-chip__price">
                      {{ energyPriceLabel(tariff) }}
                    </span>
                    <span
                      v-if="tariff.connectorCount < item.connectorCount"
                      class="tariff-chip__coverage"
                    >
                      {{ tariff.connectorCount }}/{{ item.connectorCount }}
                    </span>
                  </v-chip>
                </template>
                <div class="text-body-small tariff-tip">
                  <div class="font-weight-bold mb-1">
                    Tariff {{ tariff.ocpiTariffId }}
                    <span v-if="tariff.id != null">· id {{ tariff.id }}</span>
                  </div>
                  <div class="mb-1">
                    <template v-if="tariff.appliesNowOn > 0">
                      Applies now on {{ tariff.appliesNowOn }} of
                      {{ item.connectorCount }} connector{{
                        item.connectorCount === 1 ? '' : 's'
                      }}
                    </template>
                    <template v-else>
                      Not applied right now (outside validity or another
                      tariff is picked first)
                    </template>
                    · on {{ tariff.connectorCount }} in total
                  </div>
                  <div>
                    Valid: {{ formatDay(tariff.startDateTime) }} →
                    {{ formatDay(tariff.endDateTime) }} · Tax rate:
                    {{ tariff.taxRate == null ? '—' : `${tariff.taxRate}%` }}
                  </div>

                  <div v-if="tariff.elements.length === 0" class="mt-2">
                    No TariffElements — session cost will be 0.
                  </div>
                  <div
                    v-for="(element, index) in tariff.elements"
                    :key="index"
                    class="tariff-tip__element"
                  >
                    <div class="font-weight-bold">
                      Element {{ index + 1 }}
                      <span v-if="index === 0">(used for session cost)</span>
                    </div>
                    <div
                      v-for="(component, cIndex) in element.priceComponents"
                      :key="cIndex"
                    >
                      {{ component.type }}:
                      {{ priceLabel(component.price, tariff.currency) }}{{
                        PRICE_UNIT[component.type] ?? ''
                      }}
                      <span v-if="component.vat != null">
                        · VAT {{ component.vat }}%
                      </span>
                      <span v-if="component.stepSize != null">
                        · step {{ component.stepSize }}
                      </span>
                    </div>
                    <div v-if="element.restrictions" class="tariff-tip__restrictions">
                      Restrictions: {{ restrictionsLabel(element.restrictions) }}
                    </div>
                  </div>
                </div>
              </v-tooltip>

              <v-tooltip
                v-if="item.tariffs.length === 0"
                location="top"
                max-width="300"
              >
                <template #activator="{ props: tooltipProps }">
                  <v-chip
                    v-bind="tooltipProps"
                    color="#c9583e"
                    prepend-icon="mdi-alert-outline"
                    size="small"
                    variant="tonal"
                  >
                    No tariff
                  </v-chip>
                </template>
                No ConnectorTariff on any of this location's connectors — the
                OCPI location is published with empty tariff_ids.
              </v-tooltip>
            </div>
          </template>
          <template #item.lastUpdated="{ item }">
            {{ formatDate(item.lastUpdated) }}
          </template>
          <template #no-data>
            <div class="py-8 text-center text-medium-emphasis">
              No location matches this roaming filter.
            </div>
          </template>
        </v-data-table>
      </v-tabs-window-item>
    </v-tabs-window>
  </div>
</template>

<script lang="ts" setup>
  import type { LocationCompliance } from '@/types/gireveCompliance'
  import type { LocationTariff, OurLocation } from '@/types/partner'
  import { computed, onMounted, ref } from 'vue'
  import {
    complianceChip,
    complianceSortValue,
    fetchGireveCompliance,
    filterByRoaming,
    type RoamingFilter,
  } from '@/api/gireveCompliance'
  import { fetchOurLocations } from '@/api/ourData'
  import GireveComplianceDetail from '@/components/GireveComplianceDetail.vue'
  import LocationsMap from '@/components/LocationsMap.vue'

  const locations = ref<OurLocation[]>([])
  const complianceById = ref(new Map<number, LocationCompliance>())
  const loading = ref(false)
  const error = ref<string | null>(null)
  const complianceError = ref<string | null>(null)
  const tab = ref('locations')
  const roamingFilter = ref<RoamingFilter>('enabled')

  const filteredLocations = computed(() =>
    filterByRoaming(locations.value, roamingFilter.value),
  )

  function byCompliance (a: OurLocation, b: OurLocation) {
    return (
      complianceSortValue(complianceById.value.get(a.id))
      - complianceSortValue(complianceById.value.get(b.id))
    )
  }

  const locationHeaders = [
    { title: 'OCPI location id', key: 'ocpiId' },
    { title: 'Name', key: 'name' },
    { title: 'Address', key: 'address', sortable: false },
    // Counts ChargingStations, not EVSEs
    { title: 'Stations', key: 'evseCount' },
    { title: 'Roaming', key: 'disableOCPI' },
    { title: 'Gireve compliance', key: 'compliance', sortRaw: byCompliance },
    { title: 'Tariffs', key: 'tariffs', sortable: false },
    { title: 'Last updated', key: 'lastUpdated' },
    { title: '', key: 'data-table-expand' },
  ]

  // OCPI PriceComponent units: ENERGY per kWh, TIME/PARKING_TIME per hour, FLAT per session
  const PRICE_UNIT: Record<string, string> = {
    ENERGY: '/kWh',
    TIME: '/h',
    PARKING_TIME: '/h',
    FLAT: ' per session',
  }

  function priceLabel (price: number | null, currency: string | null) {
    if (price == null) return '—'
    const amount = price.toLocaleString(undefined, { maximumFractionDigits: 4 })
    return currency ? `${amount} ${currency}` : amount
  }

  // Chip summary: the ENERGY price of the first element — the one
  // BaseTransactionMapper.calculateTotalCost uses for the session cost.
  function energyPriceLabel (tariff: LocationTariff) {
    const energy = tariff.elements[0]?.priceComponents.find(
      component => component.type === 'ENERGY',
    )
    if (!energy) return 'no energy price'
    return `${priceLabel(energy.price, tariff.currency)}/kWh`
  }

  function restrictionsLabel (restrictions: Record<string, unknown>) {
    return Object.entries(restrictions)
      .filter(([, value]) => value != null)
      .map(([key, value]) =>
        `${key}=${Array.isArray(value) ? value.join(',') : String(value)}`,
      )
      .join(', ')
  }

  function formatDay (value: string | null) {
    return value ? new Date(value).toLocaleDateString() : '—'
  }

  function formatDate (value: string | null) {
    if (!value) return '—'
    try {
      return new Date(value).toLocaleString()
    } catch {
      return value
    }
  }

  function messageOf (reason: unknown) {
    return reason instanceof Error ? reason.message : String(reason)
  }

  // The compliance report is optional: the table stays usable if it fails.
  async function load () {
    loading.value = true
    error.value = null
    complianceError.value = null
    const [locationsResult, complianceResult] = await Promise.allSettled([
      fetchOurLocations(),
      fetchGireveCompliance(),
    ])
    if (locationsResult.status === 'fulfilled') {
      locations.value = locationsResult.value
    } else {
      locations.value = []
      error.value = messageOf(locationsResult.reason)
    }
    if (complianceResult.status === 'fulfilled') {
      complianceById.value = new Map(
        complianceResult.value.locations.map(c => [c.locationId, c]),
      )
    } else {
      complianceById.value = new Map()
      complianceError.value = messageOf(complianceResult.reason)
    }
    loading.value = false
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

.tariff-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem;
  padding-block: 0.4rem;
}

.tariff-chip {
  cursor: help;
}

.tariff-chip__id {
  font-family: var(--font-mono), monospace;
  font-weight: 600;
}

.tariff-chip--inactive {
  opacity: 0.6;
}

.tariff-chip__price {
  margin-left: 0.4rem;
  opacity: 0.8;
}

.tariff-tip__element {
  margin-top: 0.5rem;
  padding-top: 0.4rem;
  border-top: 1px solid rgb(255 255 255 / 20%);
}

.tariff-tip__restrictions {
  margin-top: 0.15rem;
  opacity: 0.8;
}

.compliance-row {
  background: #f7fafa;
}

.tariff-chip__coverage {
  margin-left: 0.4rem;
  padding: 0 0.35rem;
  border-radius: 999px;
  background: rgb(54 135 201 / 15%);
  font-size: 0.7rem;
}
</style>
