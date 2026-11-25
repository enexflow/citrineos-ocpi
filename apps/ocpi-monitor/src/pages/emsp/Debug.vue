<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div>
    <div class="mb-8">
      <h1 class="text-headline-medium font-weight-bold mb-1" style="color: #153651">
        Debug
      </h1>
      <p class="text-body-medium mb-0" style="color: #587474">
        Ask a peer-to-peer CPO what it has stored for one of our tokens
        (GET on its Tokens receiver). The call is made by the OCPI server with
        our credentials for that partner; the raw answer is shown below.
      </p>
    </div>

    <v-alert
      v-if="partnersError"
      class="mb-4"
      density="comfortable"
      type="error"
      variant="tonal"
    >
      {{ partnersError }}
    </v-alert>

    <v-card class="mb-6">
      <v-card-title style="color: #153651">Get token</v-card-title>
      <v-card-text>
        <v-form @submit.prevent="lookup">
          <v-row dense>
            <v-col cols="12" md="6">
              <v-select
                v-model="partnerId"
                density="comfortable"
                item-title="label"
                item-value="id"
                :items="partnerItems"
                label="Peer-to-peer CPO"
                :loading="partnersLoading"
                no-data-text="No peer-to-peer CPO partner"
                variant="outlined"
              />
            </v-col>
            <v-col cols="12" md="4">
              <v-text-field
                v-model.trim="uid"
                density="comfortable"
                label="Token uid"
                maxlength="36"
                placeholder="988EEEAA"
                variant="outlined"
              />
            </v-col>
            <v-col class="d-flex align-start" cols="12" md="2">
              <v-btn
                block
                color="#3687c9"
                :disabled="!partnerId || !uid"
                height="48"
                :loading="lookupLoading"
                type="submit"
                variant="flat"
              >
                GET
              </v-btn>
            </v-col>
          </v-row>
        </v-form>
      </v-card-text>
    </v-card>

    <v-alert
      v-if="lookupError"
      class="mb-4"
      density="comfortable"
      type="error"
      variant="tonal"
    >
      {{ lookupError }}
    </v-alert>

    <v-card v-if="result">
      <v-card-text>
        <div class="d-flex flex-wrap align-center ga-2 mb-3">
          <v-chip color="#3687c9" label size="small" variant="flat">
            {{ result.request.method }}
          </v-chip>
          <code class="debug-url">{{ result.url ?? '—' }}</code>
        </div>

        <div class="d-flex flex-wrap align-center ga-2 mb-4">
          <v-chip
            :color="result.ok ? 'success' : 'error'"
            label
            size="small"
            variant="tonal"
          >
            HTTP {{ result.ok ? '2xx' : (result.httpStatus ?? 'error') }}
          </v-chip>
          <v-chip
            v-if="ocpiStatus"
            :color="ocpiStatus.code === 1000 ? 'success' : 'warning'"
            label
            size="small"
            variant="tonal"
          >
            OCPI {{ ocpiStatus.code ?? '—' }}
            <template v-if="ocpiStatus.message">
              · {{ ocpiStatus.message }}
            </template>
          </v-chip>
          <span class="text-body-small" style="color: #587474">
            {{ result.partner.businessDetails?.name ?? '' }}
            {{ result.partner.countryCode }}/{{ result.partner.partyId }}
          </span>
        </div>

        <v-alert
          v-if="result.error"
          class="mb-4"
          density="compact"
          type="warning"
          variant="tonal"
        >
          {{ result.error }}
        </v-alert>

        <v-table v-if="tokenFields.length > 0" class="mb-4" density="compact">
          <tbody>
            <tr v-for="field in tokenFields" :key="field.key">
              <td class="debug-key">{{ field.key }}</td>
              <td>
                <v-chip
                  v-if="field.key === 'valid'"
                  :color="field.value === 'true' ? 'success' : 'error'"
                  label
                  size="x-small"
                  variant="tonal"
                >
                  {{ field.value }}
                </v-chip>
                <code v-else class="id-code">{{ field.value }}</code>
              </td>
            </tr>
          </tbody>
        </v-table>

        <div class="money-tile__label mb-2">Raw response</div>
        <pre class="debug-json">{{ rawBody }}</pre>
      </v-card-text>
    </v-card>
  </div>
