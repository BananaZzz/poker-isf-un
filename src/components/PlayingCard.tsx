'use client';
import clsx from 'clsx';

interface Card {
  suit: 's' | 'h' | 'd' | 'c';
  rank: number;
}

const RANK: Record<number, string> = { 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: 'T', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
const SUIT: Record<string, string> = { s: '♠', h: '♥', d: '♦', c: '♣' };
const RED = new Set(['h', 'd']);

export function PlayingCard({ card, size = 'md', hidden = false }: { card?: Card | null; size?: 'sm' | 'md' | 'lg'; hidden?: boolean }) {
  const sizes = {
    sm: 'w-8 h-11 text-sm',
    md: 'w-12 h-16 text-lg',
    lg: 'w-16 h-24 text-2xl',
  } as const;
  if (!card || hidden) {
    return <div className={clsx('card-back', sizes[size])} />;
  }
  const color = RED.has(card.suit) ? 'text-red-600' : 'text-black';
  return (
    <div className={clsx('card-face flex flex-col items-center justify-center font-semibold', sizes[size], color)}>
      <div>{RANK[card.rank]}</div>
      <div className="leading-none">{SUIT[card.suit]}</div>
    </div>
  );
}
