import { describe, expect, it } from "vitest";
import { BOARD, GROUP_SQUARES, HOTEL_SUPPLY, HOUSE_SUPPLY, houseCost, mortgageValue, PROPERTIES, unmortgageCost } from "./board";
import {
  act,
  type Action,
  actorOf,
  buildProblem,
  DEFAULT_SETTINGS,
  forceAction,
  type GameState,
  minBid,
  moneyInPlay,
  mortgageProblem,
  netWorth,
  newGame,
  parseAction,
  removeSeat,
  RuleError,
  salaryOf,
  sellProblem,
  type Settings,
  settingsError,
  tradeable,
  tradeProblem,
  turnDeadline,
  turnKey,
  unmortgageProblem,
} from "./marchipoly";

const T0 = 1_700_000_000_000;

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random source that rolls the given dice values, in order. */
function dice(...values: number[]): () => number {
  let i = 0;
  return () => {
    const v = values[i++];
    if (v === undefined) throw new Error("ran out of scripted dice");
    return (v - 1) / 6 + 0.01;
  };
}

const NAMES = ["Ana", "Bob", "Cip", "Dan", "Eva", "Fil"];
function game(n = 4, settings: Partial<Settings> = {}): GameState {
  const s = { ...DEFAULT_SETTINGS, ...settings };
  return newGame(NAMES.slice(0, n).map((x) => `id-${x}`), NAMES.slice(0, n), s, T0, mulberry32(1));
}

/** Test setup only: change a state in place on a copy. */
function tweak(g: GameState, fn: (g: GameState) => void): GameState {
  const c = structuredClone(g);
  fn(c);
  return c;
}

/** Every rule that must hold after any move; returns the first one broken (fast enough for long simulations). */
function invariantProblem(g: GameState): string | null {
  const n = g.seats.length;
  if (moneyInPlay(g) !== g.settings.startMoney * n + g.bank) return `money: ${moneyInPlay(g)} != ${g.settings.startMoney * n} + ${g.bank}`;
  if (g.cash.some((c) => c < 0 || !Number.isInteger(c))) return `negative or fractional cash ${g.cash.join(",")}`;
  if (g.pot < 0) return "negative pot";
  const houses = g.houses.reduce((a, h) => a + (h > 0 && h < 5 ? h : 0), 0);
  const hotels = g.houses.filter((h) => h === 5).length;
  if (g.housesLeft + houses !== HOUSE_SUPPLY || g.housesLeft < 0) return `houses ${g.housesLeft} + ${houses}`;
  if (g.hotelsLeft + hotels !== HOTEL_SUPPLY || g.hotelsLeft < 0) return `hotels ${g.hotelsLeft} + ${hotels}`;
  for (const s of PROPERTIES) {
    const o = g.owner[s];
    if (o !== null && g.bankrupt[o]) return `bankrupt seat ${o} owns ${s}`;
    if (g.mortgaged[s] && o === null) return `bank property ${s} mortgaged`;
    if (g.houses[s] > 0) {
      if (o === null) return `houses on bank property ${s}`;
      for (const t of GROUP_SQUARES[BOARD[s].group!]) {
        if (g.owner[t] !== o) return `houses on ${s} without the whole group`;
        if (g.mortgaged[t]) return `houses on ${s} with ${t} mortgaged`;
      }
    }
  }
  for (const s of BOARD) if (!PROPERTIES.includes(s.index) && g.owner[s.index] !== null) return `square ${s.index} owned`;
  // Every card is either in its deck or held by a player.
  const held = g.jailCards.flat();
  if (g.decks.noroc.length + held.filter((d) => d === "noroc").length !== 16) return "noroc deck";
  if (g.decks.destin.length + held.filter((d) => d === "destin").length !== 16) return "destin deck";
  if (g.phase !== "over") {
    const a = actorOf(g);
    if (a === null || g.bankrupt[a]) return `actor ${a}`;
    if ((g.phase === "roll" || g.phase === "buy" || g.phase === "done") && g.bankrupt[g.turn]) return "bankrupt turn";
    if (g.phase === "debt" && g.debts.length === 0) return "debt phase without debts";
    if (g.phase === "auction" && !g.auction) return "auction phase without auction";
    if (g.phase === "buy" && g.buySquare === null) return "buy phase without a square";
    if (aliveSeats(g) < 2) return "game should be over";
  } else {
    if (g.winner === null) return "no winner";
    const places = g.place.filter((p) => p !== null);
    if (new Set(places).size !== n || places.length !== n) return `places ${g.place.join(",")}`;
    if (g.place[g.winner] !== 1) return "winner not first";
  }
  return null;
}

