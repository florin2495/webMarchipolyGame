@AGENTS.md

# webMarchipolyGame (Marchipoly) - project notes for Claude

Property trading game (game 14 of the hub), shown as "Marchipoly" (folder `D:\_DEv\014_Marchipoly`): 4-6 players,
each on their own phone, up to 16 spectators. Original board, Romanian place names, our own prices, rents and card
texts; never use another game's name, board names or look anywhere (code, UI, docs, commits). Built like Poker
(`D:\_DEv\010_Poker`): rooms, spectators, rejoin, pending kick, lazy turn timer, Realtime, same test setup.

## Accounts and deploy
- GitHub: personal account **florin2495** only (repo `florin2495/webMarchipolyGame`, public). Never the work account.
  Local git identity is pinned in `.git/config`.
- Vercel project connected by hand by the user: `014_web-marchipoly-game`, domain `014web-marchipoly-game.vercel.app`.
  Production URL: https://games.hailatat.icu/marchipoly (basePath `/marchipoly`; the hub proxies `/marchipoly/*` here
  once its zone and `games.ts` entry are added - **pending** in `000_Startup`).
- `vercel.json` pins `"framework": "nextjs"` and `"regions": ["fra1"]` (Frankfurt, next to the Supabase DB).
- Env vars (Vercel + `.env.local`): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` (Realtime only),
  `SUPABASE_SERVICE_ROLE_KEY`.
- Feedback (`POST /api/feedback`) writes to `hub_feedback` (owned by florin2495/hailataticu-hub, slug `marchipoly`).
- Ask the user before pushing to `main` (= deploying), unless they explicitly say to deploy.
- **Before every push to main, bump the patch version** in `package.json` (and `npm install --package-lock-only`).
  It is shown in-game next to "Setări".

## Database (shared Supabase project, same as the other hub games)
Migrations are run by hand in the Supabase SQL editor - nothing records them in the DB,
so this list is the source of truth. **Update it whenever the user confirms a migration ran.**

| Migration | Applied to the live DB | Notes |
| --- | --- | --- |
| `supabase/schema.sql` (initial) | yes, verified 2026-11-22 by effect: service key 200 on every column of both tables, anon 401 | `marchipoly_rooms`, `marchipoly_players` (with `role`: player / observer = spectator, kick, presence, seat, queue columns) |

Rules for schema changes:
- Every object of this game is prefixed `marchipoly_` (tables, constraints, indexes). Table names live in `T`
  in `src/lib/server/db.ts`.
- New migration = new numbered file in `supabase/migrations/`, additive when possible, and the same change
  folded into `supabase/schema.sql`.
- Code that needs a migration must not be pushed until the user has run it. Verify it by effect with the
  service key from `.env.local`.
- Never print or commit the keys in `.env.local`.

## Abandoned rooms (600 s; 6 h for a running game)
Same as Poker: `GET /api/rooms` first runs `cleanupAbandonedRooms` (`src/lib/server/room.ts`) and
`cleanupExpiredRooms`; a lobby / finished room idle for 600 s with nobody seen is deleted, a running game after 6 h.

## Design
- Board and cards: `src/lib/board.ts` (40 squares, 8 regions of 22 streets, 4 stations "gări", 2 utilities,
  2 taxes, 3 "Noroc" + 3 "Destin" card squares, 16 cards per deck, money in "lei").
- Pure rules: `src/lib/marchipoly.ts`, no I/O, shared by server and client (the client uses `buildProblem`,
  `mortgageProblem`, `tradeProblem`... to enable buttons). One state machine:
  `phase` = `roll` | `buy` | `auction` | `debt` | `done` | `over`, plus a pending `trade` overlay (the target acts).
  `actorOf(g)` is who must act now. Every move goes through `act(g, seat, action, now, random)` (clones, never
  mutates) and ends with `settle` (debts first, then auctions and the auction queue, then the purchase, then roll / done)
  and `touch` (a new decision restarts the turn timer, `turnNo` / `turnKey`).
- Money: every transfer goes through `pay`, which keeps `g.bank` (net money the bank put in). Invariant, unit-tested
  after every simulated move: `sum(cash) + pot = startMoney × players + bank`. Taxes, fines, card payments and
  repairs go to the Parking pot; landing on Parking takes it.
- Settings (host, lobby and room creation): `startMoney` 500-10000 step 100 (default 1500), `auctions` on/off,
  `turnSeconds` 30/45/60/90/120, `endMode` `bankrupt` | `time` with `minutes` 30-180 step 15. Time mode: after
  `endsAt`, the game ends when the turn wraps back to the first seat; places by net worth (`netWorth`: cash, price,
  mortgaged at half, buildings at cost).
- Rules implemented: buy / decline (auction among all solvent players, min 10, +10 steps, or stays at the bank when
  auctions are off), rent (full group doubles base rent, houses, stations 25/50/100/200, utilities 4×/10× dice),
  even building with a 32 house / 12 hotel supply, selling at half (a hotel with fewer than 4 houses in the bank goes
  away entirely), mortgages (half price, +10% to pay back, no rent), trades (properties without buildings in their
  group, money, jail cards), jail (3 doubles, square, card; pay 50, card or doubles, 3rd failure pays and moves),
  debts (raise money or bankrupt; to a player: they get everything, mortgages stay; to the bank/pot: properties back
  unmortgaged and auctioned when auctions are on).
- Turn timer, lazy like Poker (no cron): clients call `/timeout` with the turn key once `turnDeadline` + 1.5 s passed
  (host first, players +3 s, spectators +6 s). `forceAction`: roll, decline, pass, reject trade, end turn, or for a
  debt sell buildings / mortgage until it is covered, else bankruptcy. The host can skip any time (same move).
- Leaving or being kicked mid-game = bankrupt to the bank (`removeSeat`).
- The whole game is one jsonb `marchipoly_rooms.game` with the optimistic lock on `version`. `/state` sends
  everything but `decks` (card order), plus `mySeat`, `actor`, `turnKey`, `turnDeadline`.
- UI: `src/components/Game.tsx`. Turn banner (`turn-label`: "Tura ta" / "Tura lui X"), the other players on top in
  the order they play after the one at the bottom (`player-strip`), the board (`Board.tsx`, one SVG 100×100,
  tappable squares → `PropertyDialog.tsx` with build / sell / mortgage), the last card, the action area, my panel at the
  bottom (`my-panel`). Spectators: "Toată tabla" (everyone on top) or pick a player to see at the bottom
  (`view-switcher`), and queue for the next game. Trades: `TradeDialog.tsx`. Light animations in `globals.css`
  (money pop, dice, token pulse, token slide), off with reduced motion.
- Leaderboard: at game end `src/lib/server/leaderboard.ts` upserts `hub_leaderboard*` (game `marchipoly`, idempotent
  per room+round). Test rooms (`e2e-test-…`) are never reported.
- Realtime: Broadcast topic `marchipoly:room:<uuid>` carries no data, clients re-fetch `/state`; 60 s polling fallback.

## Testing (GitHub Actions, manual only)
All checks run in GitHub Actions on the free tier (public repo, `ubuntu-latest` only), never locally (user's rule,
`D:\_DEv\CLAUDE.md`). Every workflow is `workflow_dispatch` only. Start one with `gh workflow run <file> --ref <branch>`.
| Workflow | Runs |
| --- | --- |
| `.github/workflows/check.yml` "Check code" | `npx next typegen` + `npx tsc --noEmit`, `npx eslint src`, `npx next build` |
| `.github/workflows/unit-tests.yml` "Unit tests" | `npm test` (Vitest: `src/lib/marchipoly.test.ts` incl. random full games with 4-6 players, auctions on/off, both end modes, checking money, building supply, cards and phases after every move; `kick`, `reconnect`, `order`, `leaderboard`, and `src/lib/server/room.test.ts`) |
| `.github/workflows/e2e.yml` "E2E" | `node scripts/e2e.mjs <base_url>` (default production `https://games.hailatat.icu/marchipoly`): HTTP checks, then the real API with 4 players and a spectator (create, passwords, join, rejoin, settings validation, start, turn order, a trade, host skip, stale key, ~80 moves with the money check, mid-game joiner = spectator, kick with "Ignoră" then enforced, leaving = bankrupt, winner, new round, cleanup) |
| `.github/workflows/e2e-ui.yml` "E2E UI (Playwright)" | `tests/ui/*.e2e.ts` on desktop Chromium and an emulated iPhone 13: `game.e2e.ts` (2 browsers + 2 API bots, live turn labels, standings, new game), `spectator.e2e.ts` (desktop: view switcher, live turns, queue), `mobile.e2e.ts` (iPhone: no sideways scroll, tap to roll, property card) |

