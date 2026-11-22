// The Marchipoly board: 40 squares, Romanian places, our own prices, rents and cards. Pure data, shared by
// server and client.

export type SquareKind = "start" | "street" | "station" | "utility" | "tax" | "noroc" | "destin" | "jail" | "parking" | "gotojail";

export interface Group {
  /** Region name shown on the property card. */
  name: string;
  color: string;
  /** Price of one house (a hotel costs one more house). */
  houseCost: number;
}

export const GROUPS: Group[] = [
  { name: "Moldova de jos", color: "#92400e", houseCost: 50 },
  { name: "Dunărea", color: "#0ea5e9", houseCost: 50 },
  { name: "Oltenia", color: "#db2777", houseCost: 100 },
  { name: "Ardealul de sud", color: "#ea580c", houseCost: 100 },
  { name: "Banat și Crișana", color: "#dc2626", houseCost: 150 },
  { name: "Moldova de sus", color: "#ca8a04", houseCost: 150 },
  { name: "Munte și mare", color: "#15803d", houseCost: 200 },
  { name: "București", color: "#4338ca", houseCost: 200 },
];

export interface Square {
  index: number;
  kind: SquareKind;
  /** Full name (property card, log). */
  name: string;
  /** Short label that fits on the board. */
  short: string;
  /** Streets: group index into GROUPS. */
  group?: number;
  /** Buy price (streets, stations, utilities). */
  price?: number;
  /** Streets: rent with 0, 1, 2, 3, 4 houses and with a hotel. */
  rents?: number[];
  /** Tax squares: the amount paid into the Parking pot. */
  tax?: number;
  /** Income tax: the player may pay this percent of their worth instead of `tax` (classic rule). */
  taxPercent?: number;
}

type Def = Omit<Square, "index">;
const street = (name: string, short: string, group: number, price: number, rents: number[]): Def => ({
  kind: "street",
  name,
  short,
  group,
  price,
  rents,
});

const DEFS: Def[] = [
  { kind: "start", name: "Start", short: "START" },
  street("Vaslui", "Vaslui", 0, 60, [2, 10, 30, 90, 160, 250]),
  { kind: "destin", name: "Destin", short: "Destin" },
  street("Bârlad", "Bârlad", 0, 60, [4, 20, 60, 180, 320, 450]),
  { kind: "tax", name: "Impozit pe venit", short: "Impozit", tax: 200, taxPercent: 10 },
  { kind: "station", name: "Gara de Nord", short: "Gara N.", price: 200 },
  street("Tulcea", "Tulcea", 1, 100, [6, 30, 90, 270, 400, 550]),
  { kind: "noroc", name: "Noroc", short: "Noroc" },
  street("Galați", "Galați", 1, 100, [6, 30, 90, 270, 400, 550]),
  street("Brăila", "Brăila", 1, 120, [8, 40, 100, 300, 450, 600]),
  { kind: "jail", name: "Închisoare", short: "Închis." },
  street("Pitești", "Pitești", 2, 140, [10, 50, 150, 450, 625, 750]),
  { kind: "utility", name: "Centrala electrică", short: "Centrală", price: 150 },
  street("Râmnicu Vâlcea", "Vâlcea", 2, 140, [10, 50, 150, 450, 625, 750]),
  street("Craiova", "Craiova", 2, 160, [12, 60, 180, 500, 700, 900]),
  { kind: "station", name: "Gara Brașov", short: "Gara B.", price: 200 },
  street("Alba Iulia", "Alba", 3, 180, [14, 70, 200, 550, 750, 950]),
  { kind: "destin", name: "Destin", short: "Destin" },
  street("Sibiu", "Sibiu", 3, 180, [14, 70, 200, 550, 750, 950]),
  street("Brașov", "Brașov", 3, 200, [16, 80, 220, 600, 800, 1000]),
  { kind: "parking", name: "Parcare", short: "Parcare" },
  street("Arad", "Arad", 4, 220, [18, 90, 250, 700, 875, 1050]),
  { kind: "noroc", name: "Noroc", short: "Noroc" },
  street("Oradea", "Oradea", 4, 220, [18, 90, 250, 700, 875, 1050]),
  street("Timișoara", "Timiș.", 4, 240, [20, 100, 300, 750, 925, 1100]),
  { kind: "station", name: "Gara Cluj", short: "Gara C.", price: 200 },
  street("Bacău", "Bacău", 5, 260, [22, 110, 330, 800, 975, 1150]),
  street("Suceava", "Suceava", 5, 260, [22, 110, 330, 800, 975, 1150]),
  { kind: "utility", name: "Uzina de apă", short: "Uzina apă", price: 150 },
  street("Iași", "Iași", 5, 280, [24, 120, 360, 850, 1025, 1200]),
  { kind: "gotojail", name: "Mergi la închisoare", short: "La închis." },
  street("Sinaia", "Sinaia", 6, 300, [26, 130, 390, 900, 1100, 1275]),
  street("Mamaia", "Mamaia", 6, 300, [26, 130, 390, 900, 1100, 1275]),
  { kind: "destin", name: "Destin", short: "Destin" },
  street("Cluj-Napoca", "Cluj", 6, 320, [28, 150, 450, 1000, 1200, 1400]),
  { kind: "station", name: "Gara Iași", short: "Gara I.", price: 200 },
  { kind: "noroc", name: "Noroc", short: "Noroc" },
  street("Floreasca", "Floreasca", 7, 350, [35, 175, 500, 1100, 1300, 1500]),
  { kind: "tax", name: "Taxă de lux", short: "Lux", tax: 100 },
  street("Primăverii", "Primăv.", 7, 400, [50, 200, 600, 1400, 1700, 2000]),
];

