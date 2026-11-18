import type { LngLat } from '@oregano/app-core';
import type { AdminZone } from '@oregano/contracts';
import { colors } from '@oregano/ui';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { useEffect, useRef } from 'react';

/** Chapainawabganj town: where the map opens when there is nothing to show yet. */
const START: L.LatLngTuple = [24.6, 88.27];
const START_ZOOM = 12;

const toLatLng = ([lng, lat]: LngLat): L.LatLngTuple => [lat, lng];

/**
 * Other zones in grey, the one being drawn in the brand colour with a draggable handle on every corner. Clicking the map
 * adds a corner. The map only reports what happened; the caller owns the list of corners.
 */
export function ZoneMap(props: {
  zones: AdminZone[];
  editingId: string | null;
  vertices: LngLat[];
  onAdd: (point: LngLat) => void;
  onMove: (index: number, point: LngLat) => void;
}) {
  const element = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  // The click handler is set up once, so it reads the newest callbacks through a ref.
  const callbacks = useRef(props);
  callbacks.current = props;

  useEffect(() => {
    if (!element.current) return;
    const instance = L.map(element.current).setView(START, START_ZOOM);
    L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
    }).addTo(instance);
    layer.current = L.layerGroup().addTo(instance);
    instance.on('click', (event: L.LeafletMouseEvent) => {
      callbacks.current.onAdd([event.latlng.lng, event.latlng.lat]);
    });
    map.current = instance;
    return () => {
      instance.remove();
      map.current = null;
      layer.current = null;
    };
  }, []);

  useEffect(() => {
    const group = layer.current;
    if (!group) return;
    group.clearLayers();
    for (const zone of props.zones) {
      if (zone.id === props.editingId) continue;
      const ring = (zone.boundary.coordinates[0] ?? []).map(toLatLng);
      L.polygon(ring, { color: colors.line, weight: 2, fillOpacity: 0.08, interactive: false }).addTo(group);
    }
    if (props.vertices.length >= 2) {
      L.polygon(props.vertices.map(toLatLng), {
        color: colors.plum,
        weight: 3,
        fillOpacity: 0.15,
        interactive: false,
      }).addTo(group);
    }
    props.vertices.forEach((vertex, index) => {
      const marker = L.marker(toLatLng(vertex), {
        draggable: true,
        keyboard: false,
        icon: L.divIcon({ className: 'zone-vertex', iconSize: [18, 18] }),
      });
      marker.on('dragend', () => {
        const at = marker.getLatLng();
        callbacks.current.onMove(index, [at.lng, at.lat]);
      });
      marker.addTo(group);
    });
  }, [props.zones, props.editingId, props.vertices]);

  // Show the zone that was just chosen.
  // biome-ignore lint/correctness/useExhaustiveDependencies: only when another zone is chosen, not on every corner change
  useEffect(() => {
    if (!map.current || props.vertices.length < 3) return;
    map.current.fitBounds(L.latLngBounds(props.vertices.map(toLatLng)), { padding: [24, 24], maxZoom: 15 });
  }, [props.editingId]);

  return <div ref={element} className="zone-map" role="application" aria-label="Zone map: click to add a corner" />;
}
