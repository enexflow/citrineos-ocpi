<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-6 d-flex flex-wrap align-center justify-space-between ga-3">
      <div>
        <h1 class="text-h5 font-weight-bold mb-1" style="color: #153651">
          Hub
        </h1>
        <p class="text-body-2 mb-0" style="color: #587474">
          Roaming partners relayed through a hub, filtered to those that have
          pushed at least one location or tariff. Open one to see its own
          locations, tariffs, sessions and CDRs.
        </p>
      </div>

      <v-select
        v-model="selectedHubId"
        density="comfortable"
        hide-details
        item-title="name"
        item-value="id"
        :items="hubs"
        label="Hub"
        style="min-width: 260px"
        variant="outlined"
      />
    </div>

    <v-card class="export-card mb-6">
      <v-card-title style="color: #153651">Export CDRs</v-card-title>
      <v-card-subtitle class="text-wrap" style="color: #587474">
        Every CDR received through this hub, across all roaming partners,
        whose session overlaps the selected period — a CDR starting before or
        ending after the range is still included as long as it crosses into
        it, and both boundary days are covered in full.
      </v-card-subtitle>
      <v-card-text
        style="display: flex; flex-wrap: wrap; align-items: flex-end; gap: 24px"
      >
        <v-menu
          v-model="dateMenuOpen"
          :close-on-content-click="false"
          location="bottom start"
        >
          <template #activator="{ props: menuProps }">
            <v-text-field
              v-bind="menuProps"
              density="compact"
              hide-details
              label="Date range"
              :model-value="dateRangeLabel"
              prepend-inner-icon="mdi-calendar-range"
              readonly
              style="max-width: 260px"
              variant="outlined"
            />
          </template>

          <v-card rounded="lg">
            <v-date-picker
              v-model="dateRangeModel"
              multiple="range"
              rounded="lg"
              show-adjacent-months
              @update:model-value="onDateRangeSelected"
            />
          </v-card>
        </v-menu>

        <v-btn
          color="#3687c9"
          :disabled="!selectedHubId || !fromDate || !toDate"
          :loading="exporting"
          prepend-icon="mdi-file-excel-outline"
          variant="flat"
          @click="exportExcel"
        >
          Download Excel
        </v-btn>
      </v-card-text>

      <v-alert
        v-if="exportError"
        class="mx-4 mb-4"
        density="comfortable"
        type="error"
        variant="tonal"
      >
        {{ exportError }}
      </v-alert>
    </v-card>

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
      v-else-if="!loadingHubs && hubs.length === 0"
      class="mb-4"
      density="comfortable"
      type="info"
      variant="tonal"
    >
      No HUB-role partners found.
    </v-alert>

    <v-data-table
      v-if="detail"
      class="partners-table partners-table--clickable rounded-lg"
      :headers="headers"
      hover
      item-value="roamingPartnerId"
      :items="rows"
      :loading="loadingDetail"
      @click:row="onRowClick"
    >
      <template #item.identity="{ item }">
        <div class="py-2">
          <div class="font-weight-medium" style="color: #153651">
            {{ item.name ?? `${item.countryCode}/${item.partyId}` }}
          </div>
          <div class="text-caption" style="color: #587474">
            {{ item.countryCode }}/{{ item.partyId }}
            <span class="mx-1">·</span>
            id {{ item.roamingPartnerId }}
          </div>
        </div>
      </template>

      <template #item.costLabel="{ item }">
        {{ item.costLabel }}
      </template>

      <template #item.actions="{ item }">
        <v-btn
          color="#3687c9"
          size="small"
          variant="text"
          @click.stop="openRoamingPartner(item)"
        >
          Received data
        </v-btn>
      </template>

      <template #no-data>
        <div class="py-8 text-center text-medium-emphasis">
          No roaming partners with locations or tariffs for this hub yet.
        </div>
      </template>
    </v-data-table>
  </div>
</template>