export const BOARD: Square[] = DEFS.map((d, index) => ({ ...d, index }));
export const BOARD_SIZE = BOARD.length;

export const START = 0;
export const JAIL = 10;
export const PARKING = 20;
export const GO_TO_JAIL = 30;

export const SALARY = 200;
export const JAIL_FINE = 50;
export const STATION_RENTS = [25, 50, 100, 200];
export const UTILITY_MULTIPLIERS = [4, 10];
export const HOUSE_SUPPLY = 32;
export const HOTEL_SUPPLY = 12;

export const isProperty = (i: number) => {
  const k = BOARD[i]?.kind;
  return k === "street" || k === "station" || k === "utility";
};
export const PROPERTIES = BOARD.filter((s) => isProperty(s.index)).map((s) => s.index);
export const STATIONS = BOARD.filter((s) => s.kind === "station").map((s) => s.index);
export const UTILITIES = BOARD.filter((s) => s.kind === "utility").map((s) => s.index);
export const GROUP_SQUARES: number[][] = GROUPS.map((_, g) => BOARD.filter((s) => s.group === g).map((s) => s.index));

/** Squares that belong together for monopolies / mortgaging rules: a street's color group, or itself. */
export function groupOf(i: number): number[] {
  const g = BOARD[i].group;
  return g === undefined ? [i] : GROUP_SQUARES[g];
}

export function houseCost(i: number): number {
  const g = BOARD[i].group;
  return g === undefined ? 0 : GROUPS[g].houseCost;
}

export function mortgageValue(i: number): number {
  return Math.floor((BOARD[i].price ?? 0) / 2);
}

/** Paying the mortgage back costs its value plus 10%, rounded up. */
export function unmortgageCost(i: number): number {
  // Integer math: 50 * 1.1 is 55.00000000000001 in floating point, which ceil() would turn into 56.
  return Math.ceil((mortgageValue(i) * 11) / 10);
}

// ---------------------------------------------------------------------------
// Cards
// ---------------------------------------------------------------------------
export type Deck = "noroc" | "destin";

export type CardEffect =
  | { kind: "goto"; to: number }
  | { kind: "nearest"; what: "station" | "utility" }
  | { kind: "back"; steps: number }
  | { kind: "jail" }
  | { kind: "jailfree" }
  /** Positive: the bank pays you. Negative: you pay into the Parking pot. */
  | { kind: "money"; amount: number }
  /** Positive: every other player pays you. Negative: you pay every other player. */
  | { kind: "each"; amount: number }
  /** You pay per house and per hotel into the Parking pot. */
  | { kind: "repairs"; house: number; hotel: number };

export interface CardDef {
  text: string;
  effect: CardEffect;
}

