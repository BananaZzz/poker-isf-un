import Link from 'next/link';
import { redirect } from 'next/navigation';
import { prisma } from '@/lib/db';
import { getSessionUser } from '@/lib/auth';
import { AvatarBadge } from '@/components/AvatarPicker';

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

  return (
    <div className="grid gap-6 md:grid-cols-3">
      <div className="md:col-span-2 grid gap-6">
        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">Quick actions</h2>
          <div className="flex flex-wrap gap-3">
            <Link href="/create" className="btn btn-primary">Create new game</Link>
            <JoinByCode />
          </div>
        </div>
        <div className="card-panel">
          <h2 className="text-xl font-display brass-text mb-4">My games</h2>
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
                      SB {l.smallBlind}/BB {l.bigBlind}
                    </div>
                  </div>
                  <span className="text-xs uppercase tracking-widest text-brass-400">{l.status}</span>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="card-panel">
        <div className="flex items-center gap-3">
          <AvatarBadge id={user.avatar} size={56} />
          <div>
            <div className="text-lg font-semibold">{user.username}</div>
            <div className="chip inline-block px-2 py-0.5 text-xs mt-1">{user.chips.toLocaleString()} chips</div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-3 gap-2 text-sm">
          <div>
            <dt className="text-ink-500 text-xs uppercase">Games</dt>
            <dd className="text-white">{user.gamesPlayed}</dd>
          </div>
          <div>
            <dt className="text-ink-500 text-xs uppercase">Wins</dt>
            <dd className="text-white">{user.wins}</dd>
          </div>
          <div>
            <dt className="text-ink-500 text-xs uppercase">Trophies</dt>
            <dd className="text-white">{user.tourneyWins}</dd>
          </div>
        </dl>
      </div>
    </div>
  );
}

function JoinByCode() {
  return (
    <form action="/api/invite/redirect" className="flex gap-2" method="GET">
      <input className="input w-40" name="code" placeholder="Invite code" />
      <button className="btn" type="submit">Join</button>
    </form>
  );
}
