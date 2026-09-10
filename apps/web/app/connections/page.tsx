'use client';

import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { RequireAuth } from '../../components/require-auth';
import { api, ApiError } from '../../lib/api';
import type {
  ConnectionRequestView,
  ConnectionsResponse,
  IncomingRequestsResponse,
  OutgoingRequestsResponse,
} from '../../lib/types';
import { Alert, Badge, Button, Card, EmptyState, Spinner } from '../../components/ui';

type Tab = 'incoming' | 'outgoing' | 'connections';

export default function ConnectionsPage() {
  return (
    <RequireAuth>
      <Connections />
    </RequireAuth>
  );
}

function Connections() {
  const [tab, setTab] = useState<Tab>('incoming');
  const [incoming, setIncoming] = useState<IncomingRequestsResponse>([]);
  const [outgoing, setOutgoing] = useState<OutgoingRequestsResponse>([]);
  const [connections, setConnections] = useState<ConnectionsResponse>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [inc, out, conns] = await Promise.all([
        api.get<IncomingRequestsResponse>('/connections/requests/incoming'),
        api.get<OutgoingRequestsResponse>('/connections/requests/outgoing'),
        api.get<ConnectionsResponse>('/connections'),
      ]);
      setIncoming(inc);
      setOutgoing(out);
      setConnections(conns);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not load your connections.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  async function act(id: string, fn: () => Promise<unknown>) {
    setBusyId(id);
    setError(null);
    try {
      await fn();
      await loadAll();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'That action failed. Please retry.');
    } finally {
      setBusyId(null);
    }
  }

  const tabs: { key: Tab; label: string; count: number }[] = [
    { key: 'incoming', label: 'Incoming', count: incoming.length },
    { key: 'outgoing', label: 'Outgoing', count: outgoing.length },
    { key: 'connections', label: 'Connected', count: connections.length },
  ];

  return (
    <main className="mx-auto max-w-2xl px-4 py-8">
      <h1 className="text-xl font-semibold text-gray-900">Connections</h1>

      <div className="mt-4 flex gap-1 rounded-lg bg-gray-100 p-1 text-sm">
        {tabs.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex-1 rounded-md py-1.5 font-medium ${
              tab === t.key ? 'bg-white shadow-sm' : 'text-gray-500'
            }`}
          >
            {t.label} {t.count > 0 && `(${t.count})`}
          </button>
        ))}
      </div>

      <div className="mt-4 flex flex-col gap-3">
        {error && <Alert>{error}</Alert>}
        {loading && (
          <div className="flex justify-center py-8">
            <Spinner />
          </div>
        )}

        {!loading && tab === 'incoming' && (
          <RequestList
            requests={incoming}
            renderActions={(r) => (
              <>
                <Button disabled={busyId === r.id} onClick={() => act(r.id, () => api.post(`/connections/requests/${r.id}/accept`))}>
                  Accept
                </Button>
                <Button
                  variant="secondary"
                  disabled={busyId === r.id}
                  onClick={() => act(r.id, () => api.post(`/connections/requests/${r.id}/decline`))}
                >
                  Decline
                </Button>
              </>
            )}
            empty="No incoming requests right now."
          />
        )}

        {!loading && tab === 'outgoing' && (
          <RequestList
            requests={outgoing}
            renderActions={(r) => (
              <Button
                variant="secondary"
                disabled={busyId === r.id}
                onClick={() => act(r.id, () => api.delete(`/connections/requests/${r.id}`))}
              >
                Cancel
              </Button>
            )}
            empty="You haven't sent any requests yet."
          />
        )}

        {!loading && tab === 'connections' && (
          <>
            {connections.length === 0 && <EmptyState>No active connections yet.</EmptyState>}
            {connections.map((c) => (
              <Card key={c.id} className="flex items-center justify-between gap-3">
                <div>
                  <div className="font-medium text-gray-900">
                    {c.otherUser.firstName}
                    {c.otherUser.verificationBadge === 'GOOGLE_VERIFIED' && (
                      <Badge tone="brand"> Verified</Badge>
                    )}
                  </div>
                  <div className="text-xs text-gray-500">{c.activityKey}</div>
                </div>
                <div className="flex gap-2">
                  <Link href={`/chat/${c.conversationId}`}>
                    <Button>Chat</Button>
                  </Link>
                  <Button
                    variant="danger"
                    disabled={busyId === c.id}
                    onClick={() =>
                      confirm(`Unmatch with ${c.otherUser.firstName}?`) &&
                      act(c.id, () => api.delete(`/connections/${c.id}`))
                    }
                  >
                    Unmatch
                  </Button>
                </div>
              </Card>
            ))}
          </>
        )}
      </div>
    </main>
  );
}

function RequestList({
  requests,
  renderActions,
  empty,
}: {
  requests: ConnectionRequestView[];
  renderActions: (r: ConnectionRequestView) => React.ReactNode;
  empty: string;
}) {
  if (requests.length === 0) {
    return <EmptyState>{empty}</EmptyState>;
  }
  return (
    <>
      {requests.map((r) => (
        <Card key={r.id} className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-gray-900">
              {r.otherUser.firstName}
              {r.otherUser.verificationBadge === 'GOOGLE_VERIFIED' && <Badge tone="brand"> Verified</Badge>}
            </div>
            <div className="text-xs text-gray-500">{r.activityKey}</div>
          </div>
          <div className="flex gap-2">{renderActions(r)}</div>
        </Card>
      ))}
    </>
  );
}
