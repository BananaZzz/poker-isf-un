import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { AvatarBadge } from '@/components/AvatarPicker';
import { ConnectionButton } from '@/components/ConnectionButton';
import { MarkSettledButton } from '@/components/SettlementActions';
import { formatCurrency } from '@/lib/money';
import { getConnectionState, listAcceptedConnections } from '@/lib/connections';

export const dynamic = 'force-dynamic';

export default async function PlayerProfile({ params }: { params: Promise<{ username: string }> }) {
  const { username } = await params;
  const viewer = await getSessionUser();
  if (!viewer) redirect(`/login`);

  const profile = await prisma.user.findUnique({
    where: { username: decodeURIComponent(username) },
    // NEVER select passwordHash. This is intentional — the DB layer is trusted
    // but the shape of what leaves this file is not.
    select: {
      id: true, username: true, avatar: true, avatarUpdatedAt: true, createdAt: true,
      gamesPlayed: true, handsPlayed: true, gamesWon: true, tourneyWins: true,
      netCents: true, biggestWinCents: true, biggestLossCents: true,
      totalWonCents: true, totalLostCents: true,
      showHistoryPublic: true,
    },
  });
  if (!profile) notFound();

  const isSelf = profile.id === viewer.id;

  // Connection state
  const connection = await getConnectionState(viewer.id, profile.id);

  // Recent games — only completed sessions, only if history is public OR it's self
  const showHistory = isSelf || profile.showHistoryPublic;
  const recentGames = showHistory
    ? await prisma.gameParticipant.findMany({
        where: { userId: profile.id, session: { endedAt: { not: null } } },
        include: { session: { include: { participants: true } } },
        orderBy: { id: 'desc' },
        take: 10,
      })
    : [];

  // Shared games (viewer + profile owner in same session)
  const sharedGames = isSelf
    ? []
    : await prisma.gameSession.findMany({
        where: {
          endedAt: { not: null },
          AND: [
            { participants: { some: { userId: viewer.id } } },
            { participants: { some: { userId: profile.id } } },
          ],
        },
        include: { participants: true },
        orderBy: { startedAt: 'desc' },
        take: 10,
      });

  // Settlement obligations BETWEEN viewer and this profile only.
  // Explicitly NOT selecting rows with unrelated third parties — that is
  // the privacy rule from the phase spec.
  const mutualSettlements = isSelf
    ? []
    : await prisma.settlementObligation.findMany({
        where: {
          OR: [
            { debtorUserId: viewer.id, creditorUserId: profile.id },
            { debtorUserId: profile.id, creditorUserId: viewer.id },
          ],
        },
        include: { session: true, debtor: true, creditor: true },
        orderBy: [{ status: 'asc' }, { createdAt: 'desc' }],
      });
  const iOweThem = mutualSettlements.filter((o) => o.debtorUserId === viewer.id && o.status === 'OPEN')
    .reduce((s, o) => s + o.amountCents, 0);
  const theyOweMe = mutualSettlements.filter((o) => o.creditorUserId === viewer.id && o.status === 'OPEN')
    .reduce((s, o) => s + o.amountCents, 0);

  // Own-profile: show connections list
  const ownConnections = isSelf ? await listAcceptedConnections(viewer.id) : [];

  return (
    <div className="grid gap-6">
      {/* Header */}
      <div className="card-panel">
        <div className="flex items-center gap-4 flex-wrap">
          <AvatarBadge
            user={{ id: profile.id, avatar: profile.avatar, avatarUpdatedAt: profile.avatarUpdatedAt?.getTime() ?? null }}
            size={72}
          />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-2xl brass-text">{profile.username}</h1>
            <div className="text-xs text-ink-500 mt-1">
              Member since {new Date(profile.createdAt).toLocaleDateString()}
              {isSelf && ' · this is you'}
            </div>
          </div>
          {!isSelf && (
            <ConnectionButton
              targetUserId={profile.id}
              initialState={connection.state as any}
              initialConnectionId={connection.connectionId ?? null}
            />
          )}
        </div>
      </div>

      {/* Public stats */}
      <div className="card-panel grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Games" v={String(profile.gamesPlayed)} />
        <Stat label="Wins" v={String(profile.gamesWon)} />
        <Stat label="Trophies" v={String(profile.tourneyWins)} />
        <Stat label="Hands" v={String(profile.handsPlayed)} />
        <Stat label="Lifetime net" v={formatCurrency(profile.netCents, { showSign: true })}
              color={profile.netCents >= 0 ? 'green' : 'red'} />
        <Stat label="Biggest win" v={formatCurrency(profile.biggestWinCents)} />
        <Stat label="Biggest loss" v={formatCurrency(profile.biggestLossCents)} />
        <Stat label="Won / Lost" v={`${formatCurrency(profile.totalWonCents)} / ${formatCurrency(profile.totalLostCents)}`} />
      </div>

      {/* Between you and this player — privacy-scoped */}
      {!isSelf && (
        <div className="card-panel">
          <h2 className="font-display brass-text mb-3">Between you and {profile.username}</h2>
          <div className="grid grid-cols-2 gap-3 text-sm mb-4">
            <div>
              <div className="text-ink-500 text-xs uppercase">You owe them</div>
              <div className={iOweThem > 0 ? 'text-red-400' : 'text-ink-500'}>
                {formatCurrency(iOweThem)}
              </div>
            </div>
            <div>
              <div className="text-ink-500 text-xs uppercase">They owe you</div>
              <div className={theyOweMe > 0 ? 'text-green-400' : 'text-ink-500'}>
                {formatCurrency(theyOweMe)}
              </div>
            </div>
          </div>
          <p className="text-[10px] text-ink-500 mb-3">
            Only obligations between you and {profile.username} are shown. Debts to or from
            unrelated third parties stay private.
          </p>
          {mutualSettlements.length === 0 ? (
            <p className="text-sm text-ink-500">No obligations between you.</p>
          ) : (
            <div className="grid gap-2">
              {mutualSettlements.map((o) => (
                <div key={o.id} className="stack-card">
                  <div className="stack-card-row">
                    <div className="text-sm">
                      <span className="font-semibold">
                        {o.debtorUserId === viewer.id ? 'You' : o.debtor.username}
                      </span>
                      <span className="text-ink-500"> owe{o.debtorUserId === viewer.id ? '' : 's'} </span>
                      <span className="font-semibold">
                        {o.creditorUserId === viewer.id ? 'you' : o.creditor.username}
                      </span>
                    </div>
                    <div className={`font-mono ${o.status === 'OPEN' ? 'text-white' : 'text-ink-500 line-through'}`}>
                      {formatCurrency(o.amountCents)}
                    </div>
                  </div>
                  <div className="stack-card-row">
                    <span className="text-[10px] text-ink-500">
                      {o.session.name} · {new Date(o.session.startedAt).toLocaleDateString()}
                      {o.settledAt && ` · settled ${new Date(o.settledAt).toLocaleDateString()}`}
                    </span>
                    <MarkSettledButton
                      obligationId={o.id}
                      amountCents={o.amountCents}
                      counterparty={o.debtorUserId === viewer.id ? o.creditor.username : o.debtor.username}
                      currentStatus={o.status as 'OPEN' | 'SETTLED'}
                    />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Shared games */}
      {!isSelf && (
        <div className="card-panel">
          <h2 className="font-display brass-text mb-3">Games together</h2>
          {sharedGames.length === 0 ? (
            <p className="text-sm text-ink-500">You haven't played a completed game together yet.</p>
          ) : (
            <div className="grid gap-2">
              {sharedGames.map((s) => {
                const me = s.participants.find((p) => p.userId === viewer.id);
                const them = s.participants.find((p) => p.userId === profile.id);
                return (
                  <Link key={s.id} href={`/game/${s.id}`} className="stack-card hover:border-accent-red">
                    <div className="stack-card-row">
                      <div className="font-semibold">{s.name}</div>
                      <span className="text-[10px] text-ink-500">{new Date(s.startedAt).toLocaleDateString()}</span>
                    </div>
                    <div className="stack-card-row text-xs">
                      <span className="text-ink-500">Your result:</span>
                      {me && (
                        <span className={me.netResult >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {formatCurrency(me.netResult, { showSign: true })}
                        </span>
                      )}
                    </div>
                    <div className="stack-card-row text-xs">
                      <span className="text-ink-500">Their result:</span>
                      {them && (
                        <span className={them.netResult >= 0 ? 'text-green-400' : 'text-red-400'}>
                          {formatCurrency(them.netResult, { showSign: true })}
                        </span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Recent games */}
      <div className="card-panel">
        <h2 className="font-display brass-text mb-3">Recent games</h2>
        {!showHistory ? (
          <p className="text-sm text-ink-500">{profile.username} keeps game history private.</p>
        ) : recentGames.length === 0 ? (
          <p className="text-sm text-ink-500">No completed games yet.</p>
        ) : (
          <div className="grid gap-2">
            {recentGames.map((p) => (
              <Link key={p.id} href={`/game/${p.session.id}`} className="stack-card hover:border-accent-red">
                <div className="stack-card-row">
                  <div className="font-semibold">{p.session.name}</div>
                  <span className={`font-mono ${p.netResult >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(p.netResult, { showSign: true })}
                  </span>
                </div>
                <div className="stack-card-row text-[10px] text-ink-500">
                  <span>{new Date(p.session.startedAt).toLocaleDateString()} · {p.session.participants.length} players</span>
                  <span className="uppercase tracking-widest">{p.session.gameType}</span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </div>

      {/* Own connections */}
      {isSelf && (
        <div className="card-panel">
          <h2 className="font-display brass-text mb-3">Connections</h2>
          {ownConnections.length === 0 ? (
            <p className="text-sm text-ink-500">
              You haven't connected with anyone yet. <Link className="underline" href="/players">Find players</Link>.
            </p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {ownConnections.map((c) => (
                <Link key={c.id} href={`/players/${encodeURIComponent(c.other.username)}`} className="stack-card hover:border-accent-red flex-row items-center">
                  <AvatarBadge
                    user={{ id: c.other.id, avatar: c.other.avatar, avatarUpdatedAt: c.other.avatarUpdatedAt?.getTime() ?? null }}
                    size={32}
                  />
                  <div className="flex-1 min-w-0 font-semibold truncate">{c.other.username}</div>
                </Link>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function Stat({ label, v, color }: { label: string; v: string; color?: 'green' | 'red' }) {
  const cls = color === 'green' ? 'text-green-400' : color === 'red' ? 'text-red-400' : 'text-white';
  return (
    <div>
      <div className="text-ink-500 text-xs uppercase">{label}</div>
      <div className={`${cls}`}>{v}</div>
    </div>
  );
}