</template>

<script lang="ts" setup>
  import { computed, onMounted, ref } from 'vue'
  import { fetchPartnerToken, type PartnerTokenLookup } from '@/api/ocpiSender'
  import { fetchPartnerIdentities, type PartnerIdentity } from '@/api/partnerIdentity'

  // Shown first, in this order, when the partner returns a token object
  const TOKEN_FIELD_ORDER = [
    'country_code',
    'party_id',
    'uid',
    'type',
    'contract_id',
    'visual_number',
    'issuer',
    'group_id',
    'valid',
    'whitelist',
    'language',
    'default_profile_type',
    'last_updated',
  ]

  const partners = ref<PartnerIdentity[]>([])
  const partnersLoading = ref(false)
  const partnersError = ref<string | null>(null)

  const partnerId = ref<number | null>(null)
  const uid = ref('')

  const result = ref<PartnerTokenLookup | null>(null)
  const lookupLoading = ref(false)
  const lookupError = ref<string | null>(null)

  const partnerItems = computed(() =>
    partners.value.map(partner => ({
      id: partner.id,
      label: `${partner.businessDetails?.name ?? 'Unnamed'} — ${partner.countryCode}/${partner.partyId}`,
    })),
  )

  function asRecord (value: unknown): Record<string, unknown> | null {
    return value != null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null
  }

  const ocpiStatus = computed(() => {
    const body = asRecord(result.value?.body)
    if (!body || !('status_code' in body)) return null
    return {
      code: typeof body.status_code === 'number' ? body.status_code : null,
      message:
        typeof body.status_message === 'string' ? body.status_message : null,
    }
  })

  const tokenFields = computed(() => {
    const token = asRecord(asRecord(result.value?.body)?.data)
    if (!token) return []
    const keys = [
      ...TOKEN_FIELD_ORDER.filter(key => key in token),
      ...Object.keys(token).filter(key => !TOKEN_FIELD_ORDER.includes(key)),
    ]
    return keys.map(key => {
      const value = token[key]
      return {
        key,
        value:
          value != null && typeof value === 'object'
            ? JSON.stringify(value)
            : String(value),
      }
    })
  })

  const rawBody = computed(() =>
    result.value?.body === undefined
      ? '—'
      : JSON.stringify(result.value.body, null, 2),
  )

  async function loadPartners () {
    partnersLoading.value = true
    partnersError.value = null
    try {
      const identities = await fetchPartnerIdentities()
      // Peer-to-peer CPOs only; hub-relayed partners are reached via the hub
      partners.value = identities.filter(identity => identity.role === 'CPO')
      if (partners.value.length === 1) partnerId.value = partners.value[0].id
    } catch (error_) {
      partnersError.value
        = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      partnersLoading.value = false
    }
  }

  async function lookup () {
    if (!partnerId.value || !uid.value) return
    lookupLoading.value = true
    lookupError.value = null
    result.value = null
    try {
      result.value = await fetchPartnerToken(partnerId.value, uid.value)
    } catch (error_) {
      lookupError.value
        = error_ instanceof Error ? error_.message : String(error_)
    } finally {
      lookupLoading.value = false
    }
  }

  onMounted(loadPartners)
</script>

<style scoped>
.debug-url {
  font-family: var(--font-mono), monospace;
  font-size: 0.85rem;
  color: #205179;
  word-break: break-all;
}

.debug-key {
  width: 220px;
  font-weight: 600;
  color: #587474;
}

.debug-json {
  margin: 0;
  padding: 1rem;
  max-height: 480px;
  overflow: auto;
  border-radius: 0.75rem;
  background: #f4f7f7;
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  color: #153651;
}

.id-code {
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  color: #205179;
}

.money-tile__label {
  font-size: 0.85rem;
  font-weight: 700;
  text-transform: uppercase;
  letter-spacing: 0.03em;
  color: #587474;
}
</style>
