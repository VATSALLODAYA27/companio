'use client';

import { useEffect, useState } from 'react';
import { RequireAuth } from '../../components/require-auth';
import { CompanionCard } from '../../components/companion-card';
import { api, ApiError } from '../../lib/api';
import {
  ACTIVITY_KEYS,
  SEARCH_RADIUS_METERS_VALUES,
  type ActivityKey,
  type NearbyCompanion,
} from '../../lib/types';
import type { ActivitiesListResponse, NearbyResponse } from '../../lib/types';
import { Alert, Button, Card, EmptyState, Label, Select, Spinner } from '../../components/ui';

export default function DiscoverPage() {
  return (
    <RequireAuth>
      <Discover />
    </RequireAuth>
  );
}

function Discover() {
  const [activityOptions, setActivityOptions] = useState<ActivitiesListResponse['activities']>([]);
  const [activityKey, setActivityKey] = useState<ActivityKey | ''>('');
  const [radiusMeters, setRadiusMeters] = useState<number>(SEARCH_RADIUS_METERS_VALUES[2]);
  const [results, setResults] = useState<NearbyCompanion[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);

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
      const params = new URLSearchParams({
        activityKey,
        radiusMeters: String(radiusMeters),
      });
      const res = await api.get<NearbyResponse<NearbyCompanion>>(`/discovery/nearby?${params}`);
      setResults(res.results);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load nearby people.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900">Discover</h1>
      <p className="mt-1 text-sm text-gray-500">
        Find someone nearby who wants to do the same thing, right now.
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

      <div className="mt-5 flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        {loading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}
        {!loading && searched && results.length === 0 && !error && (
          <EmptyState>
            No one nearby for this activity right now. Try a bigger radius, or set your location
            in Profile if you haven&apos;t yet.
          </EmptyState>
        )}
        {!loading &&
          results.map((companion) => (
            <CompanionCard key={companion.userId} companion={companion} />
          ))}
      </div>
    </main>
  );
}
