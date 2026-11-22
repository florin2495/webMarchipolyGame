// Pure Marchipoly rules (property trading, 4-6 players) - shared by server and client, no I/O.
// The server applies every move with these functions on the stored state; the client uses the same
// predicates (buildProblem, mortgageProblem, ...) to enable buttons.

import {
  BOARD,
  BOARD_SIZE,
  CARDS,
  type Deck,
  DECK_NAME,
  GO_TO_JAIL,
  groupOf,
  GROUP_SQUARES,
  HOTEL_SUPPLY,
  HOUSE_SUPPLY,
  houseCost,
  isProperty,
  JAIL,
  JAIL_FINE,
  mortgageValue,
  PROPERTIES,
  SALARY,
  STATION_RENTS,
  STATIONS,
  unmortgageCost,
  UTILITIES,
  UTILITY_MULTIPLIERS,
} from "./board";

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 6;
export const MAX_OBSERVERS = 16;
export const NICKNAME_MAX = 12;
/** Lobby/finished rooms nobody has open are closed after this long. */
export const ROOM_IDLE_MINUTES = 10;
/** A running game nobody has open is closed after this long (6 hours, same as ROOM_ABANDONED_PLAYING_MS). */
export const PLAYING_IDLE_MINUTES = 360;
/** /state refreshes last_activity_at at most this often, to keep DB writes low. */
export const PRESENCE_TOUCH_MS = 20_000;
/** Extra time on top of the turn timer, for network latency, before a turn can be forced. */
export const TIMEOUT_GRACE_MS = 1_500;
/** First bid of an auction, and the smallest raise after it. */
export const MIN_BID = 10;
export const BID_STEP = 10;
const LOG_MAX = 100;

/** "10 minute" / "60 de minute" (Romanian numeral agreement). */
export function minutesLabel(n: number): string {
  return `${n} ${n >= 20 ? "de " : ""}${n === 1 ? "minut" : "minute"}`;
}

/** "1.500 lei" */
export function money(n: number): string {
  return `${n.toLocaleString("ro-RO")} lei`;
}

export function isRoomExpired(status: string, lastActivityAt: string | Date, now = Date.now()): boolean {
  const idle = now - new Date(lastActivityAt).getTime();
  if (status === "playing") return idle > PLAYING_IDLE_MINUTES * 60_000;
  return idle > ROOM_IDLE_MINUTES * 60_000;
}

/**
 * A lobby / finished room is abandoned once its last activity is older than this AND no member (player or
 * spectator) has been seen within it. Swept every time the room list loads (GET /api/rooms).
 */
export const ROOM_ABANDONED_MS = 600_000;
/** Same rule for a running game ("playing"), with a much longer limit: 6 hours. */
export const ROOM_ABANDONED_PLAYING_MS = 6 * 3600_000;

export function abandonedLimitMs(status: string): number {
  return status === "playing" ? ROOM_ABANDONED_PLAYING_MS : ROOM_ABANDONED_MS;
}

export function isRoomAbandoned(
  status: string,
  lastActivityAt: string | Date,
  membersLastSeen: (string | Date | null | undefined)[],
  now = Date.now(),
): boolean {
  const limit = abandonedLimitMs(status);
  const recent = (t: string | Date | null | undefined) => {
    if (t === null || t === undefined) return false;
    const ms = new Date(t).getTime();
    return !Number.isNaN(ms) && now - ms <= limit;
  };
  return !recent(lastActivityAt) && !membersLastSeen.some(recent);
}