<script lang="ts" setup>
  import type { HubEmspView, HubOverview, RoamingCpoSummary } from '@/types/partner'
  import { computed, onMounted, ref, watch } from 'vue'
  import { useRouter } from 'vue-router'
  import { fetchHubEmspCdrExport, fetchHubEmspView, fetchHubs } from '@/api/hub'
  import { amountOf } from '@/api/partners'
  import { downloadExcelWorkbook } from '@/utils/excel'

  const router = useRouter()
  const hubs = ref<HubOverview[]>([])
  const selectedHubId = ref<number | null>(null)
  const detail = ref<HubEmspView | null>(null)
  const loadingHubs = ref(false)
  const loadingDetail = ref(false)
  const error = ref<string | null>(null)

  const headers = [
    { title: 'Roaming partner', key: 'identity', sortable: false },
    { title: 'Locations', key: 'locationCount' },
    { title: 'Tariffs', key: 'tariffCount' },
    { title: 'CDRs received', key: 'cdrCount' },
    { title: 'Energy (kWh)', key: 'totalEnergyKwh' },
    { title: 'Total cost', key: 'costLabel', sortable: false },
    { title: '', key: 'actions', sortable: false },
  ]

  const rows = ref<Array<RoamingCpoSummary & { costLabel: string }>>([])

  watch(detail, value => {
    rows.value = (value?.roamingCpos ?? []).map(r => ({
      ...r,
      costLabel:
        r.totalCost.map(c => `${c.amount.toFixed(2)} ${c.currency}`).join(', ') || '—',
    }))
  })

  function openRoamingPartner (item: RoamingCpoSummary) {
    router.push({
      name: 'emsp-roaming-detail',
      params: { id: String(item.roamingPartnerId) },
    })
  }

  function onRowClick (_event: unknown, row: { item: RoamingCpoSummary }) {
    openRoamingPartner(row.item)
  }

  function toDateInput (date: Date): string {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
  }

  const now = new Date()
  const firstOfMonth = new Date(now.getFullYear(), now.getMonth(), 1)
  const lastOfMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0)

  const fromDate = ref(toDateInput(firstOfMonth))
  const toDate = ref(toDateInput(lastOfMonth))
  const dateMenuOpen = ref(false)
  const dateRangeModel = ref<Date[]>([firstOfMonth, lastOfMonth])
  const exporting = ref(false)
  const exportError = ref<string | null>(null)

  const dateRangeLabel = computed(() =>
    fromDate.value && toDate.value ? `${fromDate.value} → ${toDate.value}` : '',
  )

  function onDateRangeSelected (value: Date[]) {
    if (value.length < 2) {
      return
    }
    // eslint-disable-next-line unicorn/no-array-sort -- toSorted needs ES2023 lib, not configured here
    const sorted = value.slice().sort((a, b) => a.getTime() - b.getTime())
    fromDate.value = toDateInput(sorted[0])
    toDate.value = toDateInput(sorted.at(-1)!)
    dateMenuOpen.value = false
  }

  async function exportExcel () {
    if (!selectedHubId.value || !fromDate.value || !toDate.value) {
      return
    }
    exporting.value = true
    exportError.value = null
    try {
      const groups = await fetchHubEmspCdrExport(
        selectedHubId.value,
        `${fromDate.value}T00:00:00.000Z`,
        `${toDate.value}T23:59:59.999Z`,
      )

      if (groups.length === 0) {
        exportError.value = 'No CDRs attributed to a roaming partner in this period.'
        return
      }

      const totalsRows = groups.map(g => ({
        countryCode: g.countryCode,
        partyId: g.partyId,
        cdrCount: g.cdrCount,
        totalEnergyKwh: g.totalEnergyKwh,
        ...Object.fromEntries(g.totalCost.map(c => [`total_${c.currency}`, c.amount])),
      }))

      const sheets = [
        { name: 'Totals', rows: totalsRows },
        ...groups.map(g => ({
          name: `${g.countryCode}-${g.partyId}`,
          rows: g.cdrs.map(cdr => ({
            ocpiCdrId: cdr.ocpiCdrId,
            sessionId: cdr.sessionId ?? '',
            startDateTime: cdr.startDateTime ?? '',
            endDateTime: cdr.endDateTime ?? '',
            totalEnergyKwh: cdr.totalEnergy ?? 0,
            currency: cdr.currency,
            totalCost: amountOf(cdr.totalCost),
          })),
        })),
      ]

      const hubPartyId = hubs.value.find(h => h.id === selectedHubId.value)?.partyId ?? selectedHubId.value
      downloadExcelWorkbook(
        `hub-${hubPartyId}-cdrs-${fromDate.value}-to-${toDate.value}.xlsx`,
        sheets,
      )
    } catch (error_) {
      exportError.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      exporting.value = false
    }
  }

  async function loadHubs () {
    loadingHubs.value = true
    error.value = null
    try {
      hubs.value = await fetchHubs()
      if (hubs.value.length > 0) {
        selectedHubId.value = hubs.value[0].id
      }
    } catch (error_) {
      hubs.value = []
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loadingHubs.value = false
    }
  }

  async function loadDetail (hubId: number) {
    loadingDetail.value = true
    error.value = null
    try {
      detail.value = await fetchHubEmspView(hubId)
    } catch (error_) {
      detail.value = null
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loadingDetail.value = false
    }
  }

  onMounted(loadHubs)
  watch(selectedHubId, hubId => {
    if (hubId != null) {
      loadDetail(hubId)
    }
  })
</script>

<style scoped>
.partners-table {
  background: #ffffff !important;
  border: 1px solid #c5d3d3;
  overflow: hidden;
}

:deep(.partners-table--clickable .v-data-table__tr) {
  cursor: pointer;
}

.export-card {
  background: #ffffff !important;
  border: 1px solid #c5d3d3;
}
</style>
