<!--
SPDX-FileCopyrightText: 2026 Contributors to the CitrineOS Project

SPDX-License-Identifier: Apache-2.0
-->

<template>
  <div class="map-card rounded-lg">
    <div v-if="points.length === 0" class="map-empty">
      No mappable locations (missing coordinates).
    </div>
    <div
      ref="mapEl"
      class="map-el"
      :class="{ 'map-el--hidden': points.length === 0 }"
    />
    <div v-if="hasPartnerPoints" class="map-legend">
      <span class="map-legend__item"><span class="dot dot--own" /> Our locations</span>
      <span class="map-legend__item"><span class="dot dot--partner" /> Partner locations</span>
    </div>
  </div>
</template>

<script lang="ts" setup>
  import type { OcpiLocationReceived } from '@/types/partner'
  import L from 'leaflet'
  import markerIcon2xUrl from 'leaflet/dist/images/marker-icon-2x.png'
  import markerIconUrl from 'leaflet/dist/images/marker-icon.png'
  import markerShadowUrl from 'leaflet/dist/images/marker-shadow.png'
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import 'leaflet/dist/leaflet.css'

  // Vite doesn't resolve Leaflet's default marker icon paths the way its
  // bundled `_getIconUrl` expects, so icons 404 unless re-pointed at the
  // Vite-processed asset URLs.
  delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: markerIcon2xUrl,
    iconUrl: markerIconUrl,
    shadowUrl: markerShadowUrl,
  })

  // Same silhouette/size as Leaflet's default pin, just recolored, so
  // partner locations stand out without needing a separate image asset.
  function coloredPinIcon (color: string) {
    return L.divIcon({
      className: 'colored-pin-icon',
      html: `<svg width="25" height="41" viewBox="0 0 25 41" xmlns="http://www.w3.org/2000/svg">
        <path d="M12.5 0C5.6 0 0 5.6 0 12.5c0 9.4 12.5 28.5 12.5 28.5s12.5-19.1 12.5-28.5C25 5.6 19.4 0 12.5 0z" fill="${color}" stroke="#153651" stroke-width="1" />
        <circle cx="12.5" cy="12.5" r="5" fill="#ffffff" />
      </svg>`,
      iconSize: [25, 41],
      iconAnchor: [12, 41],
      popupAnchor: [1, -34],
    })
  }

  const partnerIcon = coloredPinIcon('#f2b705')

  const props = defineProps<{
    locations: OcpiLocationReceived[]
  }>()

  const mapEl = ref<HTMLElement | null>(null)
  let map: L.Map | null = null
  let markers: L.LayerGroup | null = null

  type LocatedLocation = OcpiLocationReceived & {
    latitude: number
    longitude: number
  }

  const points = computed<LocatedLocation[]>(() =>
    props.locations.filter(
      (loc): loc is LocatedLocation =>
        loc.latitude != null && loc.longitude != null,
    ),
  )

  const hasPartnerPoints = computed(() =>
    points.value.some(loc => loc.ownership === 'partner'),
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
      pts.map(loc => {
        const popup = `<strong>${loc.name ?? loc.ocpiId}</strong><br>${loc.address}, ${loc.city}`
        const marker = loc.ownership === 'partner'
          ? L.marker([loc.latitude, loc.longitude], { icon: partnerIcon })
          : L.marker([loc.latitude, loc.longitude])
        return marker.bindPopup(popup)
      }),
    ).addTo(map)

    const bounds = L.latLngBounds(
      pts.map(loc => [loc.latitude, loc.longitude]),
    )
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

.map-legend {
  display: flex;
  gap: 1rem;
  padding: 0.5rem 1rem;
  font-size: 0.8rem;
  color: #587474;
  border-top: 1px solid #c5d3d3;
}

.dot {
  display: inline-block;
  width: 10px;
  height: 10px;
  border-radius: 50%;
  margin-right: 0.35rem;
  vertical-align: middle;
}

.dot--own {
  background: #3687c9;
}

.dot--partner {
  background: #f2b705;
  border: 1px solid #153651;
}
</style>
