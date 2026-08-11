# Golden Room Poker

An elegant, dark-mode, private online **Texas Hold'em** platform for you and
your friends. Real multiplayer with a server-authoritative poker engine,
invite links, cash games and tournament-style timed blinds. **Play-money
only** — there are no real-money transactions.

Built as a single Next.js 14 application (App Router) with a Socket.IO
game server, a pure-TypeScript poker engine, Prisma + SQLite for persistence,
and Tailwind CSS for the UI.

---

## Tech stack

| Layer                | Choice                                        |
| -------------------- | --------------------------------------------- |
| Frontend             | Next.js 14 (App Router), React 18, TypeScript |
| Styling              | Tailwind CSS (dark casino theme)              |
| Realtime             | Socket.IO on the same HTTP server as Next     |
| Persistence          | Prisma ORM + SQLite (swap to Postgres easily) |
| Auth                 | Cookie sessions, bcrypt password hashing      |
| Validation           | Zod                                           |
| Testing              | Vitest                                        |
| Poker engine         | Pure TypeScript, no external deps             |

## Architecture

```
src/
  app/                  App Router pages + route handlers
  pages/api/socket.ts   Socket.IO attachment (Pages API, shares the http server)
  components/           React UI components (PokerTable, LobbyRoom, cards, …)
  game/                 Pure TypeScript poker engine (no React, no I/O)
    cards.ts            Deck + Fisher-Yates shuffle using node:crypto
    handEval.ts         5/7-card hand evaluator (straight-flush → high card)
    pots.ts             Main + side pot calculator
    engine.ts           State machine: deal, betting, phases, showdown
    types.ts            GameState / Action / PlayerStatus types
  server/
    gameManager.ts      Runtime rooms, timers, DB persistence
    socket.ts           Auth middleware + socket event handlers
  lib/
    auth.ts             Session cookies, bcrypt, requireUser()
    db.ts               Prisma client singleton
    codes.ts            Invite code generator
tests/                  Vitest unit tests for the engine
```

The **game engine is 100% server-authoritative**. Clients only send action
intents (`FOLD`, `CALL`, `RAISE 320`, …). The server validates against the
current state, applies the action, then broadcasts a **redacted** state to
each socket — opponents' hole cards are stripped out until showdown.

## Getting started

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env      # edit SESSION_SECRET before production

# 3. Create the SQLite database
npm run db:push

# 4. Run the dev server (http://localhost:3000)
npm run dev

