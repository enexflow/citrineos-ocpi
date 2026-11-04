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
  import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue'
  import 'leaflet/dist/leaflet.css'

  // Circle markers drawn on a single shared canvas (preferCanvas) instead of
  // one DOM <img>/SVG pin per location — stays smooth with thousands of points.
  const OWN_STYLE: L.CircleMarkerOptions = {
    radius: 6,
    color: '#153651',
    weight: 1,
    fillColor: '#3687c9',
    fillOpacity: 0.9,
  }
  const PARTNER_STYLE: L.CircleMarkerOptions = {
    ...OWN_STYLE,
    fillColor: '#f2b705',
  }

  const props = defineProps<{
    locations: OcpiLocationReceived[]
  }>()

  const mapEl = ref<HTMLElement | null>(null)
  let map: L.Map | null = null
  let markers: L.FeatureGroup | null = null
  // One popup reused for every marker, filled on click, rather than one
  // pre-built popup bound to each of the N markers.
  const sharedPopup = L.popup()

  // Names/addresses come from partners — escape before injecting into popup HTML.
  function escapeHtml (value: string): string {
    return value
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll('\'', '&#39;')
  }

  function popupHtml (loc: OcpiLocationReceived): string {
    return `<strong>${escapeHtml(loc.name ?? loc.ocpiId)}</strong><br>${escapeHtml(`${loc.address}, ${loc.city}`)}`
  }

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

    map?.closePopup()
    markers?.remove()
    markers = null
    if (pts.length === 0) return

    if (!map) {
      // eslint-disable-next-line unicorn/no-array-callback-reference, unicorn/no-array-method-this-argument -- Leaflet's map factory, not Array.prototype.map
      map = L.map(mapEl.value, { preferCanvas: true })
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map)
    }

    const locByMarker = new Map<L.Layer, LocatedLocation>()
    markers = L.featureGroup(
      pts.map(loc => {
        const marker = L.circleMarker(
          [loc.latitude, loc.longitude],
          loc.ownership === 'partner' ? PARTNER_STYLE : OWN_STYLE,
        )
        locByMarker.set(marker, loc)
        return marker
      }),
    )
      .on('click', (event: L.LeafletMouseEvent) => {
        const loc = locByMarker.get(event.propagatedFrom)
        if (!loc || !map) return
        sharedPopup
          .setLatLng([loc.latitude, loc.longitude])
          .setContent(popupHtml(loc))
          .openOn(map)
      })
      .addTo(map)

    if (pts.length === 1) {
      map.setView([pts[0].latitude, pts[0].longitude], 14)
    } else {
      map.fitBounds(markers.getBounds(), { padding: [24, 24] })
    }
    map.invalidateSize()
  }

  // Shallow: callers replace the array on (re)load. A deep watch would walk
  // every field of every location on each check.
  watch(() => props.locations, render, { flush: 'post' })
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
