<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-8 d-flex flex-wrap align-end justify-space-between ga-4">
      <div>
        <div class="overview-kicker mb-2">Partner network</div>
        <h1 class="text-h4 font-weight-bold mb-1" style="color: #153651">
          Overview
        </h1>
        <p class="text-body-1 mb-0" style="color: #587474">
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

    <v-row dense>
      <v-col v-for="card in cards" :key="card.label" cols="12" md="3" sm="6">
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
              <v-icon :icon="card.icon" size="22" />
            </span>
            <span class="role-card__value">
              {{ loading ? '—' : card.value }}
            </span>
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

    <div class="mt-10">
      <div class="mb-4 d-flex flex-wrap align-end justify-space-between ga-4">
        <div>
          <div class="overview-kicker mb-2">Cumulative from CDRs</div>
          <h2 class="text-h5 font-weight-bold mb-1" style="color: #153651">
            Money earned VS owed
          </h2>
          <p class="text-body-1 mb-0" style="color: #587474">
            Sum of CDR total cost by end date — earned = CDRs we sent to eMSPs,
            owed = CDRs we received from CPOs.
          </p>
        </div>

        <div
          class="flex flex-row gap-20 align-center ga-3 rounded-lg px-4 py-2"
        >
          <v-menu
            v-model="dateMenuOpen"
            :close-on-content-click="false"
            location="bottom end"
          >
            <template #activator="{ props: menuProps }">
              <v-text-field
                v-bind="menuProps"
                bg-color="white"
                density="compact"
                hide-details
                label="Date range"
                :model-value="dateRangeLabel"
                prepend-inner-icon="mdi-calendar-range"
                readonly
                style="max-width: 260px"
              />
            </template>

            <v-card class="bg-white" rounded="lg">
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

      <v-row dense>
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
  </div>
</template>

<script lang="ts" setup>
import type {
  CdrFinancials,
  CurrencyAmount,
  PartnerRoleCounts,
} from '@/types/partner';
import { computed, onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { fetchCdrFinancials, fetchPartnerRoleCounts } from '@/api/partners';

const router = useRouter();
const counts = ref<PartnerRoleCounts | null>(null);
const loading = ref(false);
const error = ref<string | null>(null);

function toDateInput(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const today = new Date();
const thirtyDaysAgo = new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000);

const fromDate = ref(toDateInput(thirtyDaysAgo));
const toDate = ref(toDateInput(today));
const dateMenuOpen = ref(false);
const dateRangeModel = ref<Date[]>([thirtyDaysAgo, today]);
const financials = ref<CdrFinancials | null>(null);
const financialsLoading = ref(false);
const financialsError = ref<string | null>(null);

const dateRangeLabel = computed(() =>
  fromDate.value && toDate.value ? `${fromDate.value} → ${toDate.value}` : '',
);

function onDateRangeSelected(value: Date[]) {
  if (value.length < 2) return;
  // eslint-disable-next-line unicorn/no-array-sort -- toSorted needs ES2023 lib, not configured here
  const sorted = value.slice().sort((a, b) => a.getTime() - b.getTime());
  fromDate.value = toDateInput(sorted[0]);
  toDate.value = toDateInput(sorted.at(-1)!);
  dateMenuOpen.value = false;
  loadFinancials();
}

function formatAmounts(amounts: CurrencyAmount[] | undefined): string {
  if (!amounts || amounts.length === 0) return '0';
  return amounts
    .map(
      ({ currency, amount }) =>
        `${amount.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ${currency}`,
    )
    .join(' · ');
}

async function loadFinancials() {
  if (!fromDate.value || !toDate.value) return;
  financialsLoading.value = true;
  financialsError.value = null;
  try {
    financials.value = await fetchCdrFinancials(
      `${fromDate.value}T00:00:00.000Z`,
      `${toDate.value}T23:59:59.999Z`,
    );
  } catch (error_) {
    financials.value = null;
    financialsError.value =
      error_ instanceof Error ? error_.message : String(error_);
  } finally {
    financialsLoading.value = false;
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
    hint: 'Used by both CPO and eMSP',
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
]);

function openCard(to: { name: string } | undefined) {
  if (to) router.push(to);
}

async function load() {
  loading.value = true;
  error.value = null;
  try {
    counts.value = await fetchPartnerRoleCounts();
  } catch (error_) {
    counts.value = null;
    error.value = error_ instanceof Error ? error_.message : String(error_);
  } finally {
    loading.value = false;
  }
}

onMounted(load);
onMounted(loadFinancials);
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

.role-card {
  display: block;
  width: 100%;
  text-align: left;
  border: 1px solid transparent;
  border-radius: 1rem;
  padding: 1.25rem 1.35rem;
  min-height: 148px;
  transition:
    transform 0.15s ease,
    box-shadow 0.15s ease;
}

.role-card--clickable {
  cursor: pointer;
}

.role-card--clickable:hover {
  transform: translateY(-1px);
  box-shadow: 0 4px 14px color-mix(in srgb, #153651 8%, transparent);
}

.role-card__top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 1.25rem;
}

.role-card__icon {
  width: 42px;
  height: 42px;
  border-radius: 12px;
  display: grid;
  place-items: center;
}

.role-card__value {
  font-size: 2.25rem;
  font-weight: 700;
  line-height: 1;
}

.role-card__label {
  font-size: 1.05rem;
  font-weight: 700;
}

.role-card__hint {
  margin-top: 0.25rem;
  font-size: 0.8rem;
  opacity: 0.8;
}

.role-card--cpo {
  background: #e7fbfe;
  border-color: #9ff0f9;
  color: #032c30;
}
.role-card--cpo .role-card__icon {
  background: #0edaf1;
  color: #021f22;
}

.role-card--emsp {
  background: #eceff8;
  border-color: #b5bfe3;
  color: #0e1325;
}
.role-card--emsp .role-card__icon {
  background: #4560ba;
  color: #fff;
}

.role-card--hub {
  background: #eef1f7;
  border-color: #bbc6dd;
  color: #111722;
}
.role-card--hub .role-card__icon {
  background: #5471ab;
  color: #fff;
}

.role-card--total {
  background: #ebf3fa;
  border-color: #aecfea;
  color: #0b1b28;
}
.role-card--total .role-card__icon {
  background: #3687c9;
  color: #fff;
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
</style>
