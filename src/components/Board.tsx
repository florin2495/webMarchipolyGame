"use client";

import { BOARD, GROUPS, type Square } from "@/lib/board";
import { money, PLAYER_COLORS } from "@/lib/marchipoly";
import type { PublicGame } from "@/lib/types";

// The board is one SVG, 100 × 100 units: 14-unit corners and 9 squares of 8 units per side.
// Square 0 (Start) is the bottom-right corner; play goes left along the bottom, up, right along the top, down.
const C = 14;
const W = 8;
const FAR = 100 - C;
const BAND = 3.2;

type Side = "corner" | "bottom" | "left" | "top" | "right";
interface Cell {
  x: number;
  y: number;
  w: number;
  h: number;
  side: Side;
}

export function cellOf(i: number): Cell {
  if (i === 0) return { x: FAR, y: FAR, w: C, h: C, side: "corner" };
  if (i < 10) return { x: FAR - i * W, y: FAR, w: W, h: C, side: "bottom" };
  if (i === 10) return { x: 0, y: FAR, w: C, h: C, side: "corner" };
  if (i < 20) return { x: 0, y: FAR - (i - 10) * W, w: C, h: W, side: "left" };
  if (i === 20) return { x: 0, y: 0, w: C, h: C, side: "corner" };
  if (i < 30) return { x: C + (i - 21) * W, y: 0, w: W, h: C, side: "top" };
  if (i === 30) return { x: FAR, y: 0, w: C, h: C, side: "corner" };
  return { x: FAR, y: C + (i - 31) * W, w: C, h: W, side: "right" };
}

/** The colored strip of a street, on the side facing the middle of the board. */
function bandOf(c: Cell): { x: number; y: number; w: number; h: number } {
  switch (c.side) {
    case "bottom":
      return { x: c.x, y: c.y, w: c.w, h: BAND };
    case "top":
      return { x: c.x, y: c.y + c.h - BAND, w: c.w, h: BAND };
    case "left":
      return { x: c.x + c.w - BAND, y: c.y, w: BAND, h: c.h };
    case "right":
      return { x: c.x, y: c.y, w: BAND, h: c.h };
    default:
      return { x: c.x, y: c.y, w: 0, h: 0 };
  }
}

/** The owner's strip, on the outer edge of the square. */
function ownerStrip(c: Cell): { x: number; y: number; w: number; h: number } {
  const t = 1.1;
  switch (c.side) {
    case "bottom":
      return { x: c.x, y: c.y + c.h - t, w: c.w, h: t };
    case "top":
      return { x: c.x, y: c.y, w: c.w, h: t };
    case "left":
      return { x: c.x, y: c.y, w: t, h: c.h };
    case "right":
      return { x: c.x + c.w - t, y: c.y, w: t, h: c.h };
    default:
      return { x: c.x, y: c.y, w: 0, h: 0 };
  }
}

function OwnerStrip({ c, color }: { c: Cell; color: string }) {
  const r = ownerStrip(c);
  return <rect x={r.x} y={r.y} width={r.w} height={r.h} fill={color} />;
}

const ICON: Partial<Record<Square["kind"], string>> = {
  start: "🏁",
  jail: "🔒",
  parking: "🅿️",
  gotojail: "👮",
  noroc: "🍀",
  destin: "🔮",
  tax: "💸",
  station: "🚂",
};

function iconOf(sq: Square): string | null {
  if (sq.kind === "utility") return sq.name.includes("apă") ? "💧" : "⚡";
  return ICON[sq.kind] ?? null;
}

const fontFor = (label: string, room: number) => Math.min(1.7, room / (label.length * 0.58));

/** Where a seat's token sits inside a square (up to 6 tokens, 3 × 2). */
export function tokenPoint(i: number, seat: number): { x: number; y: number } {
  const c = cellOf(i);
  const col = seat % 3;
  const row = Math.floor(seat / 3);
  const horizontal = c.side === "left" || c.side === "right";
  const cx = c.x + c.w / 2 + (horizontal ? (col - 1) * 3.4 : (row - 0.5) * 3.4);
  const cy = c.y + c.h / 2 + (horizontal ? (row - 0.5) * 3.4 : (col - 1) * 3.4) + (c.side === "corner" ? 2 : 0);
  return { x: cx, y: cy };
}

