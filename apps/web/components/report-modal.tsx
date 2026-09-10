'use client';

import { useState } from 'react';
import { api, ApiError } from '../lib/api';
import { REPORT_CATEGORY_VALUES, type ReportCategory } from '../lib/types';
import { Alert, Button, Label, Select, Textarea } from './ui';

export function ReportModal({
  userId,
  onClose,
  onSubmitted,
}: {
  userId: string;
  onClose: () => void;
  onSubmitted?: () => void;
}) {
  const [category, setCategory] = useState<ReportCategory>('OTHER');
  const [details, setDetails] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await api.post('/safety/reports', {
        reportedUserId: userId,
        category,
        details: details || undefined,
      });
      setDone(true);
      onSubmitted?.();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not submit the report.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4"
      role="dialog"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="w-full max-w-sm rounded-2xl bg-white p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {done ? (
          <>
            <h2 className="text-base font-semibold text-gray-900">Report submitted</h2>
            <p className="mt-2 text-sm text-gray-600">
              Thanks — our safety team will review this.
            </p>
            <Button className="mt-4 w-full" onClick={onClose}>
              Close
            </Button>
          </>
        ) : (
          <form onSubmit={handleSubmit}>
            <h2 className="text-base font-semibold text-gray-900">Report this person</h2>
            <div className="mt-3">
              <Label>Reason</Label>
              <Select value={category} onChange={(e) => setCategory(e.target.value as ReportCategory)}>
                {REPORT_CATEGORY_VALUES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace(/_/g, ' ')}
                  </option>
                ))}
              </Select>
            </div>
            <div className="mt-3">
              <Label>Details (optional)</Label>
              <Textarea
                rows={3}
                maxLength={1000}
                value={details}
                onChange={(e) => setDetails(e.target.value)}
                placeholder="Anything that helps us understand what happened"
              />
            </div>
            {error && (
              <div className="mt-3">
                <Alert>{error}</Alert>
              </div>
            )}
            <div className="mt-4 flex gap-2">
              <Button type="button" variant="secondary" className="flex-1" onClick={onClose}>
                Cancel
              </Button>
              <Button type="submit" variant="danger" className="flex-1" disabled={submitting}>
                {submitting ? 'Submitting…' : 'Submit report'}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
