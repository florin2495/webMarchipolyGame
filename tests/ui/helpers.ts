// Shared steps for the Playwright UI tests (tests/ui/*.e2e.ts). Not a test file itself (no .e2e.ts suffix).
// Rooms are named "e2e-test-ui-…"; a leftover is deleted with the service key (env) as a safety net.
// A game needs 4 players: two or three play in real browsers, the rest are "bots" driven straight through the API.
// Dice are random: the tests read whose decision it is from the state and act on that screen.
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";

/** A change has to show up on another screen within this, without a reload. Polling alone takes up to 60 s. */
export const REALTIME_MS = 5_000;
export const PASSWORD = "pw";

export interface Player {
  name: string;
  context: BrowserContext;
  page: Page;
}

/** A player that exists only through the API. */
export interface Bot {
  name: string;
  playerId: string;
  token: string;
}

const baseUrl = () => String(test.info().project.use.baseURL ?? "https://games.hailatat.icu/marchipoly/").replace(/\/?$/, "/");

async function call(path: string, opts: { token?: string; body?: unknown } = {}): Promise<{ status: number; data: Record<string, unknown> }> {
  const headers: Record<string, string> = {};
  if (opts.token) headers["x-player-token"] = opts.token;
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(new URL(path, baseUrl()), {
    method: opts.body !== undefined ? "POST" : "GET",
    headers,
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as Record<string, unknown> };
}

/** A separate browser context = a separate device (own localStorage session), with the project's device settings. */
export async function newPlayer(browser: Browser, name: string): Promise<Player> {
  const use = test.info().project.use;
  const context = await browser.newContext({
    baseURL: use.baseURL,
    locale: use.locale,
    viewport: use.viewport,
    userAgent: use.userAgent,
    deviceScaleFactor: use.deviceScaleFactor,
    isMobile: use.isMobile,
    hasTouch: use.hasTouch,
  });
  const page = await context.newPage();
  // Every window.confirm (leave, bankruptcy) is answered "OK".
  page.on("dialog", (d) => void d.accept());
  return { name, context, page };
}

/** Host creates a password-protected room from the home page (default rules); returns its code. */
export async function createRoom(host: Player): Promise<string> {
  const page = host.page;
  await page.goto("./");
  await page.getByLabel("Numele camerei").fill(`e2e-test-ui-${Date.now().toString(36)}`);
  await page.getByLabel("Nickname-ul tău").fill(host.name);
  await page.getByLabel("Parolă (opțional)").fill(PASSWORD);
  await page.getByTestId("home-submit").click();
  await page.waitForURL(/\/room\/[A-Z2-9]{6}$/);
  await expect(page.getByTestId("start-game")).toBeVisible();
  return page.url().match(/\/room\/([A-Z2-9]{6})$/)![1];
}

/** Opens the invite link and joins as a player (lands in the lobby, or as a spectator once the game runs). */
export async function joinRoom(p: Player, code: string, as: "player" | "observer" = "player"): Promise<void> {
  await p.page.goto(`room/${code}`);
  await p.page.getByLabel("Nickname-ul tău").fill(p.name);
  await p.page.getByLabel("Parolă (dacă are camera)").fill(PASSWORD);
  await p.page.getByTestId(as === "player" ? "join-player" : "join-observer").click();
  await expect(p.page.getByTestId(as === "player" ? "join-player" : "join-observer")).toBeHidden();
  await expect(p.page.getByTestId("leave")).toBeVisible();
}

/** Joins a bot player through the API. */
export async function joinBot(code: string, name: string): Promise<Bot> {
  const r = await call(`api/rooms/${code}/join`, { body: { nickname: name, password: PASSWORD, role: "player" } });
  expect(r.status, `bot ${name} joins`).toBe(200);
  return { name, playerId: r.data.playerId as string, token: r.data.token as string };
}

export async function leaveBot(code: string, bot: Bot): Promise<void> {
  await call(`api/rooms/${code}/leave`, { token: bot.token, body: {} });
}

interface GameLite {
  seats: string[];
  names: string[];
  actor: number | null;
  phase: string;
  cash: number[];
  buySquare: number | null;
  debts: { amount: number }[];
  trade: unknown;
}

/** The game as a member sees it (read with a bot's token). */
export async function gameState(code: string, bot: Bot): Promise<{ status: string; game: GameLite | null }> {
  const r = await call(`api/rooms/${code}/state`, { token: bot.token });
  return { status: (r.data.room as { status: string }).status, game: r.data.game as GameLite | null };
}

/** Host (players[0]) starts once everyone is in the lobby; every screen shows the board and a turn label. */
export async function startGame(players: Player[], total: number, watchers: Player[] = []): Promise<void> {
  const host = players[0];
  await expect(host.page.getByTestId("lobby-players").locator("li")).toHaveCount(total, { timeout: REALTIME_MS });
  await expect(host.page.getByTestId("start-game")).toBeEnabled({ timeout: REALTIME_MS });
  await host.page.getByTestId("start-game").click();
  for (const p of [...players, ...watchers]) {
    await expect(p.page.getByTestId("turn-label")).toBeVisible({ timeout: REALTIME_MS });
    await expect(p.page.getByTestId("board")).toBeVisible();
  }
}

/** Plays a bot's decision: roll, buy when it can, pass auctions, pay or go bankrupt, end the turn. */
async function botMove(code: string, bot: Bot, g: GameLite): Promise<void> {
  let body: Record<string, unknown> = { kind: "end" };
  if (g.trade) body = { kind: "reject" };
  else if (g.phase === "roll") body = { kind: "roll" };
  else if (g.phase === "buy") body = { kind: "decline" };
  else if (g.phase === "auction") body = { kind: "pass" };
  else if (g.phase === "tax") body = { kind: "payTax", choice: "fixed" };
  else if (g.phase === "debt") body = g.cash[g.actor!] >= g.debts[0].amount ? { kind: "pay" } : { kind: "bankrupt" };
  await call(`api/rooms/${code}/action`, { token: bot.token, body });
}

/** Plays a browser player's decision by clicking the first fitting button on their own screen. */
async function clickMove(p: Player): Promise<void> {
  const page = p.page;
  await expect(page.getByTestId("action-bar")).toBeVisible({ timeout: REALTIME_MS });
  for (const id of ["act-reject", "act-roll", "act-buy", "act-tax-fixed", "act-pass", "act-pay", "act-bankrupt", "act-end"]) {
    const b = page.getByTestId(id);
    if ((await b.isVisible()) && (await b.isEnabled())) {
      const [res] = await Promise.all([
        page.waitForResponse((r) => r.url().includes("/action") && r.request().method() === "POST"),
        b.click(),
      ]);
      expect(res.status(), `${id} by ${p.name}`).toBe(200);
      return;
    }
  }
  const decline = page.getByTestId("act-decline");
  if (await decline.isVisible()) await decline.click();
}

/**
 * Plays `steps` decisions. Before each one the actor's screen must say "Tura ta" and every other browser
 * "Tura lui <actor>" (live, no reload).
 */
export async function playSteps(code: string, players: Player[], bots: Bot[], steps: number, watchers: Player[] = []): Promise<void> {
  for (let i = 0; i < steps; i++) {
    const { game: g } = await gameState(code, bots[0]);
    if (!g || g.phase === "over" || g.actor === null) return;
    const actorName = g.names[g.actor];
    const human = players.find((p) => p.name === actorName);
    for (const p of [...players, ...watchers]) {
      if (p === human) await expect(p.page.getByTestId("turn-label")).toHaveText("Tura ta", { timeout: REALTIME_MS });
      else await expect(p.page.getByTestId("turn-label")).toHaveText(`Tura lui ${actorName}`, { timeout: REALTIME_MS });
    }
    if (human) await clickMove(human);
    else await botMove(code, bots.find((b) => b.name === actorName)!, g);
  }
}

/** Leaves through the "Părăsește" button (the confirm is accepted), in the given order. */
export async function leaveAll(players: Player[]): Promise<void> {
  for (const p of players) {
    await p.page.getByTestId("leave").click();
    await expect(p.page.getByTestId("home-submit")).toBeVisible();
  }
}

/** The page must not scroll sideways (the usual mobile layout bug). */
export async function expectNoHorizontalScroll(page: Page): Promise<void> {
  await expect
    .poll(() => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth))
    .toBeLessThanOrEqual(0);
}

/** Safety net: delete the room straight in the DB if the UI flow did not close it. */
export async function deleteRoom(code: string): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.log(`cleanup: no Supabase env, delete room ${code} by hand if it is still there`);
    return;
  }
  const res = await fetch(`${url}/rest/v1/marchipoly_rooms?code=eq.${code}&name=like.e2e-test-ui-*`, {
    method: "DELETE",
    headers: { apikey: key, authorization: `Bearer ${key}` },
  });
  console.log(`cleanup: room ${code} delete = ${res.status}`);
}

/** Runs `body` with fresh browser players; always closes their browsers and deletes the room if it was left open. */
export async function withPlayers(
  browser: Browser,
  names: string[],
  body: (players: Player[], room: { code: string; closed: boolean }) => Promise<void>,
): Promise<void> {
  const players = await Promise.all(names.map((n) => newPlayer(browser, n)));
  const room = { code: "", closed: false };
  try {
    await body(players, room);
  } finally {
    if (room.code && !room.closed) await deleteRoom(room.code);
    for (const p of players) await p.context.close();
  }
}