const aliveSeats = (g: GameState) => g.bankrupt.filter((b) => !b).length;

function checkInvariants(g: GameState) {
  expect(invariantProblem(g)).toBeNull();
}

describe("settings", () => {
  it("accepts the defaults", () => expect(settingsError(DEFAULT_SETTINGS)).toBeNull());
  it("checks the starting money range and step", () => {
    expect(settingsError({ ...DEFAULT_SETTINGS, startMoney: 400 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, startMoney: 10_100 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, startMoney: 1550 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, startMoney: 500 })).toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, startMoney: 10_000 })).toBeNull();
  });
  it("checks the turn timer, end mode and minutes", () => {
    expect(settingsError({ ...DEFAULT_SETTINGS, turnSeconds: 20 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, endMode: "x" as never })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, minutes: 20 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, minutes: 100 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, endMode: "time", minutes: 180 })).toBeNull();
  });
});

describe("board", () => {
  it("has 40 squares, 22 streets in 8 groups, 4 stations, 2 utilities", () => {
    expect(BOARD).toHaveLength(40);
    expect(BOARD.filter((s) => s.kind === "street")).toHaveLength(22);
    expect(GROUP_SQUARES).toHaveLength(8);
    expect(BOARD.filter((s) => s.kind === "station")).toHaveLength(4);
    expect(BOARD.filter((s) => s.kind === "utility")).toHaveLength(2);
    expect(BOARD.filter((s) => s.kind === "noroc")).toHaveLength(3);
    expect(BOARD.filter((s) => s.kind === "destin")).toHaveLength(3);
    for (const s of BOARD.filter((x) => x.kind === "street")) expect(s.rents).toHaveLength(6);
  });
});

describe("newGame", () => {
  it("gives everyone the starting money and starts with the first seat", () => {
    const g = game(5, { startMoney: 2500 });
    expect(g.cash).toEqual([2500, 2500, 2500, 2500, 2500]);
    expect(g.turn).toBe(0);
    expect(g.phase).toBe("roll");
    expect(g.decks.noroc).toHaveLength(16);
    expect(g.endsAt).toBeNull();
    expect(game(4, { endMode: "time", minutes: 45 }).endsAt).toBe(T0 + 45 * 60_000);
    checkInvariants(g);
  });
});

describe("parseAction", () => {
  it("accepts known actions and rejects the rest", () => {
    expect(parseAction({ kind: "roll" })).toEqual({ kind: "roll" });
    expect(parseAction({ kind: "build", square: 3 })).toEqual({ kind: "build", square: 3 });
    expect(parseAction({ kind: "bid", amount: 40 })).toEqual({ kind: "bid", amount: 40 });
    expect(() => parseAction({ kind: "fly" })).toThrow(RuleError);
    expect(() => parseAction({ kind: "build", square: 40 })).toThrow(RuleError);
    expect(() => parseAction({ kind: "bid", amount: 1.5 })).toThrow(RuleError);
    expect(() => parseAction(null)).toThrow(RuleError);
  });
});