# 5. Run the tests
npm test
```

## Environment

See `.env.example`. Two variables:

- `DATABASE_URL` — SQLite by default (`file:./dev.db`); swap the Prisma
  provider to `postgresql` and set a Postgres URL to move off SQLite.
- `SESSION_SECRET` — used as an extra entropy source (session tokens are
  themselves 256-bit random). **Change this in production.**

## The user flow

1. Register a username + password. Pick one of 12 casino-themed avatars.
2. On the dashboard, click **Create new game**.
3. Configure the lobby: cash game or tournament, max seats, blinds, stack,
   action timer.
4. Copy the **invite link** (`/invite/XXXXXXX`) and share it. Anyone who
   opens it is auto-joined; if they aren't signed in they're taken to
   register first and then dropped straight into the lobby.
5. Everyone hits **Ready**. The host clicks **Start game**.
6. The poker table appears. The engine deals hole cards, posts blinds,
   moves the dealer button, and runs the full No-Limit Hold'em flow
   through showdown. Winners are highlighted, the pot animates to them,
   and a new hand starts automatically after ~4.5 s.

## Poker engine

Everything in `src/game/` is pure TypeScript. Tests in `tests/` cover:

- 52-card deck integrity + shuffle preservation
- Hand rankings including wheel straight (A-2-3-4-5), kickers, ties
- Side-pot computation with three-way all-in, folded-player contributions
- Full pre-flop → showdown flow (checks, folds, calls)
- Fold-around awards uncontested pot to BB
- Heads-up dealer-is-SB rule and preflop action order

Run:

```bash
npm test
```

Extend `tests/` freely — the engine has no I/O or React dependencies.

## Realtime protocol

Client → Server events:
- `lobby:subscribe`, `lobby:unsubscribe`, `lobby:ready`, `lobby:start`
- `game:join`, `game:leave`, `game:action { type, amount? }`
- `chat:send { text }`

Server → Client events:
- `lobby` — snapshot of lobby (players, host, ready flags, …)
- `state` — `{ state, legal }` where `state` is a per-viewer redacted
  `GameState` and `legal` describes the actions available *now* for this
  viewer.
- `chat`, `chat:history`, `error:msg`

The server enforces every rule: only whose turn it is may act; bets must
respect min-raise and stack; timers auto-check/fold on expiry.

## All-in runout pacing

When a hand reaches a state where no active player can act (everyone in the hand
is all-in), the engine no longer auto-advances through the streets. Instead it
sets `state.runoutPending = true` and stops. The **game manager** — the only
place that owns time — steps through the remaining streets with `setTimeout`s
(700 ms before the flop, ~950 ms between board cards, ~800 ms before showdown).
Each timer is guarded by a `currentRunoutToken` bumped whenever a new hand
starts, so a stale timer from a prior hand cannot mistakenly advance the
current one. Duplicate socket events cannot trigger double progression: only
one runout exists per hand at any time.

## Showdown reveal sequencing

The client waits for the seat-by-seat card animation before showing the winner
banner. The delay equals `revealedPlayers × showdownRevealPerPlayerMs +
showdownExtraForBannerMs` (both come from the server's `PACING` constants in
the state broadcast). This means split pots and side pots each get their own
banner line, and the "who wins" reveal never precedes the cards.

## Pairwise accounting via pot flows

The dashboard's "Performance by opponent" is **not** derived from overall game
results. Every finished hand persists real `HandTransfer` rows: for each pot,
each losing contributor's amount is distributed among that pot's winner(s) in
proportion to the winner's award share. The algorithm lives in
`src/game/attribution.ts` and is covered by unit tests (`attribution.test.ts`,
`pairwiseInvariants.test.ts`) proving:

- winners' own contributions never transfer to themselves,
- Σ (pairwise flows within a hand) equals each player's chip delta,
- Σ (pairwise flows within a hand) sums to €0 across all players,
- A → B is always the additive inverse of B → A,
- split pots divide loser contributions proportionally,
- side pots are attributed independently per pot index.

Dashboard reads the aggregated `HandTransfer` rows via two Prisma `groupBy`
queries and shows `Σ transfers TO me FROM opp  −  Σ transfers FROM me TO opp`.

## Tournament ranking

Tournament placement is determined by **elimination order**, not net cash
result. Each `LobbyPlayer` stores `eliminatedAt`, `eliminatedHand`, and
`placement` (1 = last remaining). When a tournament reaches a single funded
player, the manager auto-finalizes: winner gets `placement = 1`, tourneyWins
increments, and the session closes. **Tournament games do not allow rebuys**
(enforced server-side even if the client tries to opt in).

## Currency, balances, and results

All monetary values in the app are **integer minor units (cents)** — never
floats. They render with a `€` prefix (e.g. `€20.00`) but are purely virtual
play-money accounting units — there are no deposits, withdrawals, wallets,
or real-money transactions of any kind anywhere in the code.

Two concepts are kept strictly separate:

- **Table stack (`LobbyPlayer.chips`)** — the amount currently in front of a
  player at one specific poker table. Restored on rebuy.
- **Lifetime performance (`User.netCents`)** — the running sum of every
  session's `netResult`. May be negative. Never spent to enter a game; it's
  a scoreboard, not a wallet.

At session end, each participant is finalized once (idempotent per
`sessionId × userId`): a `GameParticipant` row records `initialBuyIn`,
`totalRebuys`, `totalInvested`, `cashOutStack`, and `netResult`. The user's
lifetime counters (`netCents`, `gamesPlayed`, `gamesWon`,
`totalWonCents`, `totalLostCents`, `biggestWinCents`, `biggestLossCents`)
are updated atomically in the same transaction.

Blind progression is server-authoritative and applies only **between hands**
— never mid-hand. Rounding uses 5-cent cadence under €1 and 10-cent cadence
at or above €1, with a monotonic-increase guard.

## Rebuy / bust / leave

- A cash-game player at €0 sees a **"You are out of chips"** panel with
  **Rebuy**, **Sit out**, and **Leave table** options.
- Busted players are excluded from the next hand; the remaining funded
  players continue to play. If fewer than two funded players remain, the
  table pauses in `WAITING` and resumes as soon as someone rebuys (or a
  sit-out returns).
- **Leave table** finalizes only that participant; the host can **End game**
  to finalize everyone and close the session.

## Play-money notice

There is **no real money** in this application. Chips are virtual and
awarded arbitrarily. Do not enable a real-money layer without proper
licensing, KYC, geo-restrictions, RNG certification, and RG controls.

## Roadmap

The MVP focuses on the definition-of-done: register, lobby, invite, cash
game, full hand flow through showdown, side pots, dealer rotation, and
reconnect-friendly server state. Natural next steps:

- Tournament blind-schedule ticker + placement persistence
- Persist finished hands into `Hand` / `HandPlayer` tables for history
- Uploadable avatars (currently 12 built-in casino avatars)
- Bots for local testing (`DEV_MODE=1`)
- E2E tests with Playwright
