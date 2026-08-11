import './globals.css';
import type { Metadata } from 'next';
import Link from 'next/link';
import { getSessionUser } from '@/lib/auth';
import { LogoutButton } from '@/components/LogoutButton';
import { AvatarBadge } from '@/components/AvatarPicker';
import { formatCurrency } from '@/lib/money';

export const metadata: Metadata = {
  title: 'Golden Room Poker',
  description: 'Elegant private Texas Hold\'em for friends.',
};

export const viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#0a0d10',
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const user = await getSessionUser();
  return (
    <html lang="en" className="dark">
      <body>
        <header className="border-b border-ink-800/70 bg-ink-950/70 backdrop-blur sticky top-0 z-40">
          <div className="mx-auto max-w-6xl flex items-center justify-between gap-2 px-3 sm:px-4 py-3 flex-wrap">
            <Link href="/" className="font-display text-xl">
              <span className="brass-text">Golden Room</span>{' '}
              <span className="text-ink-500 text-sm">poker</span>
            </Link>
            <nav className="flex items-center gap-3 text-sm">
              {user ? (
                <>
                  <Link href="/dashboard" className="text-white/80 hover:text-white flex items-center gap-2">
                    <AvatarBadge
                      user={{
                        id: user.id,
                        avatar: user.avatar,
                        avatarUrl: user.avatarUrl,
                        avatarUpdatedAt: user.avatarUpdatedAt?.toISOString() ?? null,
                      }}
                      size={26}
                    />
                    <span>{user.username}</span>
                  </Link>
                  <span className={`text-xs ${user.netCents >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                    {formatCurrency(user.netCents, { showSign: true })}
                  </span>
                  <LogoutButton />
                </>
              ) : (
                <>
                  <Link href="/login" className="btn">Log in</Link>
                  <Link href="/register" className="btn btn-primary">Register</Link>
                </>
              )}
            </nav>
          </div>
        </header>
        <main className="mx-auto max-w-6xl px-3 sm:px-4 py-4 sm:py-8">{children}</main>
        <footer className="mx-auto max-w-6xl px-3 sm:px-4 py-8 text-xs text-ink-500">
          Play-money only. No real-money gambling. Built for private games.
        </footer>
      </body>
    </html>
  );
}