export const CARDS: Record<Deck, CardDef[]> = {
  noroc: [
    { text: "Mergi la Start și încasezi salariul.", effect: { kind: "goto", to: 0 } },
    { text: "Ai un drum la Timișoara. Dacă treci pe la Start, încasezi salariul.", effect: { kind: "goto", to: 24 } },
    { text: "Ai o ședință la Pitești. Dacă treci pe la Start, încasezi salariul.", effect: { kind: "goto", to: 11 } },
    { text: "Prinzi trenul: mergi la cea mai apropiată gară. Dacă are proprietar, îi plătești dublul chiriei.", effect: { kind: "nearest", what: "station" } },
    { text: "Ai bilet la primul tren: mergi la cea mai apropiată gară. Dacă are proprietar, îi plătești dublul chiriei.", effect: { kind: "nearest", what: "station" } },
    { text: "Control la contor: mergi la cea mai apropiată uzină. Dacă are proprietar, îi plătești de 10 ori zarurile.", effect: { kind: "nearest", what: "utility" } },
    { text: "Banca îți plătește dobânda la depozit: încasezi 50.", effect: { kind: "money", amount: 50 } },
    { text: "Avocatul tău te scoate din închisoare. Păstrezi cartea până ai nevoie de ea.", effect: { kind: "jailfree" } },
    { text: "Ai uitat cheile acasă: mergi înapoi 3 pătrate.", effect: { kind: "back", steps: 3 } },
    { text: "Ai fost prins cu acte false: mergi direct la închisoare, fără să treci pe la Start.", effect: { kind: "jail" } },
    { text: "Renovezi fațadele: plătești 25 pe fiecare casă și 100 pe fiecare hotel.", effect: { kind: "repairs", house: 25, hotel: 100 } },
    { text: "Radarul te-a prins pe DN1: amendă de 15.", effect: { kind: "money", amount: -15 } },
    { text: "Pleci cu trenul de la Gara de Nord. Dacă treci pe la Start, încasezi salariul.", effect: { kind: "goto", to: 5 } },
    { text: "Ești invitat la o cină pe Primăverii.", effect: { kind: "goto", to: 39 } },
    { text: "Ai fost ales administratorul blocului: plătești fiecărui jucător 50.", effect: { kind: "each", amount: -50 } },
    { text: "Ți s-a returnat garanția de la chirie: încasezi 150.", effect: { kind: "money", amount: 150 } },
  ],
  destin: [
    { text: "Mergi la Start și încasezi salariul.", effect: { kind: "goto", to: 0 } },
    { text: "Banca a greșit un calcul în favoarea ta: încasezi 200.", effect: { kind: "money", amount: 200 } },
    { text: "Plombă la dentist: plătești 50.", effect: { kind: "money", amount: -50 } },
    { text: "Ai vândut niște acțiuni: încasezi 50.", effect: { kind: "money", amount: 50 } },
    { text: "Un prieten îți ține locul: ieși gratis din închisoare. Păstrezi cartea până ai nevoie de ea.", effect: { kind: "jailfree" } },
    { text: "Ai uitat să plătești parcarea de o lună: mergi direct la închisoare, fără să treci pe la Start.", effect: { kind: "jail" } },
    { text: "Ți-a ieșit prima de Crăciun: încasezi 100.", effect: { kind: "money", amount: 100 } },
    { text: "ANAF îți returnează impozitul: încasezi 20.", effect: { kind: "money", amount: 20 } },
    { text: "E ziua ta! Fiecare jucător îți dă 10.", effect: { kind: "each", amount: 10 } },
    { text: "Ți-a ajuns la scadență polița de asigurare: încasezi 100.", effect: { kind: "money", amount: 100 } },
    { text: "Ai stat o noapte la urgențe: plătești 100.", effect: { kind: "money", amount: -100 } },
    { text: "Plătești taxa la after-school: 50.", effect: { kind: "money", amount: -50 } },
    { text: "Ai dat o consultanță: încasezi 25.", effect: { kind: "money", amount: 25 } },
    { text: "Primăria cere reparații la trotuare: plătești 40 pe fiecare casă și 115 pe fiecare hotel.", effect: { kind: "repairs", house: 40, hotel: 115 } },
    { text: "Ai câștigat la tombola de la serbare: încasezi 10.", effect: { kind: "money", amount: 10 } },
    { text: "O mătușă din Viena ți-a lăsat o moștenire: încasezi 100.", effect: { kind: "money", amount: 100 } },
  ],
};

export const DECK_NAME: Record<Deck, string> = { noroc: "Noroc", destin: "Destin" };
