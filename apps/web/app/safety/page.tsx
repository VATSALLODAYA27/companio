'use client';

import { useCallback, useEffect, useState } from 'react';
import { RequireAuth } from '../../components/require-auth';
import { api, ApiError } from '../../lib/api';
import type { BlockedUserView, ReportView } from '../../lib/types';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '../../components/ui';

export default function SafetyPage() {
  return (
    <RequireAuth>
      <Safety />
    </RequireAuth>
  );
}

function Safety() {
  const [blocks, setBlocks] = useState<BlockedUserView[]>([]);
  const [reports, setReports] = useState<ReportView[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [blockRes, reportRes] = await Promise.all([
        api.get<{ blocks: BlockedUserView[] }>('/safety/blocks'),
        api.get<{ reports: ReportView[] }>('/safety/reports'),
      ]);
      setBlocks(blockRes.blocks);
      setReports(reportRes.reports);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your safety settings.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  async function handleUnblock(userId: string) {
    setBusyId(userId);
    try {
      await api.delete(`/safety/blocks/${userId}`);
      setBlocks((prev) => prev.filter((b) => b.userId !== userId));
    } catch {
      setError('Could not unblock this user.');
    } finally {
      setBusyId(null);
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
      <h1 className="text-xl font-semibold text-gray-900">Safety</h1>
      <p className="mt-1 text-sm text-gray-500">
        Manage who you&apos;ve blocked and see the reports you&apos;ve filed.
      </p>

      {error && (
        <div className="mt-4">
          <Alert>{error}</Alert>
        </div>
      )}

      <section className="mt-5">
        <h2 className="mb-2 text-sm font-semibold text-gray-800">Blocked users</h2>
        {blocks.length === 0 ? (
          <EmptyState>You haven&apos;t blocked anyone.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {blocks.map((b) => (
              <Card key={b.userId} className="flex items-center justify-between">
                <span className="text-sm text-gray-800">{b.firstName ?? 'Deleted user'}</span>
                <Button
                  variant="secondary"
                  disabled={busyId === b.userId}
                  onClick={() => handleUnblock(b.userId)}
                >
                  Unblock
                </Button>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-2 text-sm font-semibold text-gray-800">Reports you&apos;ve filed</h2>
        {reports.length === 0 ? (
          <EmptyState>You haven&apos;t filed any reports.</EmptyState>
        ) : (
          <div className="flex flex-col gap-2">
            {reports.map((r) => (
              <Card key={r.id}>
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium text-gray-800">
                    {r.category.replace(/_/g, ' ')}
                  </span>
                  <Badge tone={r.status === 'RESOLVED' ? 'brand' : 'amber'}>{r.status}</Badge>
                </div>
                {r.details && <p className="mt-1 text-xs text-gray-500">{r.details}</p>}
                <p className="mt-1 text-[11px] text-gray-400">
                  {new Date(r.createdAt).toLocaleDateString()}
                </p>
              </Card>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