/** A move that breaks the rules; its message is shown to the player. */
export class RuleError extends Error {}
function rule(message: string): never {
  throw new RuleError(message);
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------
export type EndMode = "bankrupt" | "time";
export const END_MODES: EndMode[] = ["bankrupt", "time"];

export interface Settings {
  /** Money every player starts with. */
  startMoney: number;
  /** A property the player declines to buy is auctioned; off = it stays with the bank. */
  auctions: boolean;
  /** Seconds per decision before the game plays it automatically. */
  turnSeconds: number;
  /** "bankrupt": until one player is left; "time": after `minutes` the round finishes, richest wins. */
  endMode: EndMode;
  minutes: number;
}

export const DEFAULT_SETTINGS: Settings = {
  startMoney: 1500,
  auctions: true,
  turnSeconds: 60,
  endMode: "bankrupt",
  minutes: 90,
};

export const LIMITS = {
  startMoney: { min: 500, max: 10_000, step: 100 },
  minutes: { min: 30, max: 180, step: 15 },
} as const;
export const TURN_OPTIONS = [30, 45, 60, 90, 120];

export function settingsError(s: Settings): string | null {
  const { startMoney, minutes } = LIMITS;
  const inRange = (v: number, r: { min: number; max: number; step: number }) =>
    Number.isInteger(v) && v >= r.min && v <= r.max && (v - r.min) % r.step === 0;
  if (!inRange(s.startMoney, startMoney)) {
    return `Banii de start trebuie să fie între ${startMoney.min} și ${startMoney.max}, din ${startMoney.step} în ${startMoney.step}.`;
  }
  if (typeof s.auctions !== "boolean") return "Licitația trebuie să fie pornită sau oprită.";
  if (!TURN_OPTIONS.includes(s.turnSeconds)) return `Timpul pe tură poate fi ${TURN_OPTIONS.join(", ")} de secunde.`;
  if (!END_MODES.includes(s.endMode)) return "Mod de final invalid.";
  if (!inRange(s.minutes, minutes)) {
    return `Durata trebuie să fie între ${minutes.min} și ${minutes.max} de minute, din ${minutes.step} în ${minutes.step}.`;
  }
  return null;
}

/**
 * Seat order: the host first, then everyone else in join order. A spectator host is simply not seated.
 */
export function seatOrder(playerIdsByJoin: string[], hostId: string | null): string[] {
  if (hostId && playerIdsByJoin.includes(hostId)) return [hostId, ...playerIdsByJoin.filter((id) => id !== hostId)];
  return [...playerIdsByJoin];
}

/** Token / panel color of each seat. */
export const PLAYER_COLORS = ["#e11d48", "#2563eb", "#16a34a", "#d97706", "#9333ea", "#0891b2"];

// ---------------------------------------------------------------------------
// Game state
// ---------------------------------------------------------------------------
export type Phase = "roll" | "buy" | "auction" | "debt" | "done" | "over";
/** Who gets a payment: a seat, the Parking pot or the bank. */
export type Payee = number | "pot" | "bank";

export interface Debt {
  seat: number;
  amount: number;
  to: Payee;
  reason: string;
  /** Jail: after the fine is paid, the player moves this many squares. */
  after?: { steps: number };
}

export interface Auction {
  square: number;
  /** Highest bid so far (0 = none). */
  high: number;
  bidder: number | null;
  /** Seats still bidding. */
  active: number[];
  /** Seat whose turn it is to bid or pass. */
  turn: number;
}

export interface TradeSide {
  squares: number[];
  cash: number;
  /** Number of "get out of jail" cards. */
  cards: number;
}

export interface Trade {
  id: number;
  from: number;
  to: number;
  /** What `from` gives. */
  give: TradeSide;
  /** What `from` gets from `to`. */
  get: TradeSide;
}

export interface LogEntry {
  n: number;
  seat: number | null;
  text: string;
}

export interface GameState {
  settings: Settings;
  seats: string[];
  names: string[];
  cash: number[];
  pos: number[];
  inJail: boolean[];
  /** Failed rolls for doubles in jail this stay. */
  jailTries: number[];
  /** "Get out of jail" cards held, by the deck they go back to. */
  jailCards: Deck[][];
  bankrupt: boolean[];
  left: boolean[];
  /** Final place (1 = winner), set at bankruptcy or at the end. */
  place: (number | null)[];
  /** Per square: owner seat, null = bank (or not a property). */
  owner: (number | null)[];
  /** Per square: 0-4 houses, 5 = hotel. */
  houses: number[];
  mortgaged: boolean[];
  housesLeft: number;
  hotelsLeft: number;
  /** Parking pot: taxes and fines, taken by whoever lands on Parking. */
  pot: number;
  /** Card order (indexes into CARDS); never sent to clients. */
  decks: Record<Deck, number[]>;
  turn: number;
  phase: Phase;
  /** The current player rolled at least once this turn. */
  rolled: boolean;
  /** Doubles: the current player rolls again after this move. */
  again: boolean;
  doubles: number;
  dice: [number, number] | null;
  /** Counts rolls, for animations and the turn signature. */
  moveNo: number;
  /** Unowned property the current player landed on and may buy. */
  buySquare: number | null;
  auction: Auction | null;
  /** Properties waiting to be auctioned (after a bankruptcy to the bank). */
  auctionQueue: number[];
  debts: Debt[];
  trade: Trade | null;
  tradeNo: number;
  lastCard: { seat: number; deck: Deck; index: number; n: number } | null;
  cardNo: number;
  log: LogEntry[];
  logNo: number;
  startedAt: number;
  /** "time" mode: after this the round finishes and the game ends. */
  endsAt: number | null;
  /** Signature of who must act on what; a change restarts the turn timer. */
  sig: string;
  /** When the current decision started (turn timer). */
  since: number;
  turnNo: number;
  winner: number | null;
  endReason: EndMode | null;
  /** Net money the bank put into the game (salaries, mortgages...) minus what it took. For the money check. */
  bank: number;
}

/** Everything but the hidden card order: what clients get. */
export type GameView = Omit<GameState, "decks">;

export type Action =
  | { kind: "roll" }
  | { kind: "payJail" }
  | { kind: "useCard" }
  | { kind: "buy" }
  | { kind: "decline" }
  | { kind: "bid"; amount: number }
  | { kind: "pass" }
  | { kind: "build"; square: number }
  | { kind: "sell"; square: number }
  | { kind: "mortgage"; square: number }
  | { kind: "unmortgage"; square: number }
  | { kind: "pay" }
  | { kind: "bankrupt" }
  | { kind: "end" }
  | { kind: "propose"; to: number; give: TradeSide; get: TradeSide }
  | { kind: "accept" }
  | { kind: "reject" }
  | { kind: "cancel" };

const SIMPLE = ["roll", "payJail", "useCard", "buy", "decline", "pass", "pay", "bankrupt", "end", "accept", "reject", "cancel"] as const;
const ON_SQUARE = ["build", "sell", "mortgage", "unmortgage"] as const;

function parseSide(v: unknown): TradeSide {
  if (!v || typeof v !== "object") rule("Ofertă invalidă.");
  const o = v as Record<string, unknown>;
  const squares = o.squares ?? [];
  if (!Array.isArray(squares) || squares.length > PROPERTIES.length || !squares.every((s) => Number.isInteger(s))) rule("Ofertă invalidă.");
  const cash = Number(o.cash ?? 0);
  const cards = Number(o.cards ?? 0);
  if (!Number.isInteger(cash) || !Number.isInteger(cards)) rule("Suma trebuie să fie un număr întreg.");
  return { squares: squares as number[], cash, cards };
}

/** Turns a request body into an Action (shape only; the rules are checked when it is applied). */
export function parseAction(body: unknown): Action {
  if (!body || typeof body !== "object") rule("Acțiune invalidă.");
  const o = body as Record<string, unknown>;
  const kind = o.kind;
  if ((SIMPLE as readonly unknown[]).includes(kind)) return { kind } as Action;
  if ((ON_SQUARE as readonly unknown[]).includes(kind)) {
    const square = Number(o.square);
    if (!Number.isInteger(square) || square < 0 || square >= BOARD_SIZE) rule("Proprietate invalidă.");
    return { kind, square } as Action;
  }
  if (kind === "bid") {
    const amount = Number(o.amount);
    if (!Number.isInteger(amount)) rule("Oferta trebuie să fie un număr întreg.");
    return { kind, amount };
  }
  if (kind === "propose") {
    const to = Number(o.to);
    if (!Number.isInteger(to)) rule("Jucător invalid.");
    return { kind, to, give: parseSide(o.give), get: parseSide(o.get) };
  }
  return rule("Acțiune invalidă.");
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------
export function shuffle<T>(items: T[], random: () => number = Math.random): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.min(i, Math.floor(random() * (i + 1)));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const die = (random: () => number) => Math.min(6, 1 + Math.floor(random() * 6));

export const alive = (g: GameView, seat: number) => !g.bankrupt[seat];
export const aliveSeats = (g: GameView) => g.seats.map((_, i) => i).filter((i) => !g.bankrupt[i]);

/** First seat after `from` (cyclic) that passes `ok`. */
function nextSeat(g: GameView, from: number, ok: (i: number) => boolean): number | null {
  const n = g.seats.length;
  for (let k = 1; k <= n; k++) {
    const j = (from + k) % n;
    if (ok(j)) return j;
  }
  return null;
}

function log(g: GameState, seat: number | null, text: string) {
  g.logNo++;
  g.log.push({ n: g.logNo, seat, text });
  if (g.log.length > LOG_MAX) g.log.splice(0, g.log.length - LOG_MAX);
}

/** Moves money and keeps the bank balance used by the money-conservation check. */
function pay(g: GameState, from: number | "bank", to: Payee, amount: number) {
  if (amount <= 0) return;
  if (from === "bank") g.bank += amount;
  else g.cash[from] -= amount;
  if (to === "bank") g.bank -= amount;
  else if (to === "pot") g.pot += amount;
  else g.cash[to] += amount;
}

/**
 * Asks `seat` to pay. Paid at once when the cash is there (and nothing is owed before it), otherwise it becomes a
 * debt the player has to cover (sell, mortgage, trade) or go bankrupt over. Returns true when paid at once.
 */
function charge(g: GameState, seat: number, amount: number, to: Payee, reason: string, after?: { steps: number }): boolean {
  if (amount <= 0) return true;
  if (typeof to === "number" && g.bankrupt[to]) to = "bank";
  if (g.cash[seat] >= amount && !g.debts.some((d) => d.seat === seat)) {
    pay(g, seat, to, amount);
    log(g, seat, `${g.names[seat]} plătește ${money(amount)} ${to === "pot" ? "la Parcare" : to === "bank" ? "băncii" : `lui ${g.names[to]}`} (${reason}).`);
    return true;
  }
  g.debts.push({ seat, amount, to, reason, ...(after ? { after } : {}) });
  log(g, seat, `${g.names[seat]} trebuie să plătească ${money(amount)} (${reason}), dar nu are destui bani.`);
  return false;
}

export function ownsGroup(g: GameView, seat: number, square: number): boolean {
  return groupOf(square).every((s) => g.owner[s] === seat);
}

/** Rent for landing on `square` (owned, not mortgaged). */
export function rentFor(g: GameView, square: number, diceSum: number, opts: { stationMul?: number; utilityMul?: number } = {}): number {
  const sq = BOARD[square];
  const o = g.owner[square];
  if (o === null) return 0;
  if (sq.kind === "street") {
    const h = g.houses[square];
    if (h > 0) return sq.rents![h];
    return sq.rents![0] * (ownsGroup(g, o, square) ? 2 : 1);
  }
  if (sq.kind === "station") {
    const n = STATIONS.filter((s) => g.owner[s] === o).length;
    return STATION_RENTS[n - 1] * (opts.stationMul ?? 1);
  }
  if (sq.kind === "utility") {
    const n = UTILITIES.filter((s) => g.owner[s] === o).length;
    return diceSum * (opts.utilityMul ?? UTILITY_MULTIPLIERS[n - 1]);
  }
  return 0;
}

/** What `seat` is worth: cash, properties at price (mortgaged at half), buildings at cost. */
export function netWorth(g: GameView, seat: number): number {
  let total = g.cash[seat];
  for (const s of PROPERTIES) {
    if (g.owner[s] !== seat) continue;
    total += g.mortgaged[s] ? mortgageValue(s) : (BOARD[s].price ?? 0);
    total += g.houses[s] * houseCost(s);
  }
  return total;
}

/** The seat that has to act now (null once the game is over). A pending trade waits for its target. */
export function actorOf(g: GameView): number | null {
  if (g.phase === "over") return null;
  if (g.trade) return g.trade.to;
  if (g.phase === "auction" && g.auction) return g.auction.turn;
  if (g.phase === "debt" && g.debts.length > 0) return g.debts[0].seat;
  return g.turn;
}

/** Identifies the current decision; sent back with a timeout so a late request cannot skip the next one. */
export const turnKey = (g: Pick<GameView, "turnNo">) => String(g.turnNo);

/** ms epoch when the current decision times out. */
export function turnDeadline(g: GameView): number | null {
  if (g.phase === "over") return null;
  return g.since + g.settings.turnSeconds * 1000;
}

/** Restarts the turn timer whenever who-acts-on-what changes. */
function touch(g: GameState, now: number) {
  const a = g.auction;
  const sig = [g.phase, actorOf(g), g.turn, g.moveNo, a ? `${a.square}:${a.high}:${a.turn}` : "", g.trade?.id ?? "", g.debts.length].join("|");
  if (sig !== g.sig) {
    g.sig = sig;
    g.since = now;
    g.turnNo++;
  }
}

/** The seat may sell, mortgage, build or propose trades now: its own turn, or covering its own debt. */
export function canManage(g: GameView, seat: number): boolean {
  if (g.phase === "over" || g.trade || g.bankrupt[seat]) return false;
  if (g.phase === "debt") return g.debts[0]?.seat === seat;
  return (g.phase === "roll" || g.phase === "buy" || g.phase === "done") && g.turn === seat;
}

const groupHasBuildings = (g: GameView, square: number) => groupOf(square).some((s) => g.houses[s] > 0);

export function buildProblem(g: GameView, seat: number, square: number): string | null {
  if (!canManage(g, seat) || g.phase === "debt") return "Construiești doar în tura ta.";
  const sq = BOARD[square];
  if (!sq || sq.kind !== "street") return "Se construiește doar pe străzi.";
  if (g.owner[square] !== seat) return "Nu e proprietatea ta.";
  if (!ownsGroup(g, seat, square)) return "Ai nevoie de toată regiunea ca să construiești.";
  const group = groupOf(square);
  if (group.some((s) => g.mortgaged[s])) return "O proprietate din regiune e ipotecată.";
  const h = g.houses[square];
  if (h >= 5) return "Are deja hotel.";
  if (h > Math.min(...group.map((s) => g.houses[s]))) return "Construiește uniform: întâi pe celelalte din regiune.";
  if (h === 4 && g.hotelsLeft <= 0) return "Banca nu mai are hoteluri.";
  if (h < 4 && g.housesLeft <= 0) return "Banca nu mai are case.";
  if (g.cash[seat] < houseCost(square)) return "Nu ai destui bani.";
  return null;
}

export function sellProblem(g: GameView, seat: number, square: number): string | null {
  if (!canManage(g, seat)) return "Vinzi doar în tura ta sau când ai o datorie.";
  if (g.owner[square] !== seat) return "Nu e proprietatea ta.";
  const h = g.houses[square];
  if (h <= 0) return "Nu are clădiri.";
  if (h < Math.max(...groupOf(square).map((s) => g.houses[s]))) return "Vinde uniform: întâi de pe celelalte din regiune.";
  return null;
}

export function mortgageProblem(g: GameView, seat: number, square: number): string | null {
  if (!canManage(g, seat)) return "Ipotechezi doar în tura ta sau când ai o datorie.";
  if (!isProperty(square) || g.owner[square] !== seat) return "Nu e proprietatea ta.";
  if (g.mortgaged[square]) return "E deja ipotecată.";
  if (groupHasBuildings(g, square)) return "Vinde întâi clădirile din regiune.";
  return null;
}

export function unmortgageProblem(g: GameView, seat: number, square: number): string | null {
  if (!canManage(g, seat)) return "Răscumperi doar în tura ta.";
  if (!isProperty(square) || g.owner[square] !== seat) return "Nu e proprietatea ta.";
  if (!g.mortgaged[square]) return "Nu e ipotecată.";
  if (g.cash[seat] < unmortgageCost(square)) return "Nu ai destui bani.";
  return null;
}

/** A property can change hands in a trade only with no buildings anywhere in its group. */
export const tradeable = (g: GameView, seat: number, square: number) =>
  isProperty(square) && g.owner[square] === seat && !groupHasBuildings(g, square);

export function tradeProblem(g: GameView, from: number, to: number, give: TradeSide, get: TradeSide): string | null {
  if (!Number.isInteger(to) || to < 0 || to >= g.seats.length || to === from || g.bankrupt[to]) return "Alege un jucător din joc.";
  const side = (seat: number, s: TradeSide): string | null => {
    if (new Set(s.squares).size !== s.squares.length) return "Ofertă invalidă.";
    if (!s.squares.every((sq) => tradeable(g, seat, sq))) return "Doar proprietăți fără clădiri în regiune pot fi schimbate.";
    if (s.cash < 0 || s.cash > g.cash[seat]) return `${g.names[seat]} nu are ${money(s.cash)}.`;
    if (s.cards < 0 || s.cards > g.jailCards[seat].length) return `${g.names[seat]} nu are atâtea cărți de ieșire din închisoare.`;
    return null;
  };
  const problem = side(from, give) ?? side(to, get);
  if (problem) return problem;
  const empty = (s: TradeSide) => s.squares.length === 0 && s.cash === 0 && s.cards === 0;
  if (empty(give) && empty(get)) return "Oferta e goală.";
  return null;
}

/** Smallest bid `seat` may make in the running auction. */
export function minBid(g: GameView): number {
  const a = g.auction;
  return !a || a.bidder === null ? MIN_BID : a.high + BID_STEP;
}

// ---------------------------------------------------------------------------
// New game
// ---------------------------------------------------------------------------
export function newGame(seats: string[], names: string[], settings: Settings, now: number, random: () => number = Math.random): GameState {
  const n = seats.length;
  const g: GameState = {
    settings,
    seats,
    names,
    cash: seats.map(() => settings.startMoney),
    pos: seats.map(() => 0),
    inJail: seats.map(() => false),
    jailTries: seats.map(() => 0),
    jailCards: seats.map(() => []),
    bankrupt: seats.map(() => false),
    left: seats.map(() => false),
    place: seats.map(() => null),
    owner: BOARD.map(() => null),
    houses: BOARD.map(() => 0),
    mortgaged: BOARD.map(() => false),
    housesLeft: HOUSE_SUPPLY,
    hotelsLeft: HOTEL_SUPPLY,
    pot: 0,
    decks: {
      noroc: shuffle(CARDS.noroc.map((_, i) => i), random),
      destin: shuffle(CARDS.destin.map((_, i) => i), random),
    },
    turn: 0,
    phase: "roll",
    rolled: false,
    again: false,
    doubles: 0,
    dice: null,
    moveNo: 0,
    buySquare: null,
    auction: null,
    auctionQueue: [],
    debts: [],
    trade: null,
    tradeNo: 0,
    lastCard: null,
    cardNo: 0,
    log: [],
    logNo: 0,
    startedAt: now,
    endsAt: settings.endMode === "time" ? now + settings.minutes * 60_000 : null,
    sig: "",
    since: now,
    turnNo: 0,
    winner: null,
    endReason: null,
    bank: 0,
  };
  log(g, null, `Jocul a început: ${n} jucători, câte ${money(settings.startMoney)}. Începe ${names[0]}.`);
  touch(g, now);
  return g;
}

// ---------------------------------------------------------------------------
// Moving and landing
// ---------------------------------------------------------------------------
interface LandOpts {
  stationMul?: number;
  utilityMul?: number;
}

function sendToJail(g: GameState, seat: number) {
  g.pos[seat] = JAIL;
  g.inJail[seat] = true;
  g.jailTries[seat] = 0;
  if (seat === g.turn) {
    g.again = false;
    g.doubles = 0;
  }
  log(g, seat, `${g.names[seat]} merge la închisoare.`);
}

function moveTo(g: GameState, seat: number, to: number, random: () => number, opts: LandOpts = {}) {
  if (to <= g.pos[seat]) {
    pay(g, "bank", seat, SALARY);
    log(g, seat, `${g.names[seat]} trece pe la Start și încasează ${money(SALARY)}.`);
  }
  g.pos[seat] = to;
  land(g, seat, random, opts);
}

function move(g: GameState, seat: number, steps: number, random: () => number) {
  moveTo(g, seat, (g.pos[seat] + steps) % BOARD_SIZE, random);
}

function land(g: GameState, seat: number, random: () => number, opts: LandOpts) {
  const i = g.pos[seat];
  const sq = BOARD[i];
  switch (sq.kind) {
    case "street":
    case "station":
    case "utility": {
      const o = g.owner[i];
      if (o === null) {
        g.buySquare = i;
      } else if (o !== seat && !g.mortgaged[i] && !g.bankrupt[o]) {
        const d = g.dice ? g.dice[0] + g.dice[1] : 7;
        charge(g, seat, rentFor(g, i, d, opts), o, `chirie ${sq.name}`);
      } else if (o !== seat && g.mortgaged[i]) {
        log(g, seat, `${sq.name} e ipotecată: ${g.names[seat]} nu plătește chirie.`);
      }
      return;
    }
    case "tax":
      charge(g, seat, sq.tax!, "pot", sq.name.toLowerCase());
      return;
    case "noroc":
    case "destin":
      drawCard(g, seat, sq.kind, random);
      return;
    case "parking":
      if (g.pot > 0) {
        log(g, seat, `${g.names[seat]} ia ${money(g.pot)} de la Parcare.`);
        g.cash[seat] += g.pot;
        g.pot = 0;
      }
      return;
    case "gotojail":
      sendToJail(g, seat);
      return;
    default:
      return;
  }
}

function drawCard(g: GameState, seat: number, deck: Deck, random: () => number) {
  const index = g.decks[deck].shift();
  if (index === undefined) return; // every card held by players: nothing to draw
  const card = CARDS[deck][index];
  g.cardNo++;
  g.lastCard = { seat, deck, index, n: g.cardNo };
  log(g, seat, `${g.names[seat]} trage ${DECK_NAME[deck]}: ${card.text}`);
  const e = card.effect;
  if (e.kind !== "jailfree") g.decks[deck].push(index);
  switch (e.kind) {
    case "goto":
      moveTo(g, seat, e.to, random);
      return;
    case "nearest": {
      const list = e.what === "station" ? STATIONS : UTILITIES;
      const here = g.pos[seat];
      const to = list.find((s) => s > here) ?? list[0];
      moveTo(g, seat, to, random, e.what === "station" ? { stationMul: 2 } : { utilityMul: 10 });
      return;
    }
    case "back":
      g.pos[seat] = (g.pos[seat] - e.steps + BOARD_SIZE) % BOARD_SIZE;
      land(g, seat, random, {});
      return;
    case "jail":
      sendToJail(g, seat);
      return;
    case "jailfree":
      g.jailCards[seat].push(deck);
      return;
    case "money":
      if (e.amount > 0) pay(g, "bank", seat, e.amount);
      else charge(g, seat, -e.amount, "pot", DECK_NAME[deck]);
      return;
    case "each":
      for (const o of aliveSeats(g)) {
        if (o === seat) continue;
        if (e.amount > 0) charge(g, o, e.amount, seat, DECK_NAME[deck]);
        else charge(g, seat, -e.amount, o, DECK_NAME[deck]);
      }
      return;
    case "repairs": {
      let total = 0;
      for (const s of PROPERTIES) {
        if (g.owner[s] !== seat) continue;
        total += g.houses[s] === 5 ? e.hotel : g.houses[s] * e.house;
      }
      if (total > 0) charge(g, seat, total, "pot", "reparații");
      return;
    }
  }
}

// ---------------------------------------------------------------------------
// Turn flow
// ---------------------------------------------------------------------------
/** Ends the game: places by net worth for everyone still in (1 = winner). */
function finish(g: GameState, reason: EndMode) {
  const ranked = aliveSeats(g).sort((a, b) => netWorth(g, b) - netWorth(g, a) || a - b);
  ranked.forEach((s, i) => (g.place[s] = i + 1));
  g.winner = ranked[0] ?? null;
  g.endReason = reason;
  g.phase = "over";
  g.auction = null;
  g.auctionQueue = [];
  g.debts = [];
  g.trade = null;
  g.buySquare = null;
  if (g.winner !== null) {
    log(
      g,
      g.winner,
      reason === "time"
        ? `Timpul s-a terminat. ${g.names[g.winner]} câștigă cu o avere de ${money(netWorth(g, g.winner))}.`
        : `${g.names[g.winner]} a rămas singurul jucător și câștigă!`,
    );
  }
}

function nextTurn(g: GameState, now: number) {
  const next = nextSeat(g, g.turn, (i) => !g.bankrupt[i]);
  if (next === null) return;
  // "time" mode: once the time is up, the game ends when the round comes back to the first seat.
  if (g.endsAt !== null && now >= g.endsAt && next <= g.turn) {
    finish(g, "time");
    return;
  }
  g.turn = next;
  g.phase = "roll";
  g.rolled = false;
  g.again = false;
  g.doubles = 0;
  g.buySquare = null;
}

function startAuction(g: GameState) {
  const square = g.auctionQueue.shift()!;
  const order: number[] = [];
  const n = g.seats.length;
  for (let k = 1; k <= n; k++) {
    const j = (g.turn + k) % n;
    if (!g.bankrupt[j]) order.push(j);
  }
  g.auction = { square, high: 0, bidder: null, active: order, turn: order[0] };
  log(g, null, `Licitație pentru ${BOARD[square].name} (preț ${money(BOARD[square].price ?? 0)}).`);
}

/** Decides what happens next after any move: debts first, then auctions, the purchase, the roll or end of turn. */
function settle(g: GameState, now: number) {
  if (g.phase === "over") return;
  if (aliveSeats(g).length <= 1) {
    finish(g, "bankrupt");
    return;
  }
  if (g.debts.length > 0) {
    g.phase = "debt";
    return;
  }
  if (g.auction) {
    g.phase = "auction";
    return;
  }
  if (g.auctionQueue.length > 0) {
    startAuction(g);
    g.phase = "auction";
    return;
  }
  if (g.buySquare !== null && !g.bankrupt[g.turn]) {
    g.phase = "buy";
    return;
  }
  if (g.bankrupt[g.turn]) {
    nextTurn(g, now);
    return;
  }
  g.phase = !g.rolled || g.again ? "roll" : "done";
}

function roll(g: GameState, seat: number, random: () => number) {
  const d: [number, number] = [die(random), die(random)];
  const sum = d[0] + d[1];
  const isDouble = d[0] === d[1];
  g.dice = d;
  g.moveNo++;
  g.rolled = true;
  g.again = false;
  log(g, seat, `${g.names[seat]} dă ${d[0]} și ${d[1]}${isDouble ? " (dublă)" : ""}.`);
  if (g.inJail[seat]) {
    if (isDouble) {
      g.inJail[seat] = false;
      g.jailTries[seat] = 0;
      log(g, seat, `${g.names[seat]} iese din închisoare cu dublă.`);
      move(g, seat, sum, random);
      return;
    }
    g.jailTries[seat]++;
    if (g.jailTries[seat] >= 3) {
      g.inJail[seat] = false;
      g.jailTries[seat] = 0;
      if (charge(g, seat, JAIL_FINE, "pot", "amenda de ieșire din închisoare", { steps: sum })) move(g, seat, sum, random);
      return;
    }
    log(g, seat, `${g.names[seat]} rămâne în închisoare (încercarea ${g.jailTries[seat]} din 3).`);
    return;
  }
  if (isDouble) {
    g.doubles++;
    if (g.doubles >= 3) {
      log(g, seat, `${g.names[seat]} a dat trei duble la rând.`);
      sendToJail(g, seat);
      return;
    }
    g.again = true;
  }
  move(g, seat, sum, random);
  if (g.inJail[seat]) g.again = false;
}

function finishAuction(g: GameState) {
  const a = g.auction!;
  const sq = BOARD[a.square];
  if (a.bidder !== null) {
    pay(g, a.bidder, "bank", a.high);
    g.owner[a.square] = a.bidder;
    log(g, a.bidder, `${g.names[a.bidder]} câștigă licitația pentru ${sq.name} cu ${money(a.high)}.`);
  } else {
    log(g, null, `Nimeni n-a licitat: ${sq.name} rămâne la bancă.`);
  }
  g.auction = null;
}

/** Bids pass to the next seat still in the auction; the auction ends when only the top bidder is left. */
function afterAuctionMove(g: GameState, from: number) {
  const a = g.auction!;
  if (a.active.length === 0 || (a.active.length === 1 && a.bidder === a.active[0])) {
    finishAuction(g);
    return;
  }
  const next = nextSeat(g, from, (i) => a.active.includes(i));
  if (next === null || next === from) {
    finishAuction(g);
    return;
  }
  a.turn = next;
}

function bid(g: GameState, seat: number, amount: number) {
  const a = g.auction!;
  if (amount < minBid(g)) rule(`Oferta minimă e ${money(minBid(g))}.`);
  if (amount > g.cash[seat]) rule("Nu ai atâția bani.");
  a.high = amount;
  a.bidder = seat;
  log(g, seat, `${g.names[seat]} licitează ${money(amount)}.`);
  afterAuctionMove(g, seat);
}

function passAuction(g: GameState, seat: number) {
  const a = g.auction!;
  a.active = a.active.filter((s) => s !== seat);
  log(g, seat, `${g.names[seat]} renunță la licitație.`);
  afterAuctionMove(g, seat);
}

function payDebt(g: GameState, seat: number, random: () => number) {
  const d = g.debts[0];
  if (g.cash[seat] < d.amount) rule(`Îți trebuie ${money(d.amount)}. Vinde clădiri, ipotechează sau fă un schimb.`);
  const to: Payee = typeof d.to === "number" && g.bankrupt[d.to] ? "bank" : d.to;
  pay(g, seat, to, d.amount);
  g.debts.shift();
  log(g, seat, `${g.names[seat]} plătește ${money(d.amount)} ${to === "pot" ? "la Parcare" : to === "bank" ? "băncii" : `lui ${g.names[to]}`} (${d.reason}).`);
  if (d.after) move(g, seat, d.after.steps, random);
}

/**
 * Bankruptcy. Buildings go back to the bank at half price first. Owing a player: they get the cash, the properties
 * (mortgages stay) and the jail cards. Owing the bank or the pot: the cash goes there, the properties return to the
 * bank unmortgaged (auctioned when auctions are on) and the cards back into their decks.
 */
function goBankrupt(g: GameState, seat: number, creditor: Payee) {
  const toPlayer = typeof creditor === "number" && creditor !== seat && !g.bankrupt[creditor];
  const before = aliveSeats(g).length;
  for (const s of PROPERTIES) {
    if (g.owner[s] !== seat || g.houses[s] === 0) continue;
    const h = g.houses[s];
    if (h === 5) g.hotelsLeft++;
    else g.housesLeft += h;
    pay(g, "bank", seat, Math.floor((h * houseCost(s)) / 2));
    g.houses[s] = 0;
  }
  const freed: number[] = [];
  if (toPlayer) {
    const c = creditor as number;
    pay(g, seat, c, g.cash[seat]);
    for (const s of PROPERTIES) if (g.owner[s] === seat) g.owner[s] = c;
    g.jailCards[c].push(...g.jailCards[seat]);
    log(g, seat, `${g.names[seat]} a dat faliment. Totul trece la ${g.names[c]}.`);
  } else {
    pay(g, seat, creditor === "pot" ? "pot" : "bank", g.cash[seat]);
    for (const s of PROPERTIES) {
      if (g.owner[s] !== seat) continue;
      g.owner[s] = null;
      g.mortgaged[s] = false;
      freed.push(s);
    }
    for (const d of g.jailCards[seat]) g.decks[d].push(CARDS[d].findIndex((c) => c.effect.kind === "jailfree"));
    log(g, seat, `${g.names[seat]} a dat faliment. Proprietățile se întorc la bancă.`);
  }
  g.jailCards[seat] = [];
  g.bankrupt[seat] = true;
  g.place[seat] = before;
  g.inJail[seat] = false;
  g.debts = g.debts.filter((d) => d.seat !== seat).map((d) => (d.to === seat ? { ...d, to: "bank" as const } : d));
  if (g.trade && (g.trade.from === seat || g.trade.to === seat)) g.trade = null;
  if (seat === g.turn) {
    g.buySquare = null;
    g.again = false;
  }
  if (g.auction) {
    const a = g.auction;
    if (a.bidder === seat) {
      a.bidder = null;
      a.high = 0;
    }
    if (a.active.includes(seat)) {
      a.active = a.active.filter((s) => s !== seat);
      if (a.turn === seat) afterAuctionMove(g, seat);
      else if (a.active.length === 0 || (a.active.length === 1 && a.bidder === a.active[0])) finishAuction(g);
    }
  }
  if (aliveSeats(g).length <= 1) {
    finish(g, "bankrupt");
    return;
  }
  if (g.settings.auctions) g.auctionQueue.push(...freed);
}

/** Timeout in a debt: sell buildings, then mortgage, until the debt is covered; bankrupt when it never is. */
function autoRaise(g: GameState, seat: number, needed: number) {
  while (g.cash[seat] < needed) {
    const built = PROPERTIES.filter((s) => g.owner[s] === seat && sellProblem(g, seat, s) === null);
    if (built.length === 0) break;
    applySell(g, seat, built[0]);
  }
  const free = PROPERTIES.filter((s) => g.owner[s] === seat && mortgageProblem(g, seat, s) === null).sort(
    (a, b) => mortgageValue(a) - mortgageValue(b),
  );
  for (const s of free) {
    if (g.cash[seat] >= needed) break;
    applyMortgage(g, seat, s);
  }
}

function applyBuild(g: GameState, seat: number, square: number) {
  const p = buildProblem(g, seat, square);
  if (p) rule(p);
  const cost = houseCost(square);
  if (g.houses[square] === 4) {
    g.hotelsLeft--;
    g.housesLeft += 4;
    g.houses[square] = 5;
    log(g, seat, `${g.names[seat]} construiește un hotel pe ${BOARD[square].name}.`);
  } else {
    g.housesLeft--;
    g.houses[square]++;
    log(g, seat, `${g.names[seat]} construiește o casă pe ${BOARD[square].name}.`);
  }
  pay(g, seat, "bank", cost);
}

function applySell(g: GameState, seat: number, square: number) {
  const p = sellProblem(g, seat, square);
  if (p) rule(p);
  const half = Math.floor(houseCost(square) / 2);
  if (g.houses[square] === 5) {
    g.hotelsLeft++;
    if (g.housesLeft >= 4) {
      g.housesLeft -= 4;
      g.houses[square] = 4;
      pay(g, "bank", seat, half);
    } else {
      // Not enough houses in the bank to break the hotel into: it goes away entirely.
      g.houses[square] = 0;
      pay(g, "bank", seat, half * 5);
    }
    log(g, seat, `${g.names[seat]} vinde hotelul de pe ${BOARD[square].name}.`);
  } else {
    g.housesLeft++;
    g.houses[square]--;
    pay(g, "bank", seat, half);
    log(g, seat, `${g.names[seat]} vinde o casă de pe ${BOARD[square].name}.`);
  }
}

function applyMortgage(g: GameState, seat: number, square: number) {
  const p = mortgageProblem(g, seat, square);
  if (p) rule(p);
  g.mortgaged[square] = true;
  pay(g, "bank", seat, mortgageValue(square));
  log(g, seat, `${g.names[seat]} ipotechează ${BOARD[square].name} pentru ${money(mortgageValue(square))}.`);
}

function applyUnmortgage(g: GameState, seat: number, square: number) {
  const p = unmortgageProblem(g, seat, square);
  if (p) rule(p);
  g.mortgaged[square] = false;
  pay(g, seat, "bank", unmortgageCost(square));
  log(g, seat, `${g.names[seat]} răscumpără ${BOARD[square].name} cu ${money(unmortgageCost(square))}.`);
}

function moveCards(g: GameState, from: number, to: number, n: number) {
  for (let k = 0; k < n; k++) g.jailCards[to].push(g.jailCards[from].pop()!);
}

function sideText(g: GameView, s: TradeSide): string {
  const parts = [...s.squares.map((sq) => BOARD[sq].name)];
  if (s.cash > 0) parts.push(money(s.cash));
  if (s.cards > 0) parts.push(`${s.cards} ${s.cards === 1 ? "carte" : "cărți"} de ieșire din închisoare`);
  return parts.length > 0 ? parts.join(", ") : "nimic";
}

export function tradeText(g: GameView, t: Trade): string {
  return `${g.names[t.from]} dă ${sideText(g, t.give)} și cere de la ${g.names[t.to]} ${sideText(g, t.get)}`;
}

function acceptTrade(g: GameState) {
  const t = g.trade!;
  const p = tradeProblem(g, t.from, t.to, t.give, t.get);
  if (p) {
    g.trade = null;
    rule(`Schimbul nu mai e valabil: ${p}`);
  }
  for (const s of t.give.squares) g.owner[s] = t.to;
  for (const s of t.get.squares) g.owner[s] = t.from;
  pay(g, t.from, t.to, t.give.cash);
  pay(g, t.to, t.from, t.get.cash);
  moveCards(g, t.from, t.to, t.give.cards);
  moveCards(g, t.to, t.from, t.get.cards);
  log(g, t.to, `Schimb acceptat: ${tradeText(g, t)}.`);
  g.trade = null;
}

// ---------------------------------------------------------------------------
// Public moves
// ---------------------------------------------------------------------------
/** Applies `action` by `seat`. Throws RuleError when it is not allowed. Never mutates `src`. */
export function act(src: GameState, seat: number, action: Action, now: number, random: () => number = Math.random): GameState {
  const g = structuredClone(src);
  if (g.phase === "over") rule("Jocul s-a terminat.");
  if (seat < 0 || seat >= g.seats.length || g.bankrupt[seat]) rule("Nu mai ești în joc.");
  const actor = actorOf(g);
  const mine = actor === seat;
  const k = action.kind;

  switch (action.kind) {
    case "roll":
      if (!mine || g.trade || g.phase !== "roll") rule("Nu e rândul tău să dai cu zarul.");
      roll(g, seat, random);
      settle(g, now);
      break;
    case "payJail":
      if (!mine || g.trade || g.phase !== "roll" || !g.inJail[seat]) rule("Nu ești în închisoare.");
      if (g.cash[seat] < JAIL_FINE) rule("Nu ai destui bani.");
      pay(g, seat, "pot", JAIL_FINE);
      g.inJail[seat] = false;
      g.jailTries[seat] = 0;
      log(g, seat, `${g.names[seat]} plătește ${money(JAIL_FINE)} și iese din închisoare.`);
      break;
    case "useCard": {
      if (!mine || g.trade || g.phase !== "roll" || !g.inJail[seat]) rule("Nu ești în închisoare.");
      const deck = g.jailCards[seat].pop();
      if (!deck) rule("Nu ai o carte de ieșire din închisoare.");
      g.decks[deck!].push(CARDS[deck!].findIndex((c) => c.effect.kind === "jailfree"));
      g.inJail[seat] = false;
      g.jailTries[seat] = 0;
      log(g, seat, `${g.names[seat]} folosește cartea și iese din închisoare.`);
      break;
    }
    case "buy": {
      if (!mine || g.trade || g.phase !== "buy" || g.buySquare === null) rule("Nu ai ce cumpăra acum.");
      const sq = g.buySquare!;
      const price = BOARD[sq].price ?? 0;
      if (g.cash[seat] < price) rule("Nu ai destui bani. Poți ipoteca ceva întâi.");
      pay(g, seat, "bank", price);
      g.owner[sq] = seat;
      g.buySquare = null;
      log(g, seat, `${g.names[seat]} cumpără ${BOARD[sq].name} cu ${money(price)}.`);
      settle(g, now);
      break;
    }
    case "decline": {
      if (!mine || g.trade || g.phase !== "buy" || g.buySquare === null) rule("Nu ai ce refuza acum.");
      const sq = g.buySquare!;
      g.buySquare = null;
      if (g.settings.auctions) g.auctionQueue.push(sq);
      else log(g, seat, `${g.names[seat]} nu cumpără ${BOARD[sq].name}; rămâne la bancă.`);
      settle(g, now);
      break;
    }
    case "bid":
      if (!mine || g.trade || g.phase !== "auction" || !g.auction) rule("Nu e rândul tău la licitație.");
      bid(g, seat, action.amount);
      settle(g, now);
      break;
    case "pass":
      if (!mine || g.trade || g.phase !== "auction" || !g.auction) rule("Nu e rândul tău la licitație.");
      passAuction(g, seat);
      settle(g, now);
      break;
    case "build":
      applyBuild(g, seat, action.square);
      break;
    case "sell":
      applySell(g, seat, action.square);
      break;
    case "mortgage":
      applyMortgage(g, seat, action.square);
      break;
    case "unmortgage":
      applyUnmortgage(g, seat, action.square);
      break;
    case "pay":
      if (!mine || g.trade || g.phase !== "debt") rule("Nu ai nimic de plătit acum.");
      payDebt(g, seat, random);
      settle(g, now);
      break;
    case "bankrupt":
      if (!mine || g.trade || g.phase !== "debt") rule("Poți declara faliment doar când nu-ți poți plăti datoria.");
      goBankrupt(g, seat, g.debts[0].to);
      settle(g, now);
      break;
    case "end":
      if (!mine || g.trade || g.phase !== "done") rule("Nu poți încheia tura acum.");
      nextTurn(g, now);
      break;
    case "propose": {
      if (!canManage(g, seat)) rule("Propui schimburi doar în tura ta sau când ai o datorie.");
      const p = tradeProblem(g, seat, action.to, action.give, action.get);
      if (p) rule(p);
      g.tradeNo++;
      g.trade = { id: g.tradeNo, from: seat, to: action.to, give: action.give, get: action.get };
      log(g, seat, `Propunere de schimb: ${tradeText(g, g.trade)}.`);
      break;
    }
    case "accept":
      if (!g.trade || g.trade.to !== seat) rule("Nu ai o propunere de schimb.");
      acceptTrade(g);
      break;
    case "reject":
    case "cancel": {
      const t = g.trade;
      if (!t || (k === "reject" ? t.to : t.from) !== seat) rule("Nu ai o propunere de schimb.");
      log(g, seat, k === "reject" ? `${g.names[seat]} refuză schimbul.` : `${g.names[seat]} retrage propunerea de schimb.`);
      g.trade = null;
      break;
    }
  }
  touch(g, now);
  return g;
}

export type ForceReason = "timeout" | "host";

/** Plays the current decision for a player who did not act (turn timer ran out, or the host skips them). */
export function forceAction(src: GameState, now: number, random: () => number = Math.random, reason: ForceReason = "timeout"): GameState {
  const g = structuredClone(src);
  const seat = actorOf(g);
  if (seat === null) rule("Jocul s-a terminat.");
  const why = reason === "host" ? "sărit de host" : "timp expirat";
  const s = seat!;
  if (g.trade) {
    log(g, s, `Schimbul a expirat (${why}).`);
    g.trade = null;
  } else {
    switch (g.phase) {
      case "roll":
        log(g, s, `⏱ ${g.names[s]} dă automat cu zarul (${why}).`);
        roll(g, s, random);
        break;
      case "buy":
        log(g, s, `⏱ ${g.names[s]} nu cumpără (${why}).`);
        if (g.settings.auctions) g.auctionQueue.push(g.buySquare!);
        g.buySquare = null;
        break;
      case "auction":
        passAuction(g, s);
        break;
      case "debt": {
        const d = g.debts[0];
        autoRaise(g, s, d.amount);
        if (g.cash[s] >= d.amount) payDebt(g, s, random);
        else goBankrupt(g, s, d.to);
        break;
      }
      case "done":
        log(g, s, `⏱ Tura lui ${g.names[s]} s-a încheiat (${why}).`);
        nextTurn(g, now);
        break;
    }
    settle(g, now);
  }
  touch(g, now);
  return g;
}

/** A player leaves (or is kicked) mid-game: bankrupt to the bank. */
export function removeSeat(src: GameState, seat: number, now: number): GameState {
  const g = structuredClone(src);
  g.left[seat] = true;
  if (g.phase !== "over" && !g.bankrupt[seat]) {
    log(g, seat, `${g.names[seat]} a părăsit jocul.`);
    goBankrupt(g, seat, "bank");
    settle(g, now);
  }
  touch(g, now);
  return g;
}

/** Sum of every player's cash and the pot; equals start money × players + the bank's net payments. */
export function moneyInPlay(g: GameView): number {
  return g.cash.reduce((a, b) => a + b, 0) + g.pot;
}

export { GROUP_SQUARES, GO_TO_JAIL };
