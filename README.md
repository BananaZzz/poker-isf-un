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
