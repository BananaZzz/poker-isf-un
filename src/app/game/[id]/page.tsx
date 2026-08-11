import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { formatCurrency } from '@/lib/money';

export const dynamic = 'force-dynamic';

export default async function GameDetail({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await getSessionUser();
  if (!user) redirect('/login');
  const s = await prisma.gameSession.findUnique({
    where: { id },
    include: { participants: true, lobby: true },
  });
  if (!s) notFound();
  const isPart = s.participants.some((p) => p.userId === user.id);
  if (!isPart) return <div className="card-panel">You are not a participant of this game.</div>;

  const isTournament = s.gameType === 'TOURNAMENT';
  const sorted = s.participants.slice().sort((a, b) => {
    if (isTournament) {
      // placement 1 first; nulls go last
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
        <table className="w-full text-sm">
          <thead>
            <tr className="text-ink-500">
              <th className="text-left py-2">#</th>
              <th className="text-left py-2">Player</th>
              <th className="text-right py-2">Buy-in</th>
              <th className="text-right py-2">Rebuys</th>
              <th className="text-right py-2">Invested</th>
              <th className="text-right py-2">Cash-out</th>
              <th className="text-right py-2">Net</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((p, i) => (
              <tr key={p.id} className="border-t border-ink-700">
                <td className="py-2">{isTournament ? (p.placement ?? '—') : i + 1}</td>
                <td className="py-2">{p.username}</td>
                <td className="py-2 text-right">{formatCurrency(p.initialBuyIn)}</td>
                <td className="py-2 text-right">{formatCurrency(p.totalRebuys)}</td>
                <td className="py-2 text-right">{formatCurrency(p.totalInvested)}</td>
                <td className="py-2 text-right">{formatCurrency(p.cashOutStack)}</td>
                <td className={`py-2 text-right font-semibold ${p.netResult >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                  {formatCurrency(p.netResult, { showSign: true })}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
