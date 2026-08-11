import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';

export default async function Home() {
  const user = await getSessionUser();
  return (
    <div className="grid gap-10 lg:grid-cols-2 items-center">
      <div>
        <h1 className="font-display text-5xl leading-tight">
          <span className="brass-text">Elegant private poker</span>
          <br />
          <span className="text-white/90">for you and your friends.</span>
        </h1>
        <p className="mt-4 text-ink-500">
          No-limit Texas Hold&apos;em cash games and small tournaments. Private lobbies,
          invite links, real multiplayer &mdash; and it&apos;s all play-money.
        </p>
        <div className="mt-6 flex gap-3">
          {user ? (
            <Link href="/dashboard" className="btn btn-primary">Go to Dashboard</Link>
          ) : (
            <>
              <Link href="/register" className="btn btn-primary">Create account</Link>
              <Link href="/login" className="btn">Log in</Link>
            </>
          )}
        </div>
        <ul className="mt-8 grid gap-2 text-sm text-ink-500 list-disc list-inside">
          <li>Server-authoritative poker engine</li>
          <li>Invite links, ready system, dealer button rotation</li>
          <li>Side pots, split pots, all-in handling</li>
          <li>Cash games &amp; timed-blind tournaments</li>
        </ul>
      </div>
      <div className="card-panel">
        <div className="felt aspect-[16/10] rounded-3xl relative flex items-center justify-center">
          <div className="text-center">
            <div className="text-xs uppercase tracking-widest text-white/60">Pot</div>
            <div className="chip px-4 py-1 text-lg mt-1 mx-auto w-max">1,240</div>
            <div className="mt-6 flex gap-2 justify-center">
              {['A♠','K♠','Q♠','J♠','10♠'].map((c, i) => (
                <div key={i} className="card-face w-12 h-16 flex items-center justify-center text-lg font-semibold">{c}</div>
              ))}
            </div>
            <div className="mt-4 text-xs text-white/60">Royal Flush</div>
          </div>
        </div>
      </div>
    </div>
  );
}