- The e2e workflows need the deployed version (E2E checks the client JS contains the `package.json` version) and the
  hub zone for the default URL. Repo secrets `NEXT_PUBLIC_SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are only for
  the cleanup safety net.
- Playwright files are `*.e2e.ts`, never `*.spec.ts` / `*.test.ts` (Vitest would pick those up).
- UI tests find elements by `data-testid`: `home-submit`, `join-player`, `join-observer`, `leave`, `room-code`,
  `lobby-players`, `lobby-observers`, `role-toggle`, `start-game`, `turn-label`, `turn-timer`, `player-strip`,
  `player-<seat>`, `board`, `square-<i>`, `pot`, `last-card`, `action-bar` (only on the actor's screen) / `status-bar`,
  `act-roll`, `act-buy`, `act-decline`, `act-bid`, `act-pass`, `bid-amount`, `act-pay`, `act-bankrupt`, `act-end`,
  `act-trade`, `act-accept`, `act-reject`, `act-cancel`, `act-pay-jail`, `act-use-card`, `host-skip`, `auction`,
  `my-panel`, `my-cash`, `my-properties`, `property-dialog`, `prop-build`, `prop-sell`, `prop-mortgage`,
  `prop-unmortgage`, `trade-dialog`, `trade-send`, `observer-panel`, `view-switcher`, `view-all`, `view-seat-<i>`,
  `queue-toggle`, `standings`, `new-game`, `game-log`, and form fields by their labels.
