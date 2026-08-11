import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { formatCurrency } from '@/lib/money';
import { MarkSettledButton } from '@/components/SettlementActions';

export const dynamic = 'force-dynamic';

export default async function GameDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const s = await prisma.gameSession.findUnique({
    where: { id },
    include: {
      participants: true,
      lobby: true,
      settlements: { include: { debtor: true, creditor: true }, orderBy: [{ status: 'asc' }, { amountCents: 'desc' }] },
    },
  });
  if (!s) notFound();
  const isPart = s.participants.some((p) => p.userId === user.id);
  if (!isPart) return <div className="card-panel">You are not a participant of this game.</div>;

  const isTournament = s.gameType === 'TOURNAMENT';
  const sorted = s.participants.slice().sort((a, b) => {
    if (isTournament) {
      const ap = a.placement ?? 999, bp = b.placement ?? 999;
      if (ap !== bp) return ap - bp;
    }
    return b.netResult - a.netResult;
  });
  const duration = s.endedAt ? Math.round((+s.endedAt - +s.startedAt) / 60000) : null;

  return (
    <div className="grid gap-6">
      <div className="card-panel">
        <div className="flex justify-between flex-wrap gap-2">
          <div>
            <div className="text-xs uppercase tracking-widest text-brass-400">{s.gameType}</div>
            <h1 className="text-2xl font-display">{s.name}</h1>
            <div className="text-xs text-ink-500 mt-1">
              {new Date(s.startedAt).toLocaleString()} · {s.handsPlayed} hands
              {duration !== null && ` · ${duration} min`}
            </div>
          </div>
          <Link href="/dashboard" className="btn">Back to dashboard</Link>
        </div>
      </div>

      <div className="card-panel">
        <h2 className="font-display brass-text mb-3">Final Results</h2>
        <div className="overflow-x-auto -mx-2">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="text-ink-500">
                <th className="text-left py-2 px-2">#</th>
                <th className="text-left py-2 px-2">Player</th>
                <th className="text-right py-2 px-2">Buy-in</th>
                <th className="text-right py-2 px-2">Rebuys</th>
                <th className="text-right py-2 px-2">Invested</th>
                <th className="text-right py-2 px-2">Cash-out</th>
                <th className="text-right py-2 px-2">Net</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((p, i) => (
                <tr key={p.id} className="border-t border-ink-700">
                  <td className="py-2 px-2">{isTournament ? (p.placement ?? '—') : i + 1}</td>
                  <td className="py-2 px-2">{p.username}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(p.initialBuyIn)}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(p.totalRebuys)}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(p.totalInvested)}</td>
                  <td className="py-2 px-2 text-right">{formatCurrency(p.cashOutStack)}</td>
                  <td className={`py-2 px-2 text-right font-semibold ${p.netResult >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(p.netResult, { showSign: true })}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {s.gameType === 'CASH' && (
        <div className="card-panel">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-3">
            <h2 className="font-display brass-text">Settlement / Open amounts</h2>
            <div className="text-[10px] text-ink-500">
              Deterministic: greedy largest-first matching · min transfers · integer cents
            </div>
          </div>
          {s.settlements.length === 0 ? (
            <p className="text-ink-500 text-sm">
              {s.settlementDone
                ? 'All players ended with €0 net — no settlement obligations were created.'
                : 'Settlement will be generated when the game is ended.'}
            </p>
          ) : (
            <div className="grid gap-2">
              {s.settlements.map((o) => {
                const iAmParty = o.debtorUserId === user.id || o.creditorUserId === user.id;
                return (
                  <div key={o.id} className="stack-card">
                    <div className="stack-card-row">
                      <div className="text-sm">
                        <span className="font-semibold">{o.debtor.username}</span>
                        <span className="text-ink-500"> owes </span>
                        <span className="font-semibold">{o.creditor.username}</span>
                      </div>
                      <div className={`font-mono ${o.status === 'OPEN' ? 'text-white' : 'text-ink-500 line-through'}`}>
                        {formatCurrency(o.amountCents)}
                      </div>
                    </div>
                    <div className="stack-card-row">
                      <span className={`text-[10px] uppercase tracking-widest ${o.status === 'OPEN' ? 'text-brass-400' : 'text-ink-500'}`}>
                        {o.status}
                        {o.settledAt && ` · ${new Date(o.settledAt).toLocaleDateString()}`}
                      </span>
                      {iAmParty && (
                        <MarkSettledButton
                          obligationId={o.id}
                          amountCents={o.amountCents}
                          counterparty={o.debtorUserId === user.id ? o.creditor.username : o.debtor.username}
                          currentStatus={o.status as 'OPEN' | 'SETTLED'}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