describe("moving, buying and rent", () => {
  it("buys the street it lands on, the next player pays rent", () => {
    let g = game();
    g = act(g, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.pos[0]).toBe(3);
    expect(g.phase).toBe("buy");
    expect(() => act(g, 1, { kind: "buy" }, T0)).toThrow(RuleError);
    g = act(g, 0, { kind: "buy" }, T0);
    expect(g.owner[3]).toBe(0);
    expect(g.cash[0]).toBe(1440);
    expect(g.phase).toBe("done");
    g = act(g, 0, { kind: "end" }, T0);
    expect(g.turn).toBe(1);
    g = act(g, 1, { kind: "roll" }, T0, dice(2, 1));
    expect(g.cash[1]).toBe(1496);
    expect(g.cash[0]).toBe(1444);
    checkInvariants(g);
  });

  it("doubles the base rent for a full group and uses the house rents", () => {
    const base = tweak(game(), (g) => {
      g.owner[1] = 1;
      g.owner[3] = 1;
    });
    const g = act(base, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.cash[0]).toBe(1500 - 8);
    const built = tweak(base, (g) => {
      g.houses[3] = 3;
      g.houses[1] = 3;
      g.housesLeft -= 6;
    });
    const h = act(built, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(h.cash[0]).toBe(1500 - 180);
    checkInvariants(h);
  });

  it("charges station rent by the number of stations", () => {
    const base = tweak(game(), (g) => {
      g.owner[5] = 2;
      g.owner[15] = 2;
      g.owner[25] = 2;
    });
    const g = act(base, 0, { kind: "roll" }, T0, dice(1, 4));
    expect(g.cash[0]).toBe(1500 - 100);
  });

  it("charges utility rent as a multiple of the dice", () => {
    const base = tweak(game(), (g) => {
      g.pos[0] = 6;
      g.owner[12] = 1;
    });
    let g = act(base, 0, { kind: "roll" }, T0, dice(2, 4));
    expect(g.cash[0]).toBe(1500 - 24);
    g = act(
      tweak(base, (x) => (x.owner[28] = 1)),
      0,
      { kind: "roll" },
      T0,
      dice(2, 4),
    );
    expect(g.cash[0]).toBe(1500 - 60);
  });

  it("pays no rent on a mortgaged property", () => {
    const base = tweak(game(), (g) => {
      g.owner[3] = 1;
      g.mortgaged[3] = true;
    });
    const g = act(base, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.cash[0]).toBe(1500);
  });

  it("pays the salary when passing Start", () => {
    const base = tweak(game(), (g) => (g.pos[0] = 38));
    const g = act(base, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.pos[0]).toBe(1);
    expect(g.cash[0]).toBe(1700);
    checkInvariants(g);
  });

  it("sends taxes to the Parking pot and pays the pot out", () => {
    let g = act(game(), 0, { kind: "roll" }, T0, dice(1, 3));
    expect(g.pot).toBe(200);
    expect(g.cash[0]).toBe(1300);
    g = tweak(act(g, 0, { kind: "end" }, T0), (x) => (x.pos[1] = 15));
    g = act(g, 1, { kind: "roll" }, T0, dice(1, 4));
    expect(g.pos[1]).toBe(20);
    expect(g.cash[1]).toBe(1700);
    expect(g.pot).toBe(0);
    checkInvariants(g);
  });
});

describe("declining a purchase", () => {
  it("without auctions the property stays with the bank", () => {
    let g = game(4, { auctions: false });
    g = act(g, 0, { kind: "roll" }, T0, dice(1, 2));
    g = act(g, 0, { kind: "decline" }, T0);
    expect(g.owner[3]).toBeNull();
    expect(g.auction).toBeNull();
    expect(g.phase).toBe("done");
  });

  it("with auctions everyone bids, the last bidder standing buys it", () => {
    let g = game(4);
    g = act(g, 0, { kind: "roll" }, T0, dice(1, 2));
    g = act(g, 0, { kind: "decline" }, T0);
    expect(g.phase).toBe("auction");
    expect(actorOf(g)).toBe(1);
    expect(minBid(g)).toBe(1);
    expect(() => act(g, 1, { kind: "bid", amount: 0 }, T0)).toThrow(RuleError);
    g = act(g, 1, { kind: "bid", amount: 10 }, T0);
    expect(actorOf(g)).toBe(2);
    expect(minBid(g)).toBe(11);
    g = act(g, 2, { kind: "pass" }, T0);
    g = act(g, 3, { kind: "bid", amount: 30 }, T0);
    g = act(g, 0, { kind: "pass" }, T0);
    expect(actorOf(g)).toBe(1);
    g = act(g, 1, { kind: "pass" }, T0);
    expect(g.owner[3]).toBe(3);
    expect(g.cash[3]).toBe(1470);
    expect(g.auction).toBeNull();
    expect(g.phase).toBe("done");
    expect(g.turn).toBe(0);
    checkInvariants(g);
  });

  it("nobody bids: it stays with the bank", () => {
    let g = act(game(4), 0, { kind: "roll" }, T0, dice(1, 2));
    g = act(g, 0, { kind: "decline" }, T0);
    for (const s of [1, 2, 3, 0]) g = act(g, s, { kind: "pass" }, T0);
    expect(g.owner[3]).toBeNull();
    expect(g.phase).toBe("done");
  });
});

describe("doubles and jail", () => {
  it("rolls again on doubles; the third double goes to jail", () => {
    let g = game();
    g = act(g, 0, { kind: "roll" }, T0, dice(2, 2));
    expect(g.pos[0]).toBe(4);
    expect(g.phase).toBe("roll");
    g = act(g, 0, { kind: "roll" }, T0, dice(3, 3));
    expect(g.pos[0]).toBe(10);
    expect(g.inJail[0]).toBe(false);
    expect(g.phase).toBe("roll");
    g = act(g, 0, { kind: "roll" }, T0, dice(4, 4));
    expect(g.pos[0]).toBe(10);
    expect(g.inJail[0]).toBe(true);
    expect(g.phase).toBe("done");
    checkInvariants(g);
  });

  it("the Go-to-jail square sends you to jail and ends the doubles", () => {
    const g = act(
      tweak(game(), (x) => (x.pos[0] = 26)),
      0,
      { kind: "roll" },
      T0,
      dice(2, 2),
    );
    expect(g.inJail[0]).toBe(true);
    expect(g.pos[0]).toBe(10);
    expect(g.phase).toBe("done");
  });

  it("in jail: a failed roll stays, the third failure pays the fine and moves", () => {
    const jailed = tweak(game(), (x) => {
      x.pos[0] = 10;
      x.inJail[0] = true;
    });
    let g = act(jailed, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.inJail[0]).toBe(true);
    expect(g.jailTries[0]).toBe(1);
    expect(g.phase).toBe("done");
    g = act(
      tweak(jailed, (x) => (x.jailTries[0] = 2)),
      0,
      { kind: "roll" },
      T0,
      dice(1, 2),
    );
    expect(g.inJail[0]).toBe(false);
    expect(g.cash[0]).toBe(1450);
    expect(g.pot).toBe(50);
    expect(g.pos[0]).toBe(13);
    expect(g.phase).toBe("buy");
    checkInvariants(g);
  });

  it("a double gets you out (no extra roll); paying or a card get you out before rolling", () => {
    const jailed = tweak(game(), (x) => {
      x.pos[0] = 10;
      x.inJail[0] = true;
    });
    const out = act(jailed, 0, { kind: "roll" }, T0, dice(3, 3));
    expect(out.inJail[0]).toBe(false);
    expect(out.pos[0]).toBe(16);
    expect(out.again).toBe(false);
    const paid = act(jailed, 0, { kind: "payJail" }, T0);
    expect(paid.inJail[0]).toBe(false);
    expect(paid.pot).toBe(50);
    expect(paid.phase).toBe("roll");
    expect(() => act(jailed, 0, { kind: "useCard" }, T0)).toThrow(RuleError);
    const withCard = tweak(jailed, (x) => {
      x.jailCards[0] = ["noroc"];
      x.decks.noroc = x.decks.noroc.filter((i) => i !== 7);
    });
    const used = act(withCard, 0, { kind: "useCard" }, T0);
    expect(used.inJail[0]).toBe(false);
    expect(used.decks.noroc).toContain(7);
    checkInvariants(used);
  });
});

describe("building, mortgages", () => {
  const owned = tweak(game(), (g) => {
    g.owner[1] = 0;
    g.owner[3] = 0;
    g.owner[6] = 0;
  });

  it("needs the whole group and builds evenly", () => {
    expect(buildProblem(owned, 0, 6)).not.toBeNull();
    let g = act(owned, 0, { kind: "build", square: 1 }, T0);
    expect(g.houses[1]).toBe(1);
    expect(g.cash[0]).toBe(1500 - houseCost(1));
    expect(g.housesLeft).toBe(HOUSE_SUPPLY - 1);
    expect(() => act(g, 0, { kind: "build", square: 1 }, T0)).toThrow(RuleError);
    g = act(g, 0, { kind: "build", square: 3 }, T0);
    expect(() => act(g, 1, { kind: "build", square: 3 }, T0)).toThrow(RuleError);
    checkInvariants(g);
  });

  it("builds a hotel after 4 houses and gives the houses back; sells evenly at half", () => {
    let g = tweak(owned, (x) => {
      x.houses[1] = 4;
      x.houses[3] = 4;
      x.housesLeft -= 8;
    });
    g = act(g, 0, { kind: "build", square: 1 }, T0);
    expect(g.houses[1]).toBe(5);
    expect(g.hotelsLeft).toBe(HOTEL_SUPPLY - 1);
    expect(g.housesLeft).toBe(HOUSE_SUPPLY - 4);
    expect(sellProblem(g, 0, 3)).not.toBeNull();
    const cash = g.cash[0];
    g = act(g, 0, { kind: "sell", square: 1 }, T0);
    expect(g.houses[1]).toBe(4);
    expect(g.cash[0]).toBe(cash + houseCost(1) / 2);
    checkInvariants(g);
  });

  it("cannot build without houses left in the bank", () => {
    const g = tweak(owned, (x) => (x.housesLeft = 0));
    expect(buildProblem(g, 0, 1)).toBe("Banca nu mai are case.");
  });

  it("mortgages for half the price and pays back 10% more; not with buildings in the group", () => {
    let g = act(owned, 0, { kind: "mortgage", square: 6 }, T0);
    expect(g.mortgaged[6]).toBe(true);
    expect(g.cash[0]).toBe(1500 + mortgageValue(6));
    expect(buildProblem(g, 0, 1)).toBeNull();
    g = act(g, 0, { kind: "unmortgage", square: 6 }, T0);
    expect(g.cash[0]).toBe(1500 + mortgageValue(6) - unmortgageCost(6));
    expect(unmortgageCost(6)).toBe(55);
    const built = act(owned, 0, { kind: "build", square: 1 }, T0);
    expect(mortgageProblem(built, 0, 3)).not.toBeNull();
    const mortgaged = act(owned, 0, { kind: "mortgage", square: 3 }, T0);
    expect(buildProblem(mortgaged, 0, 1)).not.toBeNull();
    expect(unmortgageProblem(mortgaged, 1, 3)).not.toBeNull();
    checkInvariants(mortgaged);
  });
});

describe("trades", () => {
  const base = tweak(game(), (g) => {
    g.owner[1] = 0;
    g.owner[3] = 1;
  });

  it("proposes, the other player accepts: properties and money change hands", () => {
    let g = act(base, 0, { kind: "propose", to: 1, give: { squares: [], cash: 100, cards: 0 }, get: { squares: [3], cash: 0, cards: 0 } }, T0);
    expect(actorOf(g)).toBe(1);
    expect(() => act(g, 0, { kind: "roll" }, T0, dice(1, 2))).toThrow(RuleError);
    g = act(g, 1, { kind: "accept" }, T0);
    expect(g.owner[3]).toBe(0);
    expect(g.cash[0]).toBe(1400);
    expect(g.cash[1]).toBe(1600);
    expect(g.trade).toBeNull();
    expect(actorOf(g)).toBe(0);
    checkInvariants(g);
  });

  it("can be rejected or cancelled, and never moves built groups or missing money", () => {
    const offer: Action = { kind: "propose", to: 1, give: { squares: [1], cash: 0, cards: 0 }, get: { squares: [], cash: 50, cards: 0 } };
    expect(act(act(base, 0, offer, T0), 1, { kind: "reject" }, T0).trade).toBeNull();
    expect(act(act(base, 0, offer, T0), 0, { kind: "cancel" }, T0).trade).toBeNull();
    expect(() => act(base, 0, { ...offer, give: { squares: [3], cash: 0, cards: 0 } } as Action, T0)).toThrow(RuleError);
    expect(() => act(base, 0, { ...offer, get: { squares: [], cash: 99_999, cards: 0 } } as Action, T0)).toThrow(RuleError);
    expect(() => act(base, 1, offer, T0)).toThrow(RuleError);
    const built = tweak(base, (g) => {
      g.owner[3] = 0;
      g.houses[3] = 1;
      g.housesLeft--;
    });
    expect(tradeable(built, 0, 1)).toBe(false);
  });

  it("times out as a rejection", () => {
    const g = act(base, 0, { kind: "propose", to: 2, give: { squares: [1], cash: 0, cards: 0 }, get: { squares: [], cash: 10, cards: 0 } }, T0);
    const f = forceAction(g, T0 + 61_000);
    expect(f.trade).toBeNull();
    expect(f.owner[1]).toBe(0);
    expect(actorOf(f)).toBe(0);
  });
});

describe("debts and bankruptcy", () => {
  const trap = tweak(game(), (g) => {
    g.pos[0] = 36;
    g.cash[0] = 100;
    g.bank -= 1400;
    g.owner[37] = 1;
    g.owner[39] = 1;
    g.houses[39] = 5;
    g.houses[37] = 4;
    g.housesLeft -= 4;
    g.hotelsLeft -= 1;
    g.owner[1] = 0;
  });

  it("a rent you cannot pay becomes a debt; you can raise money and pay", () => {
    let g = act(trap, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.phase).toBe("debt");
    expect(g.debts[0]).toMatchObject({ seat: 0, amount: 2000, to: 1 });
    expect(() => act(g, 0, { kind: "pay" }, T0)).toThrow(RuleError);
    g = act(g, 0, { kind: "mortgage", square: 1 }, T0);
    expect(g.cash[0]).toBe(130);
    g = tweak(g, (x) => {
      x.cash[0] += 2000;
      x.bank += 2000;
    });
    g = act(g, 0, { kind: "pay" }, T0);
    expect(g.phase).toBe("done");
    expect(g.cash[1]).toBe(3500);
    checkInvariants(g);
  });

  it("bankrupt to a player: they get the cash and the properties, mortgages stay", () => {
    let g = act(trap, 0, { kind: "roll" }, T0, dice(1, 2));
    g = act(g, 0, { kind: "mortgage", square: 1 }, T0);
    g = act(g, 0, { kind: "bankrupt" }, T0);
    expect(g.bankrupt[0]).toBe(true);
    expect(g.place[0]).toBe(4);
    expect(g.owner[1]).toBe(1);
    expect(g.mortgaged[1]).toBe(true);
    expect(g.cash[0]).toBe(0);
    // 1630 received, minus the 10% interest on the mortgaged square it inherits (30 -> 3).
    expect(g.cash[1]).toBe(1630 - Math.ceil(mortgageValue(1) / 10));
    expect(g.turn).toBe(1);
    expect(g.phase).toBe("roll");
    checkInvariants(g);
  });

  it("the timeout sells and mortgages for you, or declares the bankruptcy", () => {
    let g = act(trap, 0, { kind: "roll" }, T0, dice(1, 2));
    g = forceAction(g, T0 + 999_999);
    expect(g.bankrupt[0]).toBe(true);
    checkInvariants(g);
    const rich = tweak(trap, (x) => {
      x.owner[6] = 0;
      x.owner[8] = 0;
      x.owner[9] = 0;
      x.houses[6] = 4;
      x.houses[8] = 4;
      x.houses[9] = 4;
      x.housesLeft -= 12;
      x.cash[0] = 1900;
      x.bank += 1800;
    });
    g = act(rich, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.phase).toBe("debt");
    g = forceAction(g, T0 + 999_999);
    expect(g.bankrupt[0]).toBe(false);
    expect(g.debts).toHaveLength(0);
    checkInvariants(g);
  });

  it("bankrupt to the bank: properties go back to the bank and are auctioned", () => {
    const owner = tweak(game(), (g) => {
      g.owner[1] = 0;
      g.owner[3] = 0;
      g.mortgaged[3] = true;
    });
    let g = removeSeat(owner, 0, T0);
    expect(g.bankrupt[0]).toBe(true);
    expect(g.left[0]).toBe(true);
    expect(g.owner[1]).toBeNull();
    expect(g.mortgaged[3]).toBe(false);
    expect(g.phase).toBe("auction");
    expect(g.auction?.square).toBe(1);
    for (const s of [1, 2, 3]) g = act(g, s, { kind: "pass" }, T0);
    expect(g.auction?.square).toBe(3);
    for (const s of [1, 2, 3]) g = act(g, s, { kind: "pass" }, T0);
    expect(g.phase).toBe("roll");
    expect(g.turn).toBe(1);
    checkInvariants(g);
  });

  it("the last player left wins", () => {
    let g = game(4);
    g = removeSeat(g, 1, T0);
    g = removeSeat(g, 2, T0);
    expect(g.phase).not.toBe("over");
    g = removeSeat(g, 3, T0);
    expect(g.phase).toBe("over");
    expect(g.winner).toBe(0);
    expect(g.place).toEqual([1, 4, 3, 2]);
    checkInvariants(g);
  });
});

describe("turn timer", () => {
  it("restarts on a new decision and the timeout plays it", () => {
    let g = game(4, { turnSeconds: 30 });
    expect(turnDeadline(g)).toBe(T0 + 30_000);
    const key = turnKey(g);
    g = forceAction(g, T0 + 31_000, dice(1, 2));
    expect(turnKey(g)).not.toBe(key);
    expect(g.phase).toBe("buy");
    expect(turnDeadline(g)).toBe(T0 + 31_000 + 30_000);
    g = forceAction(g, T0 + 62_000);
    expect(g.phase).toBe("auction");
    for (let i = 0; i < 4; i++) g = forceAction(g, T0 + 100_000 + i);
    expect(g.owner[3]).toBeNull();
    expect(g.phase).toBe("done");
    g = forceAction(g, T0 + 200_000);
    expect(g.turn).toBe(1);
  });

  it("managing during a turn does not restart the timer", () => {
    const g = tweak(game(), (x) => (x.owner[6] = 0));
    const after = act(g, 0, { kind: "mortgage", square: 6 }, T0 + 5_000);
    expect(after.since).toBe(g.since);
  });
});

describe("time limit", () => {
  it("ends when the round comes back to the first seat after the limit; richest wins", () => {
    let g = tweak(game(4, { endMode: "time", minutes: 30 }), (x) => {
      x.owner[39] = 2;
    });
    const late = T0 + 31 * 60_000;
    for (let seat = 0; seat < 4; seat++) {
      g = act(g, seat, { kind: "roll" }, late, dice(1, 2, 1, 2));
      if (g.phase === "buy") g = act(g, seat, { kind: "decline" }, late);
      while (g.phase === "auction") g = act(g, actorOf(g)!, { kind: "pass" }, late);
      if (g.phase === "debt") g = act(g, seat, { kind: "pay" }, late);
      g = act(g, seat, { kind: "end" }, late);
      if (seat < 3) expect(g.phase).toBe("roll");
    }
    expect(g.phase).toBe("over");
    expect(g.endReason).toBe("time");
    expect(g.winner).toBe(2);
    expect(netWorth(g, 2)).toBeGreaterThan(netWorth(g, 0));
    checkInvariants(g);
  });
});

// ---------------------------------------------------------------------------
// Random full games
// ---------------------------------------------------------------------------
/** A simple bot: buys what it can, builds a lot, bids sometimes, makes trades that complete groups. */
function botMove(g: GameState, rnd: () => number): Action {
  const a = actorOf(g)!;
  if (g.trade) return rnd() < 0.6 ? { kind: "accept" } : { kind: "reject" };
  const buildable = PROPERTIES.filter((s) => buildProblem(g, a, s) === null);
  if ((g.phase === "roll" || g.phase === "done") && buildable.length > 0 && rnd() < 0.7) {
    return { kind: "build", square: buildable[Math.floor(rnd() * buildable.length)] };
  }
  const redeem = PROPERTIES.filter((s) => unmortgageProblem(g, a, s) === null && g.cash[a] > 600);
  if ((g.phase === "roll" || g.phase === "done") && redeem.length > 0 && rnd() < 0.3) return { kind: "unmortgage", square: redeem[0] };
  if ((g.phase === "roll" || g.phase === "done") && rnd() < 0.05) {
    // Ask for a property of someone else's that would complete one of my groups.
    for (const s of PROPERTIES) {
      const o = g.owner[s];
      if (o === null || o === a || !tradeable(g, o, s)) continue;
      const group = GROUP_SQUARES[BOARD[s].group ?? -1];
      if (!group || !group.every((t) => t === s || g.owner[t] === a)) continue;
      const cash = Math.min(g.cash[a], (BOARD[s].price ?? 0) * 2);
      return { kind: "propose", to: o, give: { squares: [], cash, cards: 0 }, get: { squares: [s], cash: 0, cards: 0 } };
    }
  }
  switch (g.phase) {
    case "roll":
      if (g.inJail[a] && g.cash[a] >= 50 && rnd() < 0.4) return { kind: "payJail" };
      if (g.inJail[a] && g.jailCards[a].length > 0 && rnd() < 0.5) return { kind: "useCard" };
      return { kind: "roll" };
    case "buy":
      return g.cash[a] >= (BOARD[g.buySquare!].price ?? 0) && rnd() < 0.85 ? { kind: "buy" } : { kind: "decline" };
    case "auction": {
      const min = minBid(g);
      if (g.cash[a] >= min && rnd() < 0.45) return { kind: "bid", amount: Math.floor(Math.min(g.cash[a], min + Math.floor(rnd() * 5) * 10) / 10) * 10 };
      return { kind: "pass" };
    }
    case "debt": {
      const d = g.debts[0];
      if (g.cash[a] >= d.amount) return { kind: "pay" };
      const sell = PROPERTIES.find((s) => sellProblem(g, a, s) === null);
      if (sell !== undefined) return { kind: "sell", square: sell };
      const mortgage = PROPERTIES.find((s) => mortgageProblem(g, a, s) === null);
      if (mortgage !== undefined) return { kind: "mortgage", square: mortgage };
      return { kind: "bankrupt" };
    }
    default:
      return { kind: "end" };
  }
}

function simulate(seed: number, n: number, settings: Partial<Settings>, maxSteps: number) {
  const rnd = mulberry32(seed);
  let now = T0;
  let g = newGame(
    NAMES.slice(0, n).map((x) => `id-${x}`),
    NAMES.slice(0, n),
    { ...DEFAULT_SETTINGS, ...settings },
    now,
    rnd,
  );
  let steps = 0;
  let leaves = 0;
  while (g.phase !== "over" && steps < maxSteps) {
    steps++;
    now += 20_000;
    const r = rnd();
    if (r < 0.03) {
      g = forceAction(g, now, rnd, "host");
    } else if (r < 0.0303 && leaves === 0) {
      leaves++;
      const alive = g.seats.map((_, i) => i).filter((i) => !g.bankrupt[i]);
      g = removeSeat(g, alive[Math.floor(rnd() * alive.length)], now);
    } else {
      const a = actorOf(g)!;
      try {
        g = act(g, a, botMove(g, rnd), now, rnd);
      } catch (err) {
        if (!(err instanceof RuleError)) throw err;
        g = forceAction(g, now, rnd);
      }
    }
    const problem = invariantProblem(g);
    if (problem) throw new Error(`step ${steps}: ${problem}`);
  }
  return { g, steps };
}

describe("random full games", () => {
  for (const auctions of [true, false]) {
    for (const n of [4, 5, 6]) {
      it(`time limit, ${n} players, auctions ${auctions ? "on" : "off"}: ends, money and buildings add up`, { timeout: 120_000 }, () => {
        const { g } = simulate(100 + n + (auctions ? 10 : 0), n, { auctions, endMode: "time", minutes: 60, startMoney: 1500 }, 20_000);
        expect(g.phase).toBe("over");
        checkInvariants(g);
      });
      it(`until bankruptcy, ${n} players, auctions ${auctions ? "on" : "off"}: ends, money and buildings add up`, { timeout: 120_000 }, () => {
        const { g } = simulate(200 + n + (auctions ? 10 : 0), n, { auctions, endMode: "bankrupt", startMoney: 500 }, 150_000);
        expect(g.phase).toBe("over");
        expect(g.endReason).toBe("bankrupt");
        expect(g.bankrupt.filter((b) => !b)).toHaveLength(1);
      });
    }
  }
});

describe("playtest round 1 fixes", () => {
  it("auction bids start at 1 leu and go up by at least 1 leu", () => {
    let g = act(game(), 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.phase).toBe("buy");
    g = act(g, 0, { kind: "decline" }, T0);
    const bidder = g.auction!.turn;
    const after = act(g, bidder, { kind: "bid", amount: 15 }, T0);
    expect(after.auction!.high).toBe(15);
    expect(minBid(after)).toBe(16);
    expect(() => act(after, actorOf(after)!, { kind: "bid", amount: 15 }, T0)).toThrow(RuleError);
  });

  it("trading a property you do not own says so", () => {
    const g = game();
    expect(tradeProblem(g, 0, 1, { squares: [1], cash: 0, cards: 0 }, { squares: [], cash: 0, cards: 0 })).toContain("nu e a lui");
    expect(tradeProblem(g, 0, 1, { squares: [], cash: -5, cards: 0 }, { squares: [], cash: 0, cards: 0 })).toContain("negative");
  });

  it("receiving a mortgaged property in a trade costs 10% interest", () => {
    const g0 = tweak(game(), (x) => {
      x.owner[3] = 1;
      x.mortgaged[3] = true;
    });
    let g = act(g0, 0, { kind: "propose", to: 1, give: { squares: [], cash: 10, cards: 0 }, get: { squares: [3], cash: 0, cards: 0 } }, T0);
    g = act(g, 1, { kind: "accept" }, T0);
    expect(g.owner[3]).toBe(0);
    expect(g.mortgaged[3]).toBe(true);
    expect(g.cash[0]).toBe(1500 - 10 - Math.ceil(mortgageValue(3) / 10));
    checkInvariants(g);
  });
});

describe("salary setting", () => {
  it("is validated: 0-2000 in steps of 50", () => {
    expect(settingsError({ ...DEFAULT_SETTINGS, salary: 0 })).toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, salary: 2000 })).toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, salary: 225 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, salary: 2050 })).not.toBeNull();
    expect(settingsError({ ...DEFAULT_SETTINGS, salary: -50 })).not.toBeNull();
  });

  it("pays the room's salary when passing Start", () => {
    const g0 = tweak(game(4, { salary: 500 }), (x) => {
      x.pos[0] = 38;
    });
    const g = act(g0, 0, { kind: "roll" }, T0, dice(1, 2));
    expect(g.pos[0]).toBe(1);
    expect(g.cash[0]).toBe(1500 + 500);
    checkInvariants(g);
  });

  it("games stored before the setting keep the classic 200", () => {
    const g = tweak(game(), (x) => {
      delete (x.settings as Partial<Settings>).salary;
    });
    expect(salaryOf(g)).toBe(200);
  });
});
