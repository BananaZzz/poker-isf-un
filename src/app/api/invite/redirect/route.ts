import { NextResponse } from 'next/server';

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = (url.searchParams.get('code') ?? '').trim();
  if (!code) return NextResponse.redirect(new URL('/dashboard', req.url));
  return NextResponse.redirect(new URL(`/invite/${code}`, req.url));
}
