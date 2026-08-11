import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { AvatarBadge } from '@/components/AvatarPicker';
import { formatCurrency } from '@/lib/money';
import { ProfilePanel } from '@/components/ProfilePanel';

export const dynamic = 'force-dynamic';

export default async function Dashboard() {
  const user = await getSessionUser();
  if (!user) redirect('/login');

  const myLobbies = await prisma.lobby.findMany({
    where: {
      players: { some: { userId: user.id } },
      status: { not: 'FINISHED' },
    },
    orderBy: { createdAt: 'desc' },
    include: { players: true },
  });

  const myParticipations = await prisma.gameParticipant.findMany({
    where: { userId: user.id },
    orderBy: { id: 'desc' },
    include: { session: { include: { participants: true } } },
    take: 20,
  });

  // player-vs-player aggregation from persisted HandTransfer rows
  // net vs opp = (money moved TO me FROM opp)  -  (money moved FROM me TO opp)
  const [inFlows, outFlows] = await Promise.all([
    prisma.handTransfer.groupBy({
      by: ['fromUserId'],
      where: { toUserId: user.id },
      _sum: { amountCents: true },
    }),
    prisma.handTransfer.groupBy({
      by: ['toUserId'],
      where: { fromUserId: user.id },
      _sum: { amountCents: true },
    }),
  ]);
  const netByOpp = new Map<string, number>();
  for (const r of inFlows) netByOpp.set(r.fromUserId, (netByOpp.get(r.fromUserId) ?? 0) + (r._sum.amountCents ?? 0));
  for (const r of outFlows) netByOpp.set(r.toUserId, (netByOpp.get(r.toUserId) ?? 0) - (r._sum.amountCents ?? 0));

  const gamesByOpp = new Map<string, { username: string; games: number }>();
  for (const p of myParticipations) {
    for (const o of p.session.participants) {
      if (o.userId === user.id) continue;
      const cur = gamesByOpp.get(o.userId) ?? { username: o.username, games: 0 };
      cur.games += 1;
      cur.username = o.username;
      gamesByOpp.set(o.userId, cur);
    }
  }
  const opponentIds = new Set<string>([...netByOpp.keys(), ...gamesByOpp.keys()]);
  const opponents = [...opponentIds]
    .map((id) => ({
      id,
      username: gamesByOpp.get(id)?.username ?? 'Unknown',
      games: gamesByOpp.get(id)?.games ?? 0,
      net: netByOpp.get(id) ?? 0,
    }))
    .sort((a, b) => Math.abs(b.net) - Math.abs(a.net))
    .slice(0, 8);

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 grid gap-6">
        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">Quick actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/create" className="btn btn-primary">Create new game</Link>
            <form action="/api/invite/redirect" className="flex gap-2" method="GET">
              <input className="input w-40" name="code" placeholder="Invite code" />
              <button className="btn" type="submit">Join</button>
            </form>
          </div>
        </div>

        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">Active games</h2>
          {myLobbies.length === 0 ? (
            <p className="text-ink-500">No active lobbies. Create one to get started.</p>
          ) : (
            <div className="grid gap-3">
              {myLobbies.map((l) => (
                <Link
                  href={`/lobby/${l.id}`}
                  key={l.id}
                  className="flex justify-between items-center rounded-lg border border-ink-700 hover:border-brass-500 px-4 py-3 transition"
                >
                  <div>
                    <div className="font-semibold">{l.name}</div>
                    <div className="text-xs text-ink-500">
                      {l.gameType === 'CASH' ? 'Cash' : 'Tournament'} · {l.players.length}/{l.maxPlayers} players ·
                      SB {formatCurrency(l.smallBlind)}/BB {formatCurrency(l.bigBlind)}
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-widest text-brass-400">{l.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>

        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">Game history</h2>
          {myParticipations.length === 0 ? (
            <p className="text-ink-500">No completed games yet.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-500">
                  <th className="text-left py-2">Date</th>
                  <th className="text-left py-2">Game</th>
                  <th className="text-right py-2">Buy-in</th>
                  <th className="text-right py-2">Cash-out</th>
                  <th className="text-right py-2">Net</th>
                </tr>
              </thead>
              <tbody>
                {myParticipations.map((p) => (
                  <tr key={p.id} className="border-t border-ink-700">
                    <td className="py-2">{new Date(p.session.startedAt).toLocaleDateString()}</td>
                    <td className="py-2">
                      <Link href={`/game/${p.session.id}`} className="underline">{p.session.name}</Link>
                    </td>
                    <td className="py-2 text-right">{formatCurrency(p.totalInvested)}</td>
                    <td className="py-2 text-right">{formatCurrency(p.cashOutStack)}</td>
                    <td className={`py-2 text-right font-semibold ${p.netResult >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(p.netResult, { showSign: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">Performance by opponent</h2>
          {opponents.length === 0 ? (
            <p className="text-ink-500">Play a game to build your opponent stats.</p>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-ink-500">
                  <th className="text-left py-2">Opponent</th>
                  <th className="text-right py-2">Games together</th>
                  <th className="text-right py-2">Net vs them</th>
                </tr>
              </thead>
              <tbody>
                {opponents.map((o) => (
                  <tr key={o.id} className="border-t border-ink-700">
                    <td className="py-2">{o.username}</td>
                    <td className="py-2 text-right">{o.games}</td>
                    <td className={`py-2 text-right font-semibold ${o.net >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {formatCurrency(o.net, { showSign: true })}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <p className="text-[10px] text-ink-500 mt-2">
            Net vs opponent is computed from actual pot flows (each hand's contributions →
            winners), attributed per-pot in proportion to award share. See README.
          </p>
        </div>
      </div>

      <div className="grid gap-6">
        <ProfilePanel
          user={{
            id: user.id, username: user.username, avatar: user.avatar,
            avatarUrl: user.avatarUrl,
          }}
        />

        <div className="card-panel">
          <h3 className="font-display brass-text mb-3">Lifetime performance</h3>
          <div className={`text-3xl font-display ${user.netCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
            {formatCurrency(user.netCents, { showSign: true })}
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Games" v={String(user.gamesPlayed)} />
            <Stat label="Wins" v={String(user.gamesWon)} />
            <Stat label="Hands" v={String(user.handsPlayed)} />
            <Stat label="Win rate" v={user.gamesPlayed > 0 ? `${Math.round((user.gamesWon / user.gamesPlayed) * 100)}%` : '—'} />
            <Stat label="Biggest win" v={formatCurrency(user.biggestWinCents)} />
            <Stat label="Biggest loss" v={formatCurrency(user.biggestLossCents)} />
            <Stat label="Total won" v={formatCurrency(user.totalWonCents)} />
            <Stat label="Total lost" v={formatCurrency(user.totalLostCents)} />
          </dl>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: string }) {
  return (
    <div>
      <dt className="text-ink-500 text-xs uppercase">{label}</dt>
      <dd className="text-white">{v}</dd>
    </div>
  );
}