function Pips({ x, y, n }: { x: number; y: number; n: number }) {
  const s = 7;
  const spots: Record<number, [number, number][]> = {
    1: [[0.5, 0.5]],
    2: [[0.25, 0.25], [0.75, 0.75]],
    3: [[0.25, 0.25], [0.5, 0.5], [0.75, 0.75]],
    4: [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]],
    5: [[0.25, 0.25], [0.75, 0.25], [0.5, 0.5], [0.25, 0.75], [0.75, 0.75]],
    6: [[0.25, 0.22], [0.75, 0.22], [0.25, 0.5], [0.75, 0.5], [0.25, 0.78], [0.75, 0.78]],
  };
  return (
    <g>
      <rect x={x} y={y} width={s} height={s} rx={1.3} fill="#fff" stroke="#3f3f46" strokeWidth={0.3} />
      {(spots[n] ?? []).map(([px, py], k) => (
        <circle key={k} cx={x + px * s} cy={y + py * s} r={0.7} fill="#18181b" />
      ))}
    </g>
  );
}

export function Board({
  g,
  selected,
  onSelect,
  highlight,
}: {
  g: PublicGame;
  selected: number | null;
  onSelect: (square: number) => void;
  /** Seat whose square gets a ring (the one acting). */
  highlight: number | null;
}) {
  return (
    <svg
      viewBox="0 0 100 100"
      className="block aspect-square w-full select-none rounded-xl bg-emerald-50 shadow-sm ring-1 ring-zinc-300 dark:bg-zinc-900 dark:ring-zinc-700"
      role="group"
      aria-label="Tabla de joc"
      data-testid="board"
    >
      {BOARD.map((sq) => {
        const c = cellOf(sq.index);
        const owner = g.owner[sq.index];
        const band = sq.kind === "street" ? bandOf(c) : null;
        const icon = iconOf(sq);
        const h = g.houses[sq.index];
        const corner = c.side === "corner";
        const label = sq.short;
        // Text area: the part of the square that is not the color band.
        const inner =
          c.side === "bottom"
            ? { x: c.x, y: c.y + BAND, w: c.w, h: c.h - BAND }
            : c.side === "top"
              ? { x: c.x, y: c.y, w: c.w, h: c.h - BAND }
              : c.side === "left"
                ? { x: c.x, y: c.y, w: c.w - BAND, h: c.h }
                : c.side === "right"
                  ? { x: c.x + BAND, y: c.y, w: c.w - BAND, h: c.h }
                  : c;
        const vertical = c.side === "bottom" || c.side === "top";
        const fs = fontFor(label, inner.w - 0.8);
        return (
          <g
            key={sq.index}
            onClick={() => onSelect(sq.index)}
            className="cursor-pointer"
            role="button"
            aria-label={sq.name}
            data-testid={`square-${sq.index}`}
          >
            <rect
              x={c.x}
              y={c.y}
              width={c.w}
              height={c.h}
              fill={corner ? "#d1fae5" : "#f8fafc"}
              stroke="#71717a"
              strokeWidth={0.18}
            />
            {band && <rect x={band.x} y={band.y} width={band.w} height={band.h} fill={GROUPS[sq.group!].color} />}
            {owner !== null && <OwnerStrip c={c} color={PLAYER_COLORS[owner]} />}
            {icon && (
              <text
                x={inner.x + inner.w / 2}
                y={corner ? c.y + c.h / 2 - 1 : inner.y + inner.h / 2 - (vertical ? 1.6 : 0.4)}
                fontSize={corner ? 4.2 : 2.6}
                textAnchor="middle"
                dominantBaseline="central"
              >
                {icon}
              </text>
            )}
            <text
              x={inner.x + inner.w / 2}
              y={corner ? c.y + c.h - 3 : icon ? inner.y + inner.h / 2 + (vertical ? 1.8 : 2.4) : inner.y + inner.h / 2 - (vertical ? 1.2 : 0.5)}
              fontSize={corner ? 1.9 : fs}
              fontWeight={700}
              textAnchor="middle"
              dominantBaseline="central"
              fill="#18181b"
            >
              {label}
            </text>
            {sq.price !== undefined && !icon && (
              <text
                x={inner.x + inner.w / 2}
                y={inner.y + inner.h / 2 + (vertical ? 1.9 : 1.9)}
                fontSize={1.45}
                textAnchor="middle"
                dominantBaseline="central"
                fill="#52525b"
              >
                {sq.price}
              </text>
            )}
            {band && h > 0 && h < 5 &&
              Array.from({ length: h }, (_, k) => {
                const size = 1.5;
                const along = vertical ? band.x + 0.4 + k * 1.9 : band.y + 0.4 + k * 1.9;
                return vertical ? (
                  <rect key={k} x={along} y={band.y + 0.85} width={size} height={size} fill="#22c55e" stroke="#fff" strokeWidth={0.2} />
                ) : (
                  <rect key={k} x={band.x + 0.85} y={along} width={size} height={size} fill="#22c55e" stroke="#fff" strokeWidth={0.2} />
                );
              })}
            {band && h === 5 && (
              <rect
                x={band.x + (vertical ? band.w / 2 - 2.2 : 0.6)}
                y={band.y + (vertical ? 0.6 : band.h / 2 - 2.2)}
                width={vertical ? 4.4 : 2}
                height={vertical ? 2 : 4.4}
                rx={0.3}
                fill="#b91c1c"
                stroke="#fff"
                strokeWidth={0.25}
              />
            )}
            {g.mortgaged[sq.index] && (
              <>
                <rect x={c.x} y={c.y} width={c.w} height={c.h} fill="#18181b" opacity={0.45} />
                <text x={c.x + c.w / 2} y={c.y + c.h / 2} fontSize={1.6} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill="#fff">
                  IPOTECĂ
                </text>
              </>
            )}
            {selected === sq.index && (
              <rect x={c.x + 0.3} y={c.y + 0.3} width={c.w - 0.6} height={c.h - 0.6} fill="none" stroke="#4f46e5" strokeWidth={0.6} />
            )}
          </g>
        );
      })}

      {/* Middle of the board */}
      <g pointerEvents="none">
        <text x={50} y={33} fontSize={7} fontWeight={900} textAnchor="middle" fill="#4338ca" letterSpacing={-0.2}>
          Marchipoly
        </text>
        <text x={50} y={39} fontSize={2.6} textAnchor="middle" fill="#71717a">
          🎩 orașe, case și hoteluri
        </text>
        {g.dice && (
          <g key={g.moveNo} className="dice-roll">
            <Pips x={41} y={45} n={g.dice[0]} />
            <Pips x={52} y={45} n={g.dice[1]} />
          </g>
        )}
        <text x={50} y={62} fontSize={3} fontWeight={700} textAnchor="middle" fill="#0f766e" data-testid="pot">
          🅿️ Parcare: {money(g.pot)}
        </text>
        <text x={50} y={67} fontSize={2.2} textAnchor="middle" fill="#71717a">
          Case: {g.housesLeft} · Hoteluri: {g.hotelsLeft}
        </text>
      </g>

      {/* Tokens */}
      {g.seats.map((_, seat) => {
        if (g.bankrupt[seat]) return null;
        const p = tokenPoint(g.pos[seat], seat);
        const active = highlight === seat;
        return (
          <g
            key={seat}
            pointerEvents="none"
            style={{ transform: `translate(${p.x}px, ${p.y}px)`, transition: "transform 450ms ease-out" }}
          >
            {active && <circle r={2.6} fill="none" stroke="#facc15" strokeWidth={0.7} className="token-pulse" />}
            <circle r={1.8} fill={PLAYER_COLORS[seat]} stroke="#fff" strokeWidth={0.45} />
            <text fontSize={1.9} fontWeight={800} textAnchor="middle" dominantBaseline="central" fill="#fff">
              {(g.names[seat] ?? "?").slice(0, 1).toUpperCase()}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
