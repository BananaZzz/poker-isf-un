// Centralized pacing constants. Server-authoritative; clients only render.
export const PACING = {
  betweenHandsMs: 4500,
  runoutBeforeFlopMs: 700,
  runoutBetweenBoardMs: 950,
  runoutBeforeShowdownMs: 800,
  showdownRevealPerPlayerMs: 700,
  showdownExtraForBannerMs: 400,
} as const;
