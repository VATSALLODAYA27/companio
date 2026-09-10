'use client';

import { useEffect, useState } from 'react';
import { RequireAuth } from '../../components/require-auth';
import { api, ApiError } from '../../lib/api';
import {
  ACTIVITY_KEYS,
  AGE_RANGE_VALUES,
  AVAILABILITY_VALUES,
  type ActivityKey,
  type AgeRange,
  type Availability,
  type ProfileView,
} from '../../lib/types';
import type { ActivitiesListResponse, MyActivitySelection } from '../../lib/types';
import { Alert, Badge, Button, Card, Input, Label, Select, Spinner, Textarea } from '../../components/ui';

function emptyProfileForm() {
  return {
    firstName: '',
    photoUrl: '',
    ageRange: '' as AgeRange | '',
    bio: '',
    city: '',
    languages: '',
    discoverable: true,
    hidden: false,
  };
}

export default function ProfilePage() {
  return (
    <RequireAuth>
      <ProfileEditor />
    </RequireAuth>
  );
}

function ProfileEditor() {
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(emptyProfileForm());
  const [badge, setBadge] = useState<ProfileView['verificationBadge']>('NONE');
  const [profileExists, setProfileExists] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [activityOptions, setActivityOptions] = useState<ActivitiesListResponse['activities']>([]);
  const [selections, setSelections] = useState<Record<ActivityKey, Availability | null>>(
    {} as Record<ActivityKey, Availability | null>,
  );
  const [savingActivities, setSavingActivities] = useState(false);

  const [locationStatus, setLocationStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>(
    'idle',
  );
  const [manualLat, setManualLat] = useState('');
  const [manualLng, setManualLng] = useState('');

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [activities] = await Promise.all([api.get<ActivitiesListResponse>('/activities')]);
        if (cancelled) return;
        setActivityOptions(activities.activities);
      } catch {
        // Non-fatal — the activities picker just stays empty.
      }

      try {
        const profile = await api.get<ProfileView>('/profile/me');
        if (cancelled) return;
        setProfileExists(true);
        setBadge(profile.verificationBadge);
        setForm({
          firstName: profile.firstName,
          photoUrl: profile.photoUrl ?? '',
          ageRange: profile.ageRange ?? '',
          bio: profile.bio ?? '',
          city: profile.city ?? '',
          languages: profile.languages.join(', '),
          discoverable: profile.discoverable,
          hidden: profile.hidden,
        });
      } catch (err) {
        if (!(err instanceof ApiError && err.status === 404)) {
          setError('Could not load your profile. Please refresh.');
        }
      }

      try {
        const mine = await api.get<MyActivitySelection[]>('/profile/me/activities');
        if (cancelled) return;
        const map = {} as Record<ActivityKey, Availability | null>;
        for (const item of mine) {
          map[item.activityKey] = item.availability;
        }
        setSelections(map);
      } catch {
        // First-time users have none yet — fine.
      }

      if (!cancelled) setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSaveProfile(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        firstName: form.firstName,
        bio: form.bio,
        city: form.city,
        languages: form.languages
          .split(',')
          .map((l) => l.trim())
          .filter(Boolean)
          .slice(0, 10),
        discoverable: form.discoverable,
        hidden: form.hidden,
      };
      if (form.photoUrl) payload.photoUrl = form.photoUrl;
      if (form.ageRange) payload.ageRange = form.ageRange;

      const updated = await api.put<ProfileView>('/profile/me', payload);
      setProfileExists(true);
      setBadge(updated.verificationBadge);
      setSuccess('Profile saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your profile.');
    } finally {
      setSaving(false);
    }
  }

  function toggleActivity(key: ActivityKey) {
    setSelections((prev) => {
      const next = { ...prev };
      if (next[key]) {
        next[key] = null;
      } else {
        next[key] = 'NOW';
      }
      return next;
    });
  }

  function setAvailability(key: ActivityKey, availability: Availability) {
    setSelections((prev) => ({ ...prev, [key]: availability }));
  }

  async function handleSaveActivities() {
    setError(null);
    setSuccess(null);
    setSavingActivities(true);
    try {
      const activities = (Object.keys(selections) as ActivityKey[])
        .filter((key) => selections[key])
        .map((key) => ({ activityKey: key, availability: selections[key] as Availability }));
      await api.put('/profile/me/activities', { activities });
      setSuccess('Activities saved.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not save your activities.');
    } finally {
      setSavingActivities(false);
    }
  }

  async function saveLocation(latitude: number, longitude: number) {
    setLocationStatus('saving');
    try {
      await api.put('/location/me', { latitude, longitude });
      setLocationStatus('saved');
    } catch {
      setLocationStatus('error');
    }
  }

  function handleUseBrowserLocation() {
    if (!navigator.geolocation) {
      setLocationStatus('error');
      return;
    }
    setLocationStatus('saving');
    navigator.geolocation.getCurrentPosition(
      (pos) => saveLocation(pos.coords.latitude, pos.coords.longitude),
      () => setLocationStatus('error'),
      { enableHighAccuracy: false, timeout: 10_000 },
    );
  }

  async function handleManualLocation(e: React.FormEvent) {
    e.preventDefault();
    const lat = Number(manualLat);
    const lng = Number(manualLng);
    if (Number.isNaN(lat) || Number.isNaN(lng)) {
      setLocationStatus('error');
      return;
    }
    await saveLocation(lat, lng);
  }

  async function handleClearLocation() {
    setLocationStatus('saving');
    try {
      await api.delete('/location/me');
      setLocationStatus('idle');
    } catch {
      setLocationStatus('error');
    }
  }

  if (loading) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center">
        <Spinner />
      </div>
    );
  }

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900">Your profile</h1>
      <p className="mt-1 text-sm text-gray-500">
        This is what other people see before they connect with you. Age is shown only as a range,
        never a birthdate, and your exact location is never revealed to anyone.
      </p>

      {!profileExists && (
        <div className="mt-4">
          <Alert kind="info">
            You haven&apos;t saved a profile yet — fill this in so people can find you in
            Discover.
          </Alert>
        </div>
      )}
      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}
      {success && (
        <div className="mt-4">
          <Alert kind="success">{success}</Alert>
        </div>
      )}

      <Card className="mt-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-gray-800">Basics</h2>
          <Badge tone={badge === 'GOOGLE_VERIFIED' ? 'brand' : 'gray'}>
            {badge === 'GOOGLE_VERIFIED' ? 'Verified' : 'Not verified'}
          </Badge>
        </div>
        <form onSubmit={handleSaveProfile} className="flex flex-col gap-3">
          <div>
            <Label>First name</Label>
            <Input
              required
              maxLength={60}
              value={form.firstName}
              onChange={(e) => setForm((f) => ({ ...f, firstName: e.target.value }))}
            />
          </div>
          <div>
            <Label>Photo URL (https only)</Label>
            <Input
              type="url"
              value={form.photoUrl}
              onChange={(e) => setForm((f) => ({ ...f, photoUrl: e.target.value }))}
              placeholder="https://…"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Age range</Label>
              <Select
                value={form.ageRange}
                onChange={(e) =>
                  setForm((f) => ({ ...f, ageRange: e.target.value as AgeRange | '' }))
                }
              >
                <option value="">Prefer not to say</option>
                {AGE_RANGE_VALUES.map((r) => (
                  <option key={r} value={r}>
                    {r}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label>City</Label>
              <Input
                maxLength={100}
                value={form.city}
                onChange={(e) => setForm((f) => ({ ...f, city: e.target.value }))}
              />
            </div>
          </div>
          <div>
            <Label>Bio</Label>
            <Textarea
              maxLength={280}
              rows={3}
              value={form.bio}
              onChange={(e) => setForm((f) => ({ ...f, bio: e.target.value }))}
              placeholder="A couple of lines about you (max 280 characters)"
            />
          </div>
          <div>
            <Label>Languages (comma-separated)</Label>
            <Input
              value={form.languages}
              onChange={(e) => setForm((f) => ({ ...f, languages: e.target.value }))}
              placeholder="English, Hindi"
            />
          </div>
          <div className="flex flex-col gap-2 rounded-lg bg-gray-50 p-3">
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.discoverable}
                onChange={(e) => setForm((f) => ({ ...f, discoverable: e.target.checked }))}
              />
              Appear in Discover and Map results
            </label>
            <label className="flex items-center gap-2 text-sm text-gray-700">
              <input
                type="checkbox"
                checked={form.hidden}
                onChange={(e) => setForm((f) => ({ ...f, hidden: e.target.checked }))}
              />
              Hide me right now (temporary — independent of the setting above)
            </label>
          </div>
          <Button type="submit" disabled={saving} className="mt-1 self-start">
            {saving ? 'Saving…' : 'Save profile'}
          </Button>
        </form>
      </Card>

      <Card className="mt-4">
        <h2 className="mb-3 text-sm font-semibold text-gray-800">Your activities</h2>
        <p className="mb-3 text-xs text-gray-500">
          Pick what you&apos;re up for and your availability. Only activities with an availability
          set show up to others.
        </p>
        <div className="flex flex-col divide-y divide-gray-100">
          {(activityOptions.length > 0
            ? activityOptions.map((a) => a.key)
            : ACTIVITY_KEYS
          ).map((key) => {
            const option = activityOptions.find((a) => a.key === key);
            const active = !!selections[key];
            return (
              <div key={key} className="flex flex-wrap items-center gap-2 py-2">
                <label className="flex flex-1 items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" checked={active} onChange={() => toggleActivity(key)} />
                  {option?.label ?? key}
                </label>
                {active && (
                  <Select
                    className="w-auto"
                    value={selections[key] ?? 'NOW'}
                    onChange={(e) => setAvailability(key, e.target.value as Availability)}
                  >
                    {AVAILABILITY_VALUES.filter((a) => a !== 'NOT_AVAILABLE').map((a) => (
                      <option key={a} value={a}>
                        {a.replace('_', ' ')}
                      </option>
                    ))}
                  </Select>
                )}
              </div>
            );
          })}
        </div>
        <Button
          type="button"
          onClick={handleSaveActivities}
          disabled={savingActivities}
          className="mt-3"
        >
          {savingActivities ? 'Saving…' : 'Save activities'}
        </Button>
      </Card>

      <Card className="mt-4">
        <h2 className="mb-1 text-sm font-semibold text-gray-800">Location</h2>
        <p className="mb-3 text-xs text-gray-500">
          Used only to find nearby people and to compute a distance range — your exact coordinates
          are never shown to anyone, even on the map.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" onClick={handleUseBrowserLocation} disabled={locationStatus === 'saving'}>
            {locationStatus === 'saving' ? 'Getting location…' : 'Share my current location'}
          </Button>
          <Button type="button" variant="secondary" onClick={handleClearLocation}>
            Clear my location
          </Button>
        </div>
        {locationStatus === 'saved' && (
          <div className="mt-3">
            <Alert kind="success">Location saved.</Alert>
          </div>
        )}
        {locationStatus === 'error' && (
          <div className="mt-3">
            <Alert>Couldn&apos;t get your location. You can enter coordinates manually below.</Alert>
          </div>
        )}
        <form onSubmit={handleManualLocation} className="mt-3 flex flex-wrap items-end gap-2">
          <div>
            <Label>Latitude</Label>
            <Input
              value={manualLat}
              onChange={(e) => setManualLat(e.target.value)}
              placeholder="12.9716"
              className="w-32"
            />
          </div>
          <div>
            <Label>Longitude</Label>
            <Input
              value={manualLng}
              onChange={(e) => setManualLng(e.target.value)}
              placeholder="77.5946"
              className="w-32"
            />
          </div>
          <Button type="submit" variant="secondary">
            Set manually
          </Button>
        </form>
      </Card>
    </main>
  );
}
