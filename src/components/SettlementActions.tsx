'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { formatCurrency } from '@/lib/money';

/**
 * Small helper button used from server-rendered pages to mark or un-mark a
 * settlement obligation. Confirmation dialog matches the amount/counterparty
 * shown, to avoid accidental one-tap "I paid" clicks.
 */
export function MarkSettledButton({
  obligationId, amountCents, counterparty, currentStatus,
}: {
  obligationId: string;
  amountCents: number;
  counterparty: string;
  currentStatus: 'OPEN' | 'SETTLED';
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function toggle() {
    const settling = currentStatus === 'OPEN';
    if (settling) {
      if (!confirm(`Mark ${formatCurrency(amountCents)} with ${counterparty} as settled?`)) return;
    }
    setBusy(true);
    const r = await fetch(`/api/settlements/${obligationId}/settle`, {
      method: settling ? 'POST' : 'DELETE',
    });
    setBusy(false);
    if (r.ok) router.refresh();
  }

  return (
    <button
      onClick={toggle}
      disabled={busy}
      className={`btn text-xs min-h-10 ${currentStatus === 'OPEN' ? 'btn-primary' : ''}`}
    >
      {busy ? '…' : currentStatus === 'OPEN' ? 'Mark as settled' : 'Reopen'}
    </button>
  );
}
