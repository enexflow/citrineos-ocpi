<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="compliance-detail">
    <div v-if="!compliance" class="text-body-medium text-medium-emphasis">
      Gireve compliance was not computed for this location.
    </div>
    <div v-else-if="groups.length === 0" class="text-body-medium">
      <v-icon class="mr-1" color="compliance-ok" icon="mdi-check-circle" size="18" />
      No Gireve issue on {{ compliance.evseCount }} published EVSE{{
        compliance.evseCount === 1 ? '' : 's'
      }} / {{ compliance.connectorCount }} connector{{
        compliance.connectorCount === 1 ? '' : 's'
      }}.
    </div>
    <template v-else>
      <div
        v-for="group in groups"
        :key="group.key"
        class="compliance-detail__group"
      >
        <div class="compliance-detail__title">
          <template v-if="group.evseUid">
            EVSE <code class="id-code">{{ group.evseId ?? group.evseUid }}</code>
            <span v-if="group.evseId" class="text-medium-emphasis">
              (uid {{ group.evseUid }})
            </span>
          </template>
          <template v-else>Location</template>
        </div>
        <div
          v-for="(issue, index) in group.issues"
          :key="index"
          class="compliance-detail__issue"
        >
          <v-icon
            class="mr-2"
            :color="LEVEL_STYLE[issue.level].color"
            :icon="LEVEL_STYLE[issue.level].icon"
            size="16"
          />
          <div>
            <div>
              <span class="font-weight-medium">{{ issueLabel(issue) }}</span>
              <span v-if="issue.connectorId" class="text-medium-emphasis">
                · connector {{ issue.connectorId }}
              </span>
              <code class="compliance-detail__code">{{ issue.code }}</code>
            </div>
            <div class="text-body-small text-medium-emphasis">
              {{ issue.message }}
            </div>
          </div>
        </div>
      </div>
    </template>
  </div>
</template>

<script lang="ts" setup>
  import type {
    ComplianceLevel,
    LocationCompliance,
  } from '@/types/gireveCompliance'
  import { computed } from 'vue'
  import { groupIssues, issueLabel } from '@/api/gireveCompliance'

  const props = defineProps<{ compliance: LocationCompliance | undefined }>()

  const groups = computed(() => groupIssues(props.compliance?.issues ?? []))

  const LEVEL_STYLE: Record<ComplianceLevel, { color: string, icon: string }> = {
    ERROR: { color: 'compliance-error', icon: 'mdi-close-octagon' },
    WARNING: { color: 'compliance-warning', icon: 'mdi-alert' },
    INFO: { color: 'info', icon: 'mdi-information-outline' },
  }
</script>

<style scoped>
.compliance-detail {
  padding: 0.75rem 1rem;
}

.compliance-detail__group + .compliance-detail__group {
  margin-top: 0.75rem;
}

.compliance-detail__title {
  font-weight: 600;
  margin-bottom: 0.25rem;
}

.compliance-detail__issue {
  display: flex;
  align-items: flex-start;
  padding: 0.2rem 0 0.2rem 0.5rem;
}

.compliance-detail__code {
  margin-left: 0.5rem;
  font-family: var(--font-mono), monospace;
  font-size: 0.7rem;
  opacity: 0.6;
}

.id-code {
  font-family: var(--font-mono), monospace;
  font-size: 0.8rem;
  color: #205179;
}
</style>
