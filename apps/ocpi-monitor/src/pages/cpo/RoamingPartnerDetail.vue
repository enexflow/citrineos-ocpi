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
        @click="router.push({ name: 'cpo-hub' })"
      >
        Back to hub
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
      Loading roaming partner…
    </div>

    <template v-else-if="detail">
      <div class="mb-6 d-flex flex-wrap align-end justify-space-between ga-3">
        <div>
          <div class="overview-kicker mb-2">Roaming partner · via hub</div>
          <h1 class="text-h4 font-weight-bold mb-1" style="color: #153651">
            {{ detail.partner.name ?? `${detail.partner.countryCode}/${detail.partner.partyId}` }}
          </h1>
          <p class="text-body-1 mb-0" style="color: #587474">
            {{ detail.partner.countryCode }}/{{ detail.partner.partyId }} ·
            roaming id {{ detail.partner.id }}
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

      <v-alert class="mb-4" density="comfortable" type="info" variant="tonal">
        Tokens are received data — this roaming partner registered them with us
        (Authorizations.roamingPartnerId). Sessions/CDRs are sent data, from
        the hub's own OCPI sender GET (there's no separate connection per
        roaming partner), filtered to this partner's country_code/party_id
        afterward.
      </v-alert>

      <v-tabs v-model="tab" class="mb-4" color="#3687c9">
        <v-tab value="tokens">
          Tokens · received ({{ detail.tokens.length }})
        </v-tab>
        <v-tab value="sessions">
          Sessions · sent ({{ detail.sessionsSent.length }})
        </v-tab>
        <v-tab value="cdrs">
          CDRs · sent ({{ detail.cdrsSent.length }})
        </v-tab>
      </v-tabs>

      <v-tabs-window v-model="tab">
        <v-tabs-window-item value="tokens">
          <v-data-table
            class="partners-table rounded-lg"
            :headers="tokenHeaders"
            hover
            item-value="id"
            :items="detail.tokens"
          >
            <template #item.idToken="{ item }">
              <code class="id-code">{{ item.idToken }}</code>
            </template>
            <template #item.status="{ item }">
              <span class="role-pill role-pill--hub">{{ item.status }}</span>
            </template>
            <template #item.createdAt="{ item }">
              {{ formatDate(item.createdAt) }}
            </template>
            <template #item.updatedAt="{ item }">
              {{ formatDate(item.updatedAt) }}
            </template>
            <template #no-data>
              <div class="py-8 text-center text-medium-emphasis">
                No tokens registered by this roaming partner yet.
              </div>
            </template>
          </v-data-table>
        </v-tabs-window-item>

        <v-tabs-window-item value="sessions">
          <v-data-table
            class="partners-table rounded-lg"
            :headers="sessionHeaders"
            hover
            item-value="id"
            :items="detail.sessionsSent"
          >
            <template #item.ocpiSessionId="{ item }">
              <code class="id-code">{{ item.ocpiSessionId }}</code>
            </template>
            <template #item.status="{ item }">
              <span class="role-pill role-pill--hub">{{ item.status ?? '—' }}</span>
            </template>
            <template #item.kwh="{ item }">
              {{ formatNumber(item.kwh) }}
            </template>
            <template #item.totalCost="{ item }">
              {{ formatCost(item.totalCost) }}
            </template>
            <template #item.startDateTime="{ item }">
              {{ formatDate(item.startDateTime) }}
            </template>
            <template #item.endDateTime="{ item }">
              {{ formatDate(item.endDateTime) }}
            </template>
            <template #item.actions="{ item }">
              <v-btn
                color="#3687c9"
                size="small"
                variant="tonal"
                @click="openJson('Session', item.ocpiSessionId, item.ocpiJson)"
              >
                View JSON
              </v-btn>
            </template>
            <template #no-data>
              <div class="py-8 text-center text-medium-emphasis">
                No OCPI sessions matched for this roaming partner.
              </div>
            </template>
          </v-data-table>
        </v-tabs-window-item>

        <v-tabs-window-item value="cdrs">
          <v-data-table
            class="partners-table rounded-lg"
            :headers="cdrHeaders"
            hover
            item-value="id"
            :items="detail.cdrsSent"
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
              {{ formatCost(item.totalCost) }}
            </template>
            <template #item.startDateTime="{ item }">
              {{ formatDate(item.startDateTime) }}
            </template>
            <template #item.endDateTime="{ item }">
              {{ formatDate(item.endDateTime) }}
            </template>
            <template #item.actions="{ item }">
              <v-btn
                color="#3687c9"
                size="small"
                variant="tonal"
                @click="openJson('CDR', item.ocpiCdrId, item.ocpiJson)"
              >
                View JSON
              </v-btn>
            </template>
            <template #no-data>
              <div class="py-8 text-center text-medium-emphasis">
                No CDRs stored for this roaming partner yet.
              </div>
            </template>
          </v-data-table>
        </v-tabs-window-item>
      </v-tabs-window>
    </template>

    <v-dialog v-model="jsonDialog" max-width="840" scrollable>
      <v-card>
        <v-card-title class="d-flex align-center justify-space-between ga-3 pr-2">
          <div>
            <div class="text-subtitle-1 font-weight-bold">{{ jsonTitle }}</div>
            <div class="text-caption" style="color: #587474">
              Final OCPI mapping (wire format)
            </div>
          </div>
          <div class="d-flex ga-1">
            <v-btn
              color="#3687c9"
              prepend-icon="mdi-content-copy"
              size="small"
              variant="tonal"
              @click="copyJson"
            >
              {{ copied ? 'Copied' : 'Copy' }}
            </v-btn>
            <v-btn icon="mdi-close" variant="text" @click="jsonDialog = false" />
          </div>
        </v-card-title>
        <v-divider />
        <v-card-text class="pa-0">
          <pre class="json-viewer">{{ jsonText }}</pre>
        </v-card-text>
      </v-card>
    </v-dialog>
  </div>
