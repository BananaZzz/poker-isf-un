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

The app uses **PostgreSQL** (see "Free Public Deployment" below for the
zero-cost Neon path). For local dev the easiest option is to point at a Neon
free-tier database; alternatively run Postgres in Docker.

```bash
# 1. Install
npm install

# 2. Configure env
cp .env.example .env      # paste your DATABASE_URL and set SESSION_SECRET

# 3. Sync the schema into your Postgres
npm run db:push

# 4. Run the dev server (http://localhost:3000)
npm run dev

# 5. Run the tests (no database needed — engine tests are pure)
npm test
```

## Environment

See `.env.example`. Required variables:

- `DATABASE_URL` — PostgreSQL connection string. For free hosting use a Neon
  pooled URL (`postgresql://...pooler...?sslmode=require`).
- `SESSION_SECRET` — random string used as extra entropy for session cookies.
  Generate with `openssl rand -hex 32`. On Render, `render.yaml` sets this
  automatically via `generateValue: true`.
- `NODE_ENV` — `development` locally, `production` on Render.
- `PORT` — only for local `npm run start`; Render injects this in production.

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

## Open balances (settlement bookkeeping)

At the end of a **cash** session the app runs a deterministic settlement
matcher and stores one `SettlementObligation` row per debtor→creditor pair.
Algorithm (greedy largest-first):

```
creditors = players with netResult > 0   (sorted desc by amount, tie-break asc userId)
debtors   = players with netResult < 0   (sorted desc by |amount|, tie-break asc userId)
while both non-empty:
   amt = min(|top debtor|, top creditor)
   emit (top debtor → top creditor : amt)
   reduce both
```

Properties (see `tests/settlement.test.ts`):

- Σ obligations from a debtor == |their net loss|
- Σ obligations to a creditor == their net gain
- Σ over all obligations == total positive session result
- No self-obligations, no non-positive amounts, integer cents only
- Same input → same output on every run (deterministic)

Storage: `SettlementObligation` unique index on `(gameSessionId, debtor, creditor)`
plus a `GameSession.settlementDone` flag make finalization **idempotent** —
duplicate End-Game clicks, reconnect races, or replayed timers cannot
produce duplicate rows.

Authorization on `POST /api/settlements/[id]/settle`: either the debtor OR
the creditor may mark an obligation as SETTLED (a private group's private
bookkeeping; either side can announce "I paid" or "I got paid"). `DELETE`
un-settles.

**Distinct from `HandTransfer` (pairwise pot attribution).** Pot attribution
tracks who won chips from whom during hands, live during play. Settlement
obligations describe who ought to hand over cash after a session ends, based
on the finalized net result including rebuys. Do not mix.

## Voluntary card reveal

When a hand ends **without** a real showdown — everyone else folded — the
winner's hole cards are hidden from opponents. The winner sees a small
`👁 Show cards` control below their own seat and can flip the cards face-up
for the table.

Server-authoritative (`player:revealCards` socket event). The server
validates that the requester is a real player at that table, the hand is
complete, the hand did not go to a mandatory showdown, and the handNumber
matches — no stale-hand payloads, no cross-player reveals. Reveal state
lives on `GameState.voluntaryReveals` and `mandatoryShowdown`, resets on
every `startNewHand`, and reconnects restore the current set. Real
rules-mandated showdowns still expose all contenders' cards regardless of
this flag.

## Player network — profiles + connections

- `/players` — paginated username search (`/api/players/search`, auth-required
  so the user table is not enumerable by unauthenticated visitors).
- `/players/[username]` — public profile: avatar, member-since, general
  stats, recent completed games (opt-out via `User.showHistoryPublic`),
  shared games with the viewer, and — for another player's profile only —
  the settlement obligations **between viewer and profile owner** with
  aggregate You Owe / They Owe totals.
- Global privacy rule: obligations involving unrelated third parties are
  **never** rendered on another user's profile — the SQL is scoped to
  `(viewer, profile)` pairs. Only the dashboard shows your full open-balances
  ledger.
- **Connections** — `PlayerConnection { requester, recipient, status }` with
  a unique index preventing duplicate requests. States: NONE / PENDING_SENT /
  PENDING_RECEIVED / CONNECTED / SELF. `POST /api/connections/request`
  auto-accepts when the target has already requested us. Accept/decline
  restricted to the recipient; either party may remove.
- Header shows a pending-request badge next to "Players" when the viewer
  has incoming friend requests.

## Uploaded avatars — Postgres-backed

