export interface AvatarDef {
  id: string;
  label: string;
  bg: string;
  fg: string;
  glyph: string;
}

// 12 default avatars — pure CSS/SVG so they work without external assets
export const AVATARS: AvatarDef[] = [
  { id: 'avatar-1',  label: 'Ace',      bg: '#1e293b', fg: '#e6c67a', glyph: 'A♠' },
  { id: 'avatar-2',  label: 'King',     bg: '#3f0e0e', fg: '#f4e0a3', glyph: 'K♥' },
  { id: 'avatar-3',  label: 'Queen',    bg: '#0f3a2b', fg: '#e6c67a', glyph: 'Q♦' },
  { id: 'avatar-4',  label: 'Jack',     bg: '#241736', fg: '#d5b360', glyph: 'J♣' },
  { id: 'avatar-5',  label: 'Chip',     bg: '#0b1e15', fg: '#d4af51', glyph: '◉' },
  { id: 'avatar-6',  label: 'Dealer',   bg: '#111827', fg: '#f6e2a1', glyph: 'D' },
  { id: 'avatar-7',  label: 'Diamond',  bg: '#0b1523', fg: '#8ecff2', glyph: '♦' },
  { id: 'avatar-8',  label: 'Spade',    bg: '#0f1a12', fg: '#e6c67a', glyph: '♠' },
  { id: 'avatar-9',  label: 'Heart',    bg: '#1f0a0e', fg: '#f0a1a1', glyph: '♥' },
  { id: 'avatar-10', label: 'Club',     bg: '#0b1a10', fg: '#a8d1a8', glyph: '♣' },
  { id: 'avatar-11', label: 'Fortune',  bg: '#1a1108', fg: '#e6c67a', glyph: '☘' },
  { id: 'avatar-12', label: 'Royale',   bg: '#241717', fg: '#e6c67a', glyph: '★' },
];

export function getAvatar(id: string): AvatarDef {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}
