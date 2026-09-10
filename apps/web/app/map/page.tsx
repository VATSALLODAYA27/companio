'use client';

import { useEffect, useRef, useState } from 'react';
import type { Map as LeafletMap, CircleMarker, LayerGroup } from 'leaflet';
import { RequireAuth } from '../../components/require-auth';
import { CompanionCard } from '../../components/companion-card';
import { api, ApiError } from '../../lib/api';
import {
  ACTIVITY_KEYS,
  MAP_FUZZ_RADIUS_METERS,
  SEARCH_RADIUS_METERS_VALUES,
  type ActivityKey,
  type MapPin,
} from '../../lib/types';
import type { ActivitiesListResponse, MapNearbyResponse } from '../../lib/types';
import { Alert, Button, Card, EmptyState, Label, Select, Spinner } from '../../components/ui';

const DEFAULT_CENTER: [number, number] = [20, 0];

export default function MapPage() {
  return (
    <RequireAuth>
      <MapView />
    </RequireAuth>
  );
}

function MapView() {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<LeafletMap | null>(null);
  const layerGroupRef = useRef<LayerGroup | null>(null);

  const [activityOptions, setActivityOptions] = useState<ActivitiesListResponse['activities']>([]);
  const [activityKey, setActivityKey] = useState<ActivityKey | ''>('');
  const [radiusMeters, setRadiusMeters] = useState<number>(SEARCH_RADIUS_METERS_VALUES[2]);
  const [pins, setPins] = useState<MapPin[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

  // Init the map once, client-side only (leaflet touches `window`).
  useEffect(() => {
    let cancelled = false;
    import('leaflet').then((L) => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const map = L.map(containerRef.current).setView(DEFAULT_CENTER, 2);
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap contributors',
        maxZoom: 19,
      }).addTo(map);
      mapRef.current = map;
      layerGroupRef.current = L.layerGroup().addTo(map);

      navigator.geolocation?.getCurrentPosition(
        (pos) => map.setView([pos.coords.latitude, pos.coords.longitude], 12),
        () => {},
        { timeout: 5000 },
      );
    });
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Redraw markers whenever results change.
  useEffect(() => {
    import('leaflet').then((L) => {
      const group = layerGroupRef.current;
      const map = mapRef.current;
      if (!group || !map) return;
      group.clearLayers();

      const markers: CircleMarker[] = [];
      pins.forEach((pin) => {
        const marker = L.circleMarker([pin.latitude, pin.longitude], {
          radius: 9,
          color: '#15803d',
          fillColor: '#16a34a',
          fillOpacity: 0.85,
          weight: 2,
        }).bindPopup(
          `<strong>${escapeHtml(pin.firstName)}</strong><br/>${escapeHtml(pin.distanceLabel)} away · ${escapeHtml(pin.availability.replace('_', ' '))}`,
        );
        L.circle([pin.latitude, pin.longitude], {
          radius: MAP_FUZZ_RADIUS_METERS,
          color: '#16a34a',
          weight: 1,
          fillOpacity: 0.06,
        }).addTo(group);
        marker.addTo(group);
        markers.push(marker);
      });

      if (pins.length > 0) {
        const bounds = L.latLngBounds(pins.map((p) => [p.latitude, p.longitude] as [number, number]));
        map.fitBounds(bounds.pad(0.3), { maxZoom: 14 });
      }
    });
  }, [pins]);

  useEffect(() => {
    api
      .get<ActivitiesListResponse>('/activities')
      .then((res) => {
        setActivityOptions(res.activities);
        if (res.activities[0]) setActivityKey(res.activities[0].key as ActivityKey);
      })
      .catch(() => setActivityOptions(ACTIVITY_KEYS.map((k) => ({ key: k, label: k }))));
  }, []);

  async function handleSearch(e?: React.FormEvent) {
    e?.preventDefault();
    if (!activityKey) return;
    setLoading(true);
    setError(null);
    setSearched(true);
    try {
      const params = new URLSearchParams({ activityKey, radiusMeters: String(radiusMeters) });
      const res = await api.get<MapNearbyResponse<MapPin>>(`/map/nearby?${params}`);
      setPins(res.pins);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load the map.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900">Map</h1>
      <p className="mt-1 text-sm text-gray-500">
        Pins are randomized within {MAP_FUZZ_RADIUS_METERS} m of the real position — never exact —
        shown here as the shaded circle around each pin.
      </p>

      <Card className="mt-4">
        <form onSubmit={handleSearch} className="flex flex-wrap items-end gap-3">
          <div className="min-w-[10rem] flex-1">
            <Label>Activity</Label>
            <Select value={activityKey} onChange={(e) => setActivityKey(e.target.value as ActivityKey)}>
              {activityOptions.map((a) => (
                <option key={a.key} value={a.key}>
                  {a.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="min-w-[8rem]">
            <Label>Radius</Label>
            <Select value={radiusMeters} onChange={(e) => setRadiusMeters(Number(e.target.value))}>
              {SEARCH_RADIUS_METERS_VALUES.map((m) => (
                <option key={m} value={m}>
                  {m >= 1000 ? `${m / 1000} km` : `${m} m`}
                </option>
              ))}
            </Select>
          </div>
          <Button type="submit" disabled={loading || !activityKey}>
            {loading ? 'Searching…' : 'Search'}
          </Button>
        </form>
      </Card>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <div ref={containerRef} className="mt-4 h-80 w-full rounded-2xl border border-gray-200" />

      <div className="mt-4 flex flex-col gap-3">
        {loading && (
          <div className="flex justify-center py-4">
            <Spinner />
          </div>
        )}
        {!loading && searched && pins.length === 0 && !error && (
          <EmptyState>No one nearby for this activity right now.</EmptyState>
        )}
        {!loading && pins.map((pin) => <CompanionCard key={pin.userId} companion={pin} />)}
      </div>
    </main>
  );
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
