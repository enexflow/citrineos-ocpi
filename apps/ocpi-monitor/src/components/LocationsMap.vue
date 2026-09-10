<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="map-card rounded-lg">
    <div v-if="points.length === 0" class="map-empty">
      No mappable locations (missing coordinates).
    </div>
    <div ref="mapEl" class="map-el" :class="{ 'map-el--hidden': points.length === 0 }" />
  </div>
</template>

<script lang="ts" setup>
  import type { OcpiLocationReceived } from '@/types/partner'
  import L from 'leaflet'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import 'leaflet/dist/leaflet.css'

  const props = defineProps<{
    locations: OcpiLocationReceived[]
  }>()

  const mapEl = ref<HTMLElement | null>(null)
  let map: L.Map | null = null
  let markers: L.LayerGroup | null = null

  type LocatedLocation = OcpiLocationReceived & { latitude: number, longitude: number }

  const points = computed<LocatedLocation[]>(() =>
    props.locations.filter(
      (loc): loc is LocatedLocation => loc.latitude != null && loc.longitude != null,
    ),
  )

  function render () {
    if (!mapEl.value) return
    const pts = points.value
    if (pts.length === 0) return

    if (!map) {
      // eslint-disable-next-line unicorn/no-array-callback-reference -- Leaflet's map factory, not Array.prototype.map
      map = L.map(mapEl.value)
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)
    }

    markers?.remove()
    markers = L.layerGroup(
      pts.map(loc =>
        L.marker([loc.latitude, loc.longitude]).bindPopup(
          `<strong>${loc.name ?? loc.ocpiId}</strong><br>${loc.address}, ${loc.city}`,
        ),
      ),
    ).addTo(map)

    const bounds = L.latLngBounds(pts.map(loc => [loc.latitude, loc.longitude]))
    if (pts.length === 1) {
      map.setView(bounds.getCenter(), 14)
    } else {
      map.fitBounds(bounds, { padding: [24, 24] })
    }
    map.invalidateSize()
  }

  watch(() => props.locations, render, { deep: true, flush: 'post' })
  onMounted(render)
  onBeforeUnmount(() => {
    map?.remove()
    map = null
  })
</script>

<style scoped>
.map-card {
  border: 1px solid #c5d3d3;
  overflow: hidden;
  background: #ffffff;
}

.map-el {
  height: 360px;
  width: 100%;
}

.map-el--hidden {
  display: none;
}

.map-empty {
  padding: 2rem;
  text-align: center;
  color: #587474;
}
</style>
