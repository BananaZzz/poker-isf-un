import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { AvatarBadge } from '@/components/AvatarPicker';
import { formatCurrency } from '@/lib/money';
import { ProfilePanel } from '@/components/ProfilePanel';
import { MarkSettledButton } from '@/components/SettlementActions';

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

  // Open balances (settlement bookkeeping) — distinct from pairwise pot
  // attribution above. This tracks who ought to hand cash to whom based on
  // each session's final net result.
  const [owedByMe, owedToMe] = await Promise.all([
    prisma.settlementObligation.findMany({
      where: { debtorUserId: user.id },
      include: { creditor: true, session: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
    prisma.settlementObligation.findMany({
      where: { creditorUserId: user.id },
      include: { debtor: true, session: true },
      orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
    }),
  ]);
  const totalIOweOpen = owedByMe.filter((o) => o.status === 'OPEN').reduce((s, o) => s + o.amountCents, 0);
  const totalOwedToMeOpen = owedToMe.filter((o) => o.status === 'OPEN').reduce((s, o) => s + o.amountCents, 0);
  const netOpen = totalOwedToMeOpen - totalIOweOpen;

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
            <div className="overflow-x-auto -mx-2"><table className="w-full text-sm min-w-[400px]">
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
            </table></div>
          )}
        </div>

        <div className="card-panel">
          <div className="flex items-baseline justify-between flex-wrap gap-2 mb-4">
            <h2 className="text-xl font-display brass-text">Open balances</h2>
            <div className="text-xs text-ink-500">
              <span className="text-red-400">−{formatCurrency(totalIOweOpen)}</span>
              {' · '}
              <span className="text-green-400">+{formatCurrency(totalOwedToMeOpen)}</span>
              {' · net '}
              <span className={netOpen >= 0 ? 'text-green-400' : 'text-red-400'}>
                {formatCurrency(netOpen, { showSign: true })}
              </span>
            </div>
          </div>
          <p className="text-[10px] text-ink-500 mb-3">
            Bookkeeping only — the app never moves money. Distinct from pot attribution above.
          </p>
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h3 className="text-sm text-white/80 mb-2">You owe</h3>
              {owedByMe.length === 0 ? (
                <p className="text-ink-500 text-xs">Nothing outstanding.</p>
              ) : (
                <div className="grid gap-2">
                  {owedByMe.map((o) => (
                    <div key={o.id} className="stack-card">
                      <div className="stack-card-row">
                        <div>
                          <div className="font-semibold">{o.creditor.username}</div>
                          <div className="text-[10px] text-ink-500">
                            {o.session.name} · {new Date(o.session.startedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className={`text-right font-mono ${o.status === 'OPEN' ? 'text-red-400' : 'text-ink-500 line-through'}`}>
                          {formatCurrency(o.amountCents)}
                        </div>
                      </div>
                      <div className="stack-card-row">
                        <span className={`text-[10px] uppercase tracking-widest ${o.status === 'OPEN' ? 'text-brass-400' : 'text-ink-500'}`}>
                          {o.status}
                        </span>
                        <MarkSettledButton
                          obligationId={o.id}
                          amountCents={o.amountCents}
                          counterparty={o.creditor.username}
                          currentStatus={o.status as 'OPEN' | 'SETTLED'}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            <div>
              <h3 className="text-sm text-white/80 mb-2">Owed to you</h3>
              {owedToMe.length === 0 ? (
                <p className="text-ink-500 text-xs">Nothing outstanding.</p>
              ) : (
                <div className="grid gap-2">
                  {owedToMe.map((o) => (
                    <div key={o.id} className="stack-card">
                      <div className="stack-card-row">
                        <div>
                          <div className="font-semibold">{o.debtor.username}</div>
                          <div className="text-[10px] text-ink-500">
                            {o.session.name} · {new Date(o.session.startedAt).toLocaleDateString()}
                          </div>
                        </div>
                        <div className={`text-right font-mono ${o.status === 'OPEN' ? 'text-green-400' : 'text-ink-500 line-through'}`}>
                          {formatCurrency(o.amountCents)}
                        </div>
                      </div>
                      <div className="stack-card-row">
                        <span className={`text-[10px] uppercase tracking-widest ${o.status === 'OPEN' ? 'text-brass-400' : 'text-ink-500'}`}>
                          {o.status}
                        </span>
                        <MarkSettledButton
                          obligationId={o.id}
                          amountCents={o.amountCents}
                          counterparty={o.debtor.username}
                          currentStatus={o.status as 'OPEN' | 'SETTLED'}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">Performance by opponent</h2>
          {opponents.length === 0 ? (
            <p className="text-ink-500">Play a game to build your opponent stats.</p>
          ) : (
            <div className="overflow-x-auto -mx-2"><table className="w-full text-sm min-w-[400px]">
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
            </table></div>
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
            avatarUpdatedAt: user.avatarUpdatedAt ? user.avatarUpdatedAt.toISOString() : null,
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
