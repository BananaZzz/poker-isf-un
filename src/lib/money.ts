/**
 * ALL monetary amounts in this app are integer minor units ("cents").
 * The UI presents them with a € prefix but they are purely virtual
 * play-money accounting units — there are no deposits, no withdrawals,
 * and no real-money system anywhere in the code.
 *
 * Never use floats. Never divide by 100 in JavaScript for computation.
 * Use these helpers for formatting only.
 */

export function formatCurrency(cents: number, opts?: { showSign?: boolean }): string {
  if (!Number.isFinite(cents)) return '€0.00';
  const n = Math.trunc(cents);
  const negative = n < 0;
  const abs = Math.abs(n);
  const whole = Math.trunc(abs / 100);
  const frac = abs % 100;
  const body = `€${whole.toLocaleString('de-DE')},${frac.toString().padStart(2, '0')}`.replace(',', '.');
  if (opts?.showSign) return (negative ? '−' : '+') + body;
  return (negative ? '−' : '') + body;
}

export function parseCurrencyToCents(text: string): number | null {
  const cleaned = text.replace(/[€\s]/g, '').replace(',', '.');
  if (!/^-?\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const [whole, frac = ''] = cleaned.replace(/^-/, '').split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

export const EURO = {
  format: formatCurrency,
  parse: parseCurrencyToCents,
};

/**
 * Compute a new blind level from the previous small blind and a multiplier
 * (e.g. 1.5, 1.8, 2.0). Rounds to the nearest cent using banker-friendly rules:
 *  - if the raw result is less than 100 cents: round to nearest 5 cents;
 *  - otherwise: round to nearest 10 cents.
 * The big blind is always twice the small blind after rounding.
 */
export function nextBlindLevel(currentSmallBlindCents: number, multiplier: number): { smallBlind: number; bigBlind: number } {
  const raw = currentSmallBlindCents * multiplier;
  let sb: number;
  if (raw < 100) {
    sb = Math.max(5, Math.round(raw / 5) * 5);
  } else {
    sb = Math.round(raw / 10) * 10;
  }
  if (sb <= currentSmallBlindCents) sb = currentSmallBlindCents + (raw < 100 ? 5 : 10);
  return { smallBlind: sb, bigBlind: sb * 2 };
}
