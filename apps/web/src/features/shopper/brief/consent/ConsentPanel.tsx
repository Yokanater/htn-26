import type { ConsentRecord } from '@sei/contracts';
import { useState } from 'react';

/** Temporary callback result until the server exposes a consent mutation response contract. */
export type Result = { ok: boolean };
export type ConsentActionResult = Result;

export type ConsentPanelProps = {
  consent: ConsentRecord | null;
  onGrant: () => Promise<Result>;
  onWithdraw: () => Promise<Result>;
  onDeleteSession: () => Promise<Result>;
};

function currentState(consent: ConsentRecord | null) {
  if (!consent || consent.state === 'declined') return 'not granted';
  return consent.state;
}

export function ConsentPanel({ consent, onGrant, onWithdraw, onDeleteSession }: ConsentPanelProps) {
  const [optedIn, setOptedIn] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [pending, setPending] = useState<'grant' | 'withdraw' | 'delete' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(action: typeof pending, callback: () => Promise<Result>) {
    setPending(action);
    setError(null);
    try {
      const result = await callback();
      if (!result.ok) setError('We could not update your sharing preference. Please try again.');
    } catch {
      setError('We could not update your sharing preference. Please try again.');
    } finally {
      setPending(null);
    }
  }

  const state = currentState(consent);
  const canWithdraw = consent?.state === 'granted';
  const canGrant = optedIn && !canWithdraw;

  return (
    <section aria-label="Sharing preferences">
      <h2>Sharing preferences</h2>
      <p>
        Sharing is off by default and does not affect your matching. If you opt in, your structured
        preferences and explicit selections contribute to aggregate merchant insights. Merchants see
        only thresholded aggregate counts of consented sessions (not people). They never see images,
        free text, or identifiers.
      </p>
      <p>
        Current state: <strong>{state}</strong>
        {consent ? ` (consent version ${consent.version})` : ''}.
      </p>
      {!canWithdraw && (
        <label>
          <input
            checked={optedIn}
            onChange={(event) => setOptedIn(event.target.checked)}
            type="checkbox"
          />
          I agree to share my structured preferences and explicit selections as described above.
        </label>
      )}
      {canGrant && (
        <button disabled={pending !== null} onClick={() => run('grant', onGrant)} type="button">
          {pending === 'grant' ? 'Saving…' : 'Opt in to aggregate insights'}
        </button>
      )}
      {canWithdraw && (
        <>
          <p>
            Withdrawing excludes this whole session&apos;s contributions. If you opt in again, it
            starts a new consent version and does not restore past contributions.
          </p>
          <button
            disabled={pending !== null}
            onClick={() => run('withdraw', onWithdraw)}
            type="button"
          >
            {pending === 'withdraw' ? 'Withdrawing…' : 'Withdraw consent'}
          </button>
        </>
      )}
      <div>
        <button disabled={pending !== null} onClick={() => setDeleting(true)} type="button">
          Delete my data
        </button>
        {deleting && (
          <div aria-label="Confirm data deletion" role="alertdialog">
            <p>
              Delete your assets, briefs, and events? This also invalidates derived snapshots. This
              cannot be undone.
            </p>
            <button disabled={pending !== null} onClick={() => setDeleting(false)} type="button">
              Cancel deletion
            </button>
            <button
              disabled={pending !== null}
              onClick={() => run('delete', onDeleteSession)}
              type="button"
            >
              {pending === 'delete' ? 'Deleting…' : 'Confirm delete my data'}
            </button>
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