Uploaded profile images are stored in Postgres (`User.avatarData` BYTEA,
`avatarMime` TEXT, `avatarUpdatedAt` TIMESTAMP). No filesystem, no external
image host. The client resizes to a 512×512 WebP with a canvas before
uploading, keeping the payload and the stored blob small (~30–150 KB).

Fallback chain when rendering an avatar:
1. `/api/users/[id]/avatar?v=<avatarUpdatedAt>` (uploaded WebP; cache-busted)
2. `User.avatarUrl` (Phase-2 legacy filesystem URL — probably 404 on Render)
3. One of the 12 standard casino glyphs

## Free Public Deployment — Render + Neon

This section is a full click-by-click guide to putting the app on the public
internet at **zero recurring cost**, using:

- **Neon** (free Postgres) for persistent database storage.
- **Render Free Web Service** for the Next.js + Socket.IO server.
- **GitHub** for the repository Render pulls from.

Approximate time: 15–20 minutes end-to-end.

### Before you start

- Push this repository to GitHub if it isn't already.
- You'll deploy from the branch `claude/texas-holdem-poker-platform-nj4y14`
  (change it in `render.yaml` if you use a different branch).
- **Do not** commit real secrets. `SESSION_SECRET` is generated by Render.
  `DATABASE_URL` is pasted into the Render dashboard by you.

### Step 1 — Create the Neon Postgres database

1. Go to https://neon.tech and click **Sign up** (GitHub or Google sign-in).
2. On the "Create your first project" screen:
   - **Project name:** `poker` (anything).
   - **Postgres version:** default is fine (17 at time of writing).
   - **Cloud provider / region:** pick the region closest to Frankfurt for the
     lowest latency to a Render Frankfurt web service; otherwise closest to you.
   - **Database name:** `poker`.
   - Click **Create project**.
3. On the project's **Dashboard** you'll see **Connection Details**. Make sure
   the following are selected:
   - **Role:** `neondb_owner` (or whatever the default is).
   - **Database:** the one you named above.
   - **Pooled connection:** ✅ ON. Neon's pooler tolerates Render's cold-starts
     much better than a direct connection.
4. Copy the connection string. It looks like:
   `postgresql://<user>:<password>@ep-...-pooler.<region>.aws.neon.tech/poker?sslmode=require`.
   Keep it handy for Step 4.

### Step 2 — Push the repository to GitHub

If your fork/clone isn't on GitHub yet:

```bash
git remote add origin https://github.com/<you>/<repo>.git
git push -u origin claude/texas-holdem-poker-platform-nj4y14
```

### Step 3 — Create the Render web service

1. Go to https://dashboard.render.com and sign up with GitHub.
2. Grant Render access to the repository (or the whole account).
3. In the Render dashboard, click **New** → **Blueprint**.
   - Render reads `render.yaml` from the repo root and prefills everything.
4. Select the repository and click **Connect**.
5. Render shows the service preview:
   - **Name:** `golden-room-poker`
   - **Runtime:** `node`
   - **Branch:** `claude/texas-holdem-poker-platform-nj4y14`
   - **Plan:** `free`
   - **Region:** `frankfurt` (change here if you want)
   - **Build command:** `npm ci --include=dev && npm run build`
   - **Start command:** `npx prisma db push --skip-generate && npm run start`
   - **Health check path:** `/api/health`
6. Click **Apply**. Render begins the first build.

If instead you prefer creating the service manually (skip Blueprint):

- **New** → **Web Service** → connect the repo.
- Environment: **Node**.
- Region: whatever you like.
- Branch: `claude/texas-holdem-poker-platform-nj4y14`.
- **Build Command:** `npm ci --include=dev && npm run build`
- **Start Command:** `npx prisma db push --accept-data-loss --skip-generate && npm run start`
- **Plan:** Free.
- Under **Advanced**, set **Health Check Path** to `/api/health`.

### Step 4 — Fill in environment variables

In the Render dashboard for the service:

1. Go to **Environment** → **Environment Variables**.
2. `SESSION_SECRET` — already provided by Render (auto-generated). Leave it.
3. `NODE_ENV` — already set to `production` by `render.yaml`.
4. `NODE_VERSION` — set to `20.11.1` by `render.yaml`.
5. `DATABASE_URL` — click **Add Environment Variable**:
   - **Key:** `DATABASE_URL`
   - **Value:** the Neon **pooled** connection string from Step 1
     (`postgresql://...pooler...?sslmode=require`)
6. Click **Save Changes**. Render triggers a redeploy automatically.

### Step 5 — First-deploy database initialization

