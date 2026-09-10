'use client';

import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import type { NearbyCompanion } from '../lib/types';
import { Alert, Badge, Button } from './ui';
import { ReportModal } from './report-modal';

export function CompanionCard({ companion }: { companion: NearbyCompanion }) {
  const [requestState, setRequestState] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [showReport, setShowReport] = useState(false);

  async function handleConnect() {
    setRequestState('sending');
    setErrorMessage(null);
    try {
      await api.post('/connections/requests', {
        recipientId: companion.userId,
        activityKey: companion.activityKey,
      });
      setRequestState('sent');
    } catch (err) {
      setRequestState('error');
      setErrorMessage(err instanceof ApiError ? err.message : 'Could not send request.');
    }
  }

  async function handleBlock() {
    if (!confirm(`Block ${companion.firstName}? They won't be able to reach you again.`)) return;
    try {
      await api.post('/safety/blocks', { blockedUserId: companion.userId });
      setBlocked(true);
    } catch {
      setErrorMessage('Could not block this user.');
    }
  }

  if (blocked) {
    return null;
  }

  return (
    <div className="flex items-start gap-3 rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
      <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-full bg-brand-100 text-lg font-semibold text-brand-700">
        {companion.photoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={companion.photoUrl} alt="" className="h-full w-full object-cover" />
        ) : (
          companion.firstName.charAt(0).toUpperCase()
        )}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{companion.firstName}</span>
          {companion.verificationBadge === 'GOOGLE_VERIFIED' && <Badge tone="brand">Verified</Badge>}
          {companion.ageRange && <span className="text-xs text-gray-400">{companion.ageRange}</span>}
        </div>
        <div className="mt-0.5 flex items-center gap-2 text-xs text-gray-500">
          <span>{companion.distanceLabel} away</span>
          <span>·</span>
          <span>{companion.availability.replace('_', ' ')}</span>
        </div>

        {errorMessage && (
          <div className="mt-2">
            <Alert>{errorMessage}</Alert>
          </div>
        )}

        <div className="mt-2 flex flex-wrap gap-2">
          <Button
            variant={requestState === 'sent' ? 'secondary' : 'primary'}
            disabled={requestState === 'sending' || requestState === 'sent'}
            onClick={handleConnect}
          >
            {requestState === 'sent'
              ? 'Request sent'
              : requestState === 'sending'
                ? 'Sending…'
                : 'Connect'}
          </Button>
          <Button variant="ghost" onClick={() => setShowReport(true)}>
            Report
          </Button>
          <Button variant="ghost" onClick={handleBlock}>
            Block
          </Button>
        </div>
      </div>

      {showReport && (
        <ReportModal userId={companion.userId} onClose={() => setShowReport(false)} />
      )}
    </div>
  );
}
