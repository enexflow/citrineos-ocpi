<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-8 d-flex flex-wrap align-end justify-space-between ga-4">
      <div>
        <div class="overview-kicker mb-2">Partner network</div>
        <h1 class="text-headline-medium font-weight-bold mb-1" style="color: #153651">
          Overview
        </h1>
        <p class="text-body-large mb-0" style="color: #587474">
          Connected OCPI partners by role.
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

    <v-row>
      <v-col
        v-for="card in cards"
        :key="card.label"
        cols="12"
        md="3"
        sm="6"
      >
        <button
          :class="[
            'role-card',
            `role-card--${card.key}`,
            { 'role-card--clickable': !!card.to },
          ]"
          type="button"
          @click="openCard(card.to)"
        >
          <div class="role-card__top">
            <span class="role-card__icon">
              <v-icon :icon="card.icon" size="20" />
            </span>
            <v-icon
              v-if="card.to"
              class="role-card__arrow"
              icon="mdi-arrow-top-right"
              size="18"
            />
          </div>
          <div class="role-card__value">
            {{ loading ? '—' : card.value }}
          </div>
          <div class="role-card__label">{{ card.label }}</div>
          <div class="role-card__hint">{{ card.hint }}</div>
        </button>
      </v-col>
    </v-row>

    <v-alert
      v-if="counts && counts.other > 0"
      class="mt-4"
      density="comfortable"
      type="info"
      variant="tonal"
    >
      {{ counts.other }} partner{{ counts.other === 1 ? '' : 's' }} with another
      or unknown role.
    </v-alert>

    <div class="mt-16">
      <div class="mb-5 d-flex flex-wrap align-end justify-space-between ga-4">
        <div>
          <div class="overview-kicker mb-2">Cumulative from CDRs</div>
          <h2 class="text-title-large font-weight-bold mb-1" style="color: #153651">
            Money earned VS owed
          </h2>
          <p class="text-body-large mb-0" style="color: #587474">
            Sum of CDR total cost by end date — earned = CDRs we sent to eMSPs,
            owed = CDRs we received from CPOs.
          </p>
        </div>

        <div class="period-toolbar">
          <v-menu
            v-model="dateMenuOpen"
            :close-on-content-click="false"
            location="bottom end"
            offset="6"
          >
            <template #activator="{ props: menuProps }">
              <v-text-field
                v-bind="menuProps"
                bg-color="white"
                class="period-toolbar__range"
                density="compact"
                hide-details
                label="Period"
                :model-value="dateRangeLabel"
                prepend-inner-icon="mdi-calendar-range"
                readonly
                variant="outlined"
              />
            </template>

            <v-card class="bg-white" elevation="8" rounded="lg">
              <v-date-picker
                v-model="dateRangeModel"
                bg-color="white"
                multiple="range"
                rounded="lg"
                show-adjacent-months
                @update:model-value="onDateRangeSelected"
              />
            </v-card>
          </v-menu>
          <v-btn
            color="#3687c9"
            height="40"
            :loading="financialsLoading"
            prepend-icon="mdi-refresh"
            variant="tonal"
            @click="loadFinancials"
          >
            Refresh
          </v-btn>
        </div>
      </div>

      <v-alert
        v-if="financialsError"
        class="mb-4"
        density="comfortable"
        type="error"
        variant="tonal"
      >
        {{ financialsError }}
      </v-alert>

      <v-row>
        <v-col cols="12" sm="6">
          <div class="money-tile money-tile--earned">
            <div class="money-tile__label">
              <v-icon icon="mdi-cash-plus" size="18" />
              Money earned
              <v-tooltip location="top" max-width="280">
                <template #activator="{ props: tooltipProps }">
                  <v-icon
                    v-bind="tooltipProps"
                    class="money-tile__hint-icon"
                    icon="mdi-information-outline"
                    size="14"
                  />
                </template>
                CDRs sent to eMSPs (Cdrs.toTenantPartnerId) — they owe us this.
              </v-tooltip>
            </div>
            <div class="money-tile__value">
              {{ financialsLoading ? '—' : formatAmounts(financials?.earned) }}
            </div>
          </div>
        </v-col>
        <v-col cols="12" sm="6">
          <div class="money-tile money-tile--owed">
            <div class="money-tile__label">
              <v-icon icon="mdi-cash-minus" size="18" />
              Money we owe
              <v-tooltip location="top" max-width="280">
                <template #activator="{ props: tooltipProps }">
                  <v-icon
                    v-bind="tooltipProps"
                    class="money-tile__hint-icon"
                    icon="mdi-information-outline"
                    size="14"
                  />
                </template>
                CDRs received from CPOs (Cdrs.fromTenantPartnerId) — we owe them
                this.
              </v-tooltip>
            </div>
            <div class="money-tile__value">
              {{ financialsLoading ? '—' : formatAmounts(financials?.owed) }}
            </div>
          </div>
        </v-col>
      </v-row>
    </div>

    <div class="mt-16">
      <div class="mb-5 d-flex flex-wrap align-end justify-space-between ga-4">
        <div>
          <div class="overview-kicker mb-2">Latest activity</div>
          <h2 class="text-title-large font-weight-bold mb-1" style="color: #153651">
            Last sessions received VS sent
          </h2>
          <p class="text-body-large mb-0" style="color: #587474">
            5 most recently updated — received = Sessions pushed to us by CPOs,
            sent = Transactions we map and push to eMSPs.
          </p>
        </div>

        <v-btn
          color="#3687c9"
          :loading="recentLoading"
          prepend-icon="mdi-refresh"
          variant="tonal"
          @click="loadRecentSessions"
        >
          Refresh
        </v-btn>
      </div>

      <v-alert
        v-if="recentError"
        class="mb-4"
        density="comfortable"
        type="error"
        variant="tonal"
      >
        {{ recentError }}
      </v-alert>

      <v-row>
        <v-col v-for="table in recentTables" :key="table.key" cols="12">
          <div class="money-tile__label mb-2">
            <v-icon :icon="table.icon" size="18" />
            {{ table.title }}
          </div>
          <v-data-table
            class="rounded-lg"
            density="compact"
            :headers="recentHeaders"
            hide-default-footer
            item-value="id"
            :items="table.items"
            :items-per-page="-1"
            :loading="recentLoading"
          >
            <template #item.sessionId="{ item }">
              <code class="id-code">{{ item.sessionId }}</code>
            </template>
            <template #item.tokenId="{ item }">
              <code v-if="item.tokenId" class="id-code">{{ item.tokenId }}</code>
              <span v-else>—</span>
            </template>
            <template #item.status="{ item }">
              {{ item.status ?? '—' }}
            </template>
            <template #item.startDateTime="{ item }">
              {{ formatDate(item.startDateTime) }}
            </template>
            <template #item.kwh="{ item }">
              {{ formatNumber(item.kwh) }}
            </template>
            <template #item.totalCost="{ item }">
              {{ formatCost(item.totalCost, item.currency) }}
            </template>
            <template #item.lastUpdated="{ item }">
              {{ formatDate(item.lastUpdated) }}
            </template>
            <template #no-data>
              <div class="py-6 text-center text-medium-emphasis">
                {{ table.empty }}
              </div>
            </template>
          </v-data-table>
        </v-col>
      </v-row>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type {
    CdrFinancials,
    CurrencyAmount,
    PartnerRoleCounts,
    RecentSessions,
  } from '@/types/partner'
  import { computed, onMounted, ref } from 'vue'
  import { useRouter } from 'vue-router'
  import {
    amountOf,
    fetchCdrFinancials,
    fetchPartnerRoleCounts,
    fetchRecentSessions,
  } from '@/api/partners'

  const router = useRouter()
  const counts = ref<PartnerRoleCounts | null>(null)
  const loading = ref(false)
  const error = ref<string | null>(null)

  function toDateInput (date: Date): string {
    return date.toISOString().slice(0, 10)
  }

  const today = new Date()
  const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000)

  const fromDate = ref(toDateInput(thirtyDaysAgo))
  const toDate = ref(toDateInput(today))
  const dateMenuOpen = ref(false)
  const dateRangeModel = ref<Date[]>([thirtyDaysAgo, today])
  const financials = ref<CdrFinancials | null>(null)
  const financialsLoading = ref(false)
  const financialsError = ref<string | null>(null)

  const dateRangeLabel = computed(() =>
    fromDate.value && toDate.value ? `${fromDate.value} → ${toDate.value}` : '',
  )

  function onDateRangeSelected (value: Date[]) {
    if (value.length < 2) return
    // eslint-disable-next-line unicorn/no-array-sort -- toSorted needs ES2023 lib, not configured here
    const sorted = value.slice().sort((a, b) => a.getTime() - b.getTime())
    fromDate.value = toDateInput(sorted[0])
    toDate.value = toDateInput(sorted.at(-1)!)
    dateMenuOpen.value = false
    loadFinancials()
  }

  function formatAmounts (amounts: CurrencyAmount[] | undefined): string {
    if (!amounts || amounts.length === 0) return '0'
    return amounts
      .map(
        ({ currency, amount }) =>
          `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
      )
      .join(' · ')
  }

  async function loadFinancials () {
    if (!fromDate.value || !toDate.value) return
    financialsLoading.value = true
    financialsError.value = null
    try {
      financials.value = await fetchCdrFinancials(
        `${fromDate.value}T00:00:00.000Z`,
        `${toDate.value}T23:59:59.999Z`,
      )
    } catch (error_) {
      financials.value = null
      financialsError.value
        = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      financialsLoading.value = false
    }
  }

  const cards = computed(() => [
    {
      key: 'cpo',
      label: 'CPO',
      hint: 'Seen in eMSP view',
      value: counts.value?.cpo ?? 0,
      icon: 'mdi-ev-station',
      to: { name: 'emsp-partners' } as const,
    },
    {
      key: 'emsp',
      label: 'eMSP',
      hint: 'Seen in CPO view',
      value: counts.value?.emsp ?? 0,
      icon: 'mdi-cellphone-wireless',
      to: { name: 'cpo-partners' } as const,
    },
    {
      key: 'hub',
      label: 'HUB',
      hint: 'See eMSP > Hub or CPO > Hub for roaming partners',
      value: counts.value?.hub ?? 0,
      icon: 'mdi-lan',
      to: undefined,
    },
    {
      key: 'total',
      label: 'Total',
      hint: 'All tenant partners',
      value: counts.value?.total ?? 0,
      icon: 'mdi-account-group-outline',
      to: undefined,
    },
  ])

  function openCard (to: { name: string } | undefined) {
    if (to) router.push(to)
  }

  async function load () {
    loading.value = true
    error.value = null
    try {
      counts.value = await fetchPartnerRoleCounts()
    } catch (error_) {
      counts.value = null
      error.value = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      loading.value = false
    }
  }

  const recent = ref<RecentSessions | null>(null)
  const recentLoading = ref(false)
  const recentError = ref<string | null>(null)

  const recentHeaders = [
    { title: 'Session id', key: 'sessionId', sortable: false },
    { title: 'Partner', key: 'partner', sortable: false },
    { title: 'Token', key: 'tokenId', sortable: false },
    { title: 'Status', key: 'status', sortable: false },
    { title: 'Start', key: 'startDateTime', sortable: false },
    { title: 'kWh', key: 'kwh', sortable: false, align: 'end' as const },
    { title: 'Cost', key: 'totalCost', sortable: false, align: 'end' as const },
    { title: 'Last updated', key: 'lastUpdated', sortable: false },
  ]

  const recentTables = computed(() => [
    {
      key: 'received',
      title: 'Last 5 sessions received',
      icon: 'mdi-download',
      items: recent.value?.received ?? [],
      empty: 'No sessions received yet.',
    },
    {
      key: 'sent',
      title: 'Last 5 sessions sent',
      icon: 'mdi-upload',
      items: recent.value?.sent ?? [],
      empty: 'No sessions sent yet.',
    },
  ])

  function formatDate (value: string | null): string {
    return value ? new Date(value).toLocaleString() : '—'
  }

  function formatNumber (value: number | null): string {
    if (value == null || Number.isNaN(value)) return '—'
    return value.toLocaleString(undefined, { maximumFractionDigits: 4 })
  }

  function formatCost (value: unknown, currency: string | null): string {
    if (value == null) return '—'
    const amount = amountOf(value).toLocaleString(undefined, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })
    return currency ? `${amount} ${currency}` : amount
  }

  async function loadRecentSessions () {
    recentLoading.value = true
    recentError.value = null
    try {
      recent.value = await fetchRecentSessions(5)
    } catch (error_) {
      recent.value = null
      recentError.value
        = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      recentLoading.value = false
    }
  }

  onMounted(load)
  onMounted(loadFinancials)
  onMounted(loadRecentSessions)
</script>

<style scoped>
.overview-kicker {
  display: inline-block;
  padding: 0.2rem 0.65rem;
  border-radius: 999px;
  background: #cff8fc;
  color: #065760;
  font-size: 0.75rem;
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
}

/* Period picker + refresh, kept on one line next to the section title */
.period-toolbar {
  display: flex;
  align-items: center;
  gap: 0.75rem;
}

.period-toolbar__range {
  flex: 0 0 auto;
  width: 290px;
  cursor: pointer;
}

.period-toolbar__range :deep(input) {
  cursor: pointer;
}

@media (max-width: 600px) {
  .period-toolbar {
    width: 100%;
  }

  .period-toolbar__range {
    flex: 1 1 auto;
    width: auto;
  }
}

/* Each role sets its accent; the card itself stays white like the stat tiles */
.role-card {
  --role-accent: #3687c9;
  --role-tint: #ebf3fa;
  --role-ink: #205179;

  position: relative;
  display: flex;
  flex-direction: column;
  width: 100%;
  height: 100%;
  overflow: hidden;
  text-align: left;
  background: #ffffff;
  border: 1px solid #e2e9e9;
  border-radius: 16px;
  padding: 1.35rem 1.4rem 1.3rem;
  box-shadow: 0 1px 2px rgb(21 54 81 / 4%);
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease,
    border-color 0.15s ease;
}

.role-card::before {
  content: '';
  position: absolute;
  inset: 0 0 auto;
  height: 3px;
  background: var(--role-accent);
}

.role-card--clickable {
  cursor: pointer;
}

.role-card--clickable:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--role-accent) 35%, #e2e9e9);
  box-shadow: 0 10px 24px rgb(21 54 81 / 10%);
}

.role-card:focus-visible {
  outline: 2px solid var(--role-accent);
  outline-offset: 2px;
}

.role-card__top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 1.1rem;
}

.role-card__icon {
  width: 40px;
  height: 40px;
  border-radius: 12px;
  display: grid;
  place-items: center;
  background: var(--role-tint);
  color: var(--role-ink);
}

.role-card__arrow {
  color: #a8bdbd;
  transition: color 0.15s ease, transform 0.15s ease;
}

.role-card--clickable:hover .role-card__arrow {
  color: var(--role-accent);
  transform: translate(2px, -2px);
}

.role-card__value {
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1;
  color: #153651;
  font-variant-numeric: tabular-nums;
}

.role-card__label {
  margin-top: 0.6rem;
  font-size: 0.95rem;
  font-weight: 700;
  color: #153651;
}

.role-card__hint {
  margin-top: 0.2rem;
  font-size: 0.8rem;
  line-height: 1.35;
  color: #587474;
}

.role-card--cpo {
  --role-accent: #0bafc1;
  --role-tint: #e7fbfe;
  --role-ink: #065760;
}

.role-card--emsp {
  --role-accent: #4560ba;
  --role-tint: #eceff8;
  --role-ink: #293a70;
}

.role-card--hub {
  --role-accent: #5471ab;
  --role-tint: #eef1f7;
  --role-ink: #324467;
}

.role-card--total {
  --role-accent: #3687c9;
  --role-tint: #ebf3fa;
  --role-ink: #205179;
}

.money-tile {
  border: 1px solid #c5d3d3;
  border-left: 4px solid #3687c9;
  border-radius: 1rem;
  padding: 1.25rem 1.35rem;
}

.money-tile--earned {
  background: #eafbf3;
  border-left-color: #1e9e6e;
}

.money-tile--owed {
  background: #fdf2ee;
  border-left-color: #c9583e;
}

.money-tile__label {
  display: flex;
  align-items: center;
  gap: 0.4rem;
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #587474;
}

.money-tile__value {
  margin-top: 0.4rem;
  font-size: 1.9rem;
  font-weight: 700;
  color: #153651;
}

.money-tile__hint-icon {
  cursor: help;
  opacity: 0.7;
}

.id-code {
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  color: #205179;
}
</style>
