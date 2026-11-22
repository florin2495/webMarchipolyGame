// End-to-end test of the Marchipoly API with real players. Usage: node scripts/e2e.mjs [baseUrl incl. /marchipoly]
// Plain fetch, no dependencies. Every room it creates is named e2e-test-... and removed at the end
// (everyone leaves; a DB delete with the service key is the safety net: env NEXT_PUBLIC_SUPABASE_URL +
// SUPABASE_SERVICE_ROLE_KEY, e.g. the GitHub Actions secrets, else .env.local). Never writes feedback.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

const BASE = (process.argv[2] ?? "https://games.hailatat.icu/marchipoly").replace(/\/$/, "");
const START = 1000;
const created = new Set();
let failures = 0;

function check(cond, msg) {
  if (cond) console.log("  ✓", msg);
  else {
    failures++;
    console.log("  ✗", msg);
  }
}

async function call(path, { token, body, method } = {}) {
  const headers = {};
  if (token) headers["x-player-token"] = token;
  if (body !== undefined) headers["content-type"] = "application/json";
  const res = await fetch(BASE + path, { method: method ?? (body !== undefined ? "POST" : "GET"), headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data, region: res.headers.get("x-vercel-id") };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const state = async (code, p) => (await call(`/api/rooms/${code}/state`, { token: p.token })).data;
/** Cash of every player plus the Parking pot equals the start money plus what the bank paid in. */
const moneyOk = (g) => g.cash.reduce((a, b) => a + b, 0) + g.pot === START * g.seats.length + g.bank;

async function http() {
  console.log("HTTP");
  const page = await fetch(BASE);
  const html = await page.text();
  check(page.status === 200, `page ${BASE} = ${page.status}`);
  const origin = new URL(BASE).origin;
  const basePath = new URL(BASE).pathname;
  const assets = [...new Set([...html.matchAll(/(?:src|href)="([^"]*\/_next\/[^"]+)"/g)].map((m) => m[1]))];
  check(assets.length > 0 && assets.every((a) => a.startsWith(`${basePath}/_next/`)), `${assets.length} /_next assets under ${basePath}`);
  const statuses = await Promise.all(assets.map(async (a) => (await fetch(new URL(a, origin))).status));
  check(statuses.every((s) => s === 200), `all /_next assets 200 (${statuses.join(",")})`);
  // The settings panel (with the version) is on the room page: collect the JS chunks of both pages.
  const roomHtml = await (await fetch(`${BASE}/room/XXXXXX`)).text();
  const js = [...new Set((html + roomHtml).match(new RegExp(`${basePath}/_next/static/[^"'\\\\]+\\.js`, "g")) ?? [])];
  const version = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;
  let hasVersion = false;
  for (const a of js) if ((await (await fetch(origin + a)).text()).includes(`"${version}"`)) hasVersion = true;
  check(hasVersion, `client JS contains version ${version} (${js.length} chunks)`);
  const man = await fetch(`${BASE}/manifest.webmanifest`);
  const manifest = await man.json().catch(() => null);
  check(man.status === 200 && manifest?.start_url === `${basePath}/`, "manifest 200, start_url under basePath");
  for (const icon of [...(manifest?.icons ?? []).map((i) => i.src), `${basePath}/pwa-icons/apple`]) {
    const r = await fetch(new URL(icon, origin));
    check(r.status === 200 && /image/.test(r.headers.get("content-type") ?? ""), `icon ${icon} = ${r.status}`);
  }
  const room = await fetch(`${BASE}/room/XXXXXX`);
  check(room.status === 200, `room page /room/XXXXXX = ${room.status}`);
  if (origin.includes("hailatat.icu")) {
    const direct = await fetch(`https://014web-marchipoly-game.vercel.app${basePath}`);
    const directHtml = await direct.text();
    const chunks = (h) => [...h.matchAll(/src="([^"]*\/_next\/static\/[^"]+\.js)"/g)].map((m) => m[1]).sort().join();
    check(direct.status === 200 && chunks(directHtml) === chunks(html), "vercel.app serves the same build");
  }
}

/** Plays one decision for whoever has to act, with a simple policy. Returns the response. */
async function playOne(code, s, byId) {
  const g = s.game;
  const p = byId[g.seats[g.actor]];
  let body;
  if (g.trade) body = { kind: "reject" };
  else if (g.phase === "roll") body = { kind: "roll" };
  else if (g.phase === "buy") body = g.cash[g.actor] >= priceOf(g.buySquare) ? { kind: "buy" } : { kind: "decline" };
  else if (g.phase === "auction") body = { kind: "pass" };
  else if (g.phase === "tax") body = { kind: "payTax", choice: "fixed" };
  else if (g.phase === "debt") body = g.cash[g.actor] >= g.debts[0].amount ? { kind: "pay" } : { kind: "bankrupt" };
  else body = { kind: "end" };
  return call(`/api/rooms/${code}/action`, { token: p.token, body });
}

// Prices of the properties (lib/board.ts), only to decide whether the bot can afford one.
const PRICES = { 1: 60, 3: 60, 5: 200, 6: 100, 8: 100, 9: 120, 11: 140, 12: 150, 13: 140, 14: 160, 15: 200, 16: 180, 18: 180, 19: 200, 21: 220, 23: 220, 24: 240, 25: 200, 26: 260, 27: 260, 28: 150, 29: 280, 31: 300, 32: 300, 34: 320, 35: 200, 37: 350, 39: 400 };
const priceOf = (sq) => PRICES[sq] ?? 0;

async function main() {
  console.log(`E2E against ${BASE}`);
  await http();

  console.log("Room, join, rejoin, settings");
  const dev = { A: randomUUID(), B: randomUUID(), C: randomUUID(), D: randomUUID(), S: randomUUID() };
  const name = `e2e-test-${Date.now().toString(36)}`;
  const r = await call("/api/rooms", { body: { name, nickname: "Ana", password: "pw", deviceId: dev.A, startMoney: START, auctions: true, turnSeconds: 30, endMode: "bankrupt", minutes: 90 } });
  check(r.status === 200, `create room (${r.status}) region=${r.region ?? "local"}`);
  const code = r.data.code;
  created.add(code);
  const A = { ...r.data, name: "Ana" };
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "nope" } })).status === 403, "wrong password = 403");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob" } })).status === 403, "missing password = 403");
  const join = async (nickname, deviceId, role) => ({ ...(await call(`/api/rooms/${code}/join`, { body: { nickname, password: "pw", deviceId, role } })).data, name: nickname });
  const B = await join("Bob", dev.B);
  const C = await join("Cris", dev.C);
  const S = await join("Spec", dev.S, "observer");
  check(B.role === "player" && C.role === "player" && S.role === "observer", "2 players + 1 spectator joined");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 409, "start with 3 players = 409");
  const D = await join("Dan", dev.D);
  check(D.role === "player", "4th player joined");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "bob", password: "pw", deviceId: randomUUID() } })).status === 409, "nickname of a connected member from another device = 409");
  const list = await call("/api/rooms");
  check(list.data.rooms?.some((x) => x.code === code && x.hasPassword && x.players === 4 && x.observers === 1), "room in public list (password, 4 players, 1 spectator)");

  const oldB = B.token;
  const re = await call(`/api/rooms/${code}/join`, { body: { nickname: "Bob", password: "pw", deviceId: dev.B } });
  check(re.status === 200 && re.data.playerId === B.playerId && re.data.token !== oldB, "rejoin from the same device keeps the player id, new token");
  B.token = re.data.token;
  check((await call(`/api/rooms/${code}/state`, { token: oldB })).status === 401, "old token after rejoin = 401");
  check((await call(`/api/rooms/${code}/state`, { token: "bogus" })).status === 401, "bad token = 401");
  check((await call(`/api/rooms/${code}/state`)).status === 401, "no token = 401");

  check((await call(`/api/rooms/${code}/settings`, { token: B.token, body: { turnSeconds: 45 } })).status === 403, "non-host settings = 403");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { turnSeconds: 33 } })).status === 400, "33 s turn = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { startMoney: 450 } })).status === 400, "start money 450 = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { startMoney: 1050 } })).status === 400, "start money not a multiple of 100 = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { auctions: "yes" } })).status === 400, "auctions not a boolean = 400");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { endMode: "time", minutes: 45 } })).status === 200, "host sets a 45 min limit");
  let s = await state(code, S);
  check(s.room.settings.endMode === "time" && s.room.settings.minutes === 45, "spectator sees the new settings");
  check((await call(`/api/rooms/${code}/settings`, { token: A.token, body: { endMode: "bankrupt", startMoney: START } })).status === 200, "back to bankruptcy mode");
  check((await call(`/api/rooms/${code}/role`, { token: S.token, body: { role: "player" } })).status === 200, "spectator joins the players");
  check((await call(`/api/rooms/${code}/role`, { token: S.token, body: { role: "observer" } })).status === 200, "and back to spectator");

  console.log("Start");
  check((await call(`/api/rooms/${code}/action`, { token: A.token, body: { kind: "roll" } })).status === 409, "action in the lobby = 409");
  check((await call(`/api/rooms/${code}/start`, { token: B.token, body: {} })).status === 403, "non-host start = 403");
  check((await call(`/api/rooms/${code}/start`, { token: A.token, body: {} })).status === 200, "host starts");
  s = await state(code, S);
  const g = s.game;
  check(s.room.status === "playing" && g.seats.length === 4, "playing with 4 seats");
  check(g.cash.every((c) => c === START), `everyone starts with ${START}`);
  check(g.decks === undefined, "card order not in the state");
  check(g.mySeat === null && g.actor === 0 && g.phase === "roll", "spectator has no seat; seat 0 rolls first");
  const byId = Object.fromEntries([A, B, C, D].map((p) => [p.playerId, p]));
  const seatOf = (p) => g.seats.indexOf(p.playerId);
  check(seatOf(A) === 0, "host sits first");
  const first = byId[g.seats[0]];
  const second = byId[g.seats[1]];

  console.log("Moves");
  check((await call(`/api/rooms/${code}/action`, { token: S.token, body: { kind: "roll" } })).status === 403, "spectator action = 403");
  check((await call(`/api/rooms/${code}/action`, { token: second.token, body: { kind: "roll" } })).status === 409, "wrong turn = 409");
  check((await call(`/api/rooms/${code}/action`, { token: first.token, body: { kind: "fly" } })).status === 400, "unknown action = 400");
  check((await call(`/api/rooms/${code}/action`, { token: first.token, body: { kind: "build", square: 1 } })).status === 409, "build without the whole group = 409");
  check((await call(`/api/rooms/${code}/action`, { token: first.token, body: { kind: "end" } })).status === 409, "end before rolling = 409");

  console.log("Trade");
  const offer = { kind: "propose", to: 1, give: { squares: [], cash: 10, cards: 0 }, get: { squares: [], cash: 0, cards: 0 } };
  check((await call(`/api/rooms/${code}/action`, { token: first.token, body: { ...offer, give: { squares: [], cash: 99_999, cards: 0 } } })).status === 409, "offer more money than you have = 409");
  check((await call(`/api/rooms/${code}/action`, { token: first.token, body: offer })).status === 200, "seat 0 offers 10 lei to seat 1");
  s = await state(code, S);
  check(s.game.trade !== null && s.game.actor === 1, "the trade waits for seat 1");
  check((await call(`/api/rooms/${code}/action`, { token: first.token, body: { kind: "roll" } })).status === 409, "no roll while a trade is pending = 409");
  check((await call(`/api/rooms/${code}/action`, { token: second.token, body: { kind: "accept" } })).status === 200, "seat 1 accepts");
  s = await state(code, S);
  check(s.game.cash[0] === START - 10 && s.game.cash[1] === START + 10 && s.game.trade === null, "10 lei moved");

  console.log("Timeouts");
  const key = s.game.turnKey;
  check((await call(`/api/rooms/${code}/timeout`, { token: second.token, body: { turn: key } })).status === 403, "non-host timeout before the deadline = 403");
  check((await call(`/api/rooms/${code}/timeout`, { token: A.token, body: { turn: "stale" } })).status === 409, "stale turn key = 409");
  // Make it someone else's turn, then the host skips them.
  for (let i = 0; i < 40; i++) {
    s = await state(code, S);
    if (s.game.actor !== 0) break;
    const res = await playOne(code, s, byId);
    if (res.status !== 200) check(false, `move failed: ${res.status} ${res.data.error}`);
  }
  s = await state(code, S);
  check(s.game.actor !== 0, `seat ${s.game.actor} has to act`);
  const skipped = await call(`/api/rooms/${code}/timeout`, { token: A.token, body: { turn: s.game.turnKey } });
  check(skipped.status === 200 && skipped.data.state?.game?.turnKey !== s.game.turnKey, "host skips the decision");
  const again = await call(`/api/rooms/${code}/timeout`, { token: A.token, body: { turn: s.game.turnKey } });
  check(again.status === 409, "the same skip twice = 409 (no double skip)");

  console.log("Play some rounds");
  for (let i = 0; i < 80; i++) {
    s = await state(code, S);
    if (s.game.phase === "over") break;
    if (!moneyOk(s.game)) {
      check(false, `money does not add up after move ${i}`);
      break;
    }
    const res = await playOne(code, s, byId);
    if (res.status !== 200) {
      check(false, `move failed: ${res.status} ${res.data.error}`);
      break;
    }
  }
  s = await state(code, S);
  check(moneyOk(s.game), "cash + Parking = start money + bank payments");
  check(s.game.log.length > 10, `log has ${s.game.log.length} entries`);

  console.log("Join mid-game, kick, leave");
  const late = await join("Late", randomUUID(), "player");
  check(late.role === "observer", "joining mid-game = spectator");
  const victim = [B, C, D].find((p) => !s.game.bankrupt[s.game.seats.indexOf(p.playerId)]);
  if (victim) {
    check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: victim.playerId } })).data.pending === true, `kick ${victim.name} = pending`);
    check((await call(`/api/rooms/${code}/kick/ignore`, { token: victim.token, body: {} })).status === 200, "Ignoră");
    check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: victim.playerId } })).data.pending === true, "kick again");
    await sleep(12_500);
    check((await call(`/api/rooms/${code}/state`, { token: victim.token })).status === 401, "kick enforced after 12 s");
    s = await state(code, S);
    check(s.game.bankrupt[s.game.seats.indexOf(victim.playerId)] === true, "kicked player is bankrupt");
  }
  check((await call(`/api/rooms/${code}/kick`, { token: A.token, body: { playerId: late.playerId } })).status === 200, "spectator kicked at once");
  for (const p of [B, C, D].filter((x) => x !== victim)) {
    s = await state(code, S);
    if (s.game.phase === "over") break;
    if (s.game.bankrupt[s.game.seats.indexOf(p.playerId)]) continue;
    check((await call(`/api/rooms/${code}/leave`, { token: p.token, body: {} })).status === 200, `${p.name} leaves mid-game`);
  }
  s = await state(code, S);
  check(s.room.status === "finished" && s.game.phase === "over", "game over once only one player is left");
  check(s.game.winner === seatOf(A) && s.game.place[s.game.winner] === 1, "the host is the winner");
  const places = s.game.place;
  check(places.every((p) => p !== null) && new Set(places).size === places.length, `unique places ${places.join(",")}`);

  console.log("New round");
  check((await call(`/api/rooms/${code}/new-round`, { token: S.token, body: {} })).status === 403, "non-host new round = 403");
  check((await call(`/api/rooms/${code}/new-round`, { token: A.token, body: {} })).status === 200, "host new round");
  s = await state(code, S);
  check(s.room.status === "lobby" && s.room.round === 2 && s.game === null, "back in the lobby, round 2");

  console.log("Feedback (no rows written)");
  check((await call("/api/feedback", { body: { message: "", nickname: "e2e" } })).status === 400, "empty feedback = 400");

  console.log("Cleanup");
  await call(`/api/rooms/${code}/leave`, { token: S.token, body: {} });
  const last = await call(`/api/rooms/${code}/leave`, { token: A.token, body: {} });
  check(last.data.roomClosed === true, "last one out closes the room");
  check((await call(`/api/rooms/${code}/join`, { body: { nickname: "X", password: "pw" } })).status === 404, "room gone");
  created.delete(code);
}