</template>

<script lang="ts" setup>
  import type { RoamingEmspDetail } from '@/types/partner'
  import { computed, onMounted, ref, watch } from 'vue'
  import { useRoute, useRouter } from 'vue-router'
  import { fetchRoamingEmspDetail } from '@/api/hub'
  import { prettyOcpiJson } from '@/mapper/ocpiPayload'

  const route = useRoute()
  const router = useRouter()
  const detail = ref<RoamingEmspDetail | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)
  const tab = ref('tokens')

  const jsonDialog = ref(false)
  const jsonTitle = ref('')
  const jsonPayload = ref<Record<string, unknown>>({})
  const copied = ref(false)

  const jsonText = computed(() => prettyOcpiJson(jsonPayload.value))

  const tokenHeaders = [
    { title: 'ID token', key: 'idToken' },
    { title: 'Type', key: 'idTokenType' },
    { title: 'Status', key: 'status' },
    { title: 'Auth method', key: 'ocpiAuthMethod' },
    { title: 'Created', key: 'createdAt' },
    { title: 'Updated', key: 'updatedAt' },
  ]

  const sessionHeaders = [
    { title: 'OCPI session id', key: 'ocpiSessionId' },
    { title: 'Status', key: 'status' },
    { title: 'Start', key: 'startDateTime' },
    { title: 'End', key: 'endDateTime' },
    { title: 'kWh', key: 'kwh' },
    { title: 'Cost', key: 'totalCost' },
    { title: '', key: 'actions', sortable: false },
  ]

  const cdrHeaders = [
    { title: 'OCPI CDR id', key: 'ocpiCdrId' },
    { title: 'Session id', key: 'sessionId' },
    { title: 'Start', key: 'startDateTime' },
    { title: 'End', key: 'endDateTime' },
    { title: 'Energy', key: 'totalEnergy' },
    { title: 'Cost', key: 'totalCost' },
    { title: '', key: 'actions', sortable: false },
  ]

  const stats = computed(() => {
    const d = detail.value
    if (!d) return []
    return [
      {
        label: 'Tokens',
        value: d.tokenCount,
        hint: 'Tokens this roaming partner has registered with us — received data (Authorizations.roamingPartnerId).',
      },
      {
        label: 'Tx ended',
        value: d.sessionCount,
        hint: 'Transactions for this roaming partner that have finished charging (endTime set).',
      },
      { label: 'CDRs sent', value: d.cdrsSent.length },
      {
        label: 'Mapped sessions',
        value: d.sessionsSent.length,
        hint: 'Sessions from the hub sender GET, filtered to this roaming partner — can be lower than "Tx ended" if the mapper skips a transaction or the OCPI payload uses a different country_code/party_id.',
      },
    ]
  })

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

  function formatCost (value: unknown) {
    if (value == null) return '—'
    if (typeof value === 'number') return formatNumber(value)
    if (typeof value === 'object' && value !== null && 'incl_vat' in value) {
      const incl = (value as { incl_vat?: number }).incl_vat
      return incl == null ? JSON.stringify(value) : formatNumber(incl)
    }
    if (typeof value === 'string') return value
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }

  function openJson (kind: string, id: string, payload: Record<string, unknown>) {
    jsonTitle.value = `${kind} · ${id}`
    jsonPayload.value = payload
    copied.value = false
    jsonDialog.value = true
  }

  async function copyJson () {
    try {
      await navigator.clipboard.writeText(jsonText.value)
      copied.value = true
      setTimeout(() => {
        copied.value = false
      }, 1500)
    } catch {
      copied.value = false
    }
  }

  async function load () {
    const id = Number(route.params.id)
    if (!Number.isFinite(id)) {
      error.value = 'Invalid roaming partner id'
      detail.value = null
      return
    }

    loading.value = true
    error.value = null
    try {
      detail.value = await fetchRoamingEmspDetail(id)
      if (!detail.value) {
        error.value = `Roaming partner ${id} not found`
      }
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

.json-viewer {
  margin: 0;
  padding: 1.25rem 1.5rem;
  max-height: 70vh;
  overflow: auto;
  background: #0b1b28;
  color: #cff8fc;
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  line-height: 1.45;
  white-space: pre;
}
</style>
