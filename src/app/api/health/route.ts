import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Liveness probe for Render / uptime checks.
 * Returns 200 as long as the Next.js server is reachable. It intentionally does
 * NOT touch the database — a DB blip should not knock the whole service into
 * Render's unhealthy state (which would trigger a restart loop on the free
 * tier). Add a separate readiness probe later if you need one.
 */
export async function GET() {
  return NextResponse.json(
    { status: 'ok', service: 'poker-isf-un', time: new Date().toISOString() },
    { status: 200 }
  );
}