/** Supabase URL + service key: environment (GitHub Actions secrets) first, else .env.local. */
function supabaseEnv() {
  const { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;
  if (NEXT_PUBLIC_SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) return { NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY };
  return Object.fromEntries(
    readFileSync(new URL("../.env.local", import.meta.url), "utf8")
      .split(/\r?\n/)
      .filter((l) => l.includes("=") && !l.startsWith("#"))
      .map((l) => [l.slice(0, l.indexOf("=")).trim(), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]),
  );
}

/** Safety net: delete rooms left behind by a failed run, straight in the DB (service key from env or .env.local). */
async function cleanup() {
  if (created.size === 0) return;
  try {
    const env = supabaseEnv();
    const url = `${env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/marchipoly_rooms?code=in.(${[...created].join(",")})&name=like.e2e-test-*`;
    const key = env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await fetch(url, { method: "DELETE", headers: { apikey: key, authorization: `Bearer ${key}` } });
    console.log(`  cleanup: deleted leftover rooms ${[...created].join(", ")} (${res.status})`);
  } catch (err) {
    console.log("  cleanup failed, delete these rooms by hand:", [...created].join(", "), err.message);
  }
}

try {
  await main();
} catch (err) {
  failures++;
  console.error(err);
} finally {
  await cleanup();
}
console.log(failures === 0 ? "\nE2E OK" : `\nE2E FAILED: ${failures} check(s)`);
process.exit(failures === 0 ? 0 : 1);