You don't need to run anything manually. The **Start Command** on every deploy runs:

```
npx prisma db push --skip-generate
```

On the very first deploy this creates all tables in your Neon database. On
subsequent deploys it applies additive schema changes (new columns, new
tables, new indexes) cleanly. **`--accept-data-loss` is intentionally NOT
passed** because your Neon database now contains real user data — Prisma
will fail the deploy loudly if a schema change would drop a column or
table, and you should switch to an explicit `prisma migrate` in that case.

> If you'd rather run it once by hand from your laptop before the first deploy:
> `DATABASE_URL='postgresql://...neon...?sslmode=require' npx prisma db push`

### Step 6 — Grab your public URL

1. After the first successful deploy, Render shows a URL like
   `https://golden-room-poker.onrender.com` at the top of the service page.
2. Open it in a browser. You should see the landing page.
3. Check `https://golden-room-poker.onrender.com/api/health` — it must return
   `{"status":"ok",...}` with HTTP 200. Render polls this to determine health.

### Step 7 — Test Socket.IO with two browsers

Socket.IO in this app runs on the **same origin** as HTTP, attached to Next's
HTTP server via `src/pages/api/socket.ts`. Behind Render's HTTPS termination
it upgrades transparently to WSS — no extra config needed.

To verify real-time works in production:

1. Open the public URL in your regular browser. Register user **A**, click
   **Create new game**, fill the wizard, and hit **Create lobby**.
2. Copy the invite link the lobby page shows.
3. Open the invite link in a **private / incognito window**. Register user **B**
   — you'll land directly in the lobby.
4. Both users click **Ready**. Host **A** clicks **Start Game**.
5. You should see hole cards appear in each browser, community cards animate
   in sequence, and betting actions in one window reflect in the other within
   a few hundred milliseconds. That's WSS working end-to-end.

If the second window loads the invite link but sits at the lobby without
receiving events, the WebSocket upgrade failed — check the browser DevTools
Network tab for the request to `/api/socket` and look for `101 Switching
Protocols`.

### Step 8 — Ongoing deploys

Every push to the branch specified in `render.yaml` triggers a rebuild
(`autoDeploy: true`). Rollbacks are one click in the Render dashboard.

Schema changes: bump `prisma/schema.prisma`, commit, push. The start command
re-runs `prisma db push` on the new container.

### Troubleshooting

**Build fails with `Module not found: Can't resolve '@/lib/*'`.** Your build
command is `npm ci` (without `--include=dev`). Render's `NODE_ENV=production`
makes npm skip devDependencies, which removes `typescript` — and without
`typescript` installed, Next.js drops the `paths` alias table from
`tsconfig.json`. Fix: change the build command to
`npm ci --include=dev && npm run build`.

**`prisma db push` fails on first deploy with an auth error.** Confirm
`DATABASE_URL` points at your Neon **pooled** endpoint (URL contains
`-pooler`) with `?sslmode=require`.

**Socket.IO won't upgrade to WSS.** Check DevTools → Network → filter WS. The
request to `/api/socket` should return `101 Switching Protocols`. If you see
`400`, verify you're loading the app over `https://` (not `http://`) and that
you aren't sitting behind a proxy stripping `Upgrade:` headers.

### Known Render Free limitations

- **Sleep on idle.** The free service is stopped after ~15 minutes with no
  incoming requests. The **next request wakes it**, and that first request
  takes **~30 seconds** to return while the container cold-starts. Sessions in
  progress on a warm container are unaffected, but a completely idle site will
  feel slow the first time a visitor arrives.
- **512 MB RAM, 0.1 vCPU shared.** Fine for a private group's poker session;
  do not expect to host dozens of concurrent tables.
- **No persistent disk.** `public/uploads/` disappears on every redeploy. For
  a public MVP the built-in casino avatars are the recommended choice; if you
  want persistent uploaded photos, wire an S3-compatible store (Cloudflare R2
  has a generous free tier) in a follow-up change.
- **Log retention** on Free is ~7 days.
- **HTTPS certificate** is provisioned automatically on `*.onrender.com`; no
  action needed.

### Local development against Neon

If you want to test locally with the same database Render uses:

```bash
cp .env.example .env
# paste the Neon pooled URL into DATABASE_URL
npx prisma db push
npm run dev            # http://localhost:3000
```

Or run your own local Postgres:

```bash
docker run --rm -p 5432:5432 -e POSTGRES_PASSWORD=postgres -e POSTGRES_DB=poker postgres:16
# DATABASE_URL="postgresql://postgres:postgres@localhost:5432/poker"
```

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
