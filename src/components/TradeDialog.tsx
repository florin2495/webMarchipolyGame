"use client";

import { useState } from "react";
import { BOARD, GROUPS, PROPERTIES } from "@/lib/board";
import { type Action, money, PLAYER_COLORS, tradeable, tradeProblem, type TradeSide } from "@/lib/marchipoly";
import type { PublicGame } from "@/lib/types";
import { Modal } from "./PropertyDialog";
import { Button, ErrorText } from "./ui";

const input =
  "min-h-10 w-full rounded-lg border border-zinc-300 bg-white px-2 text-base text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

function toInt(text: string): number {
  if (text.trim() === "") return 0;
  const n = Number(text);
  return Number.isInteger(n) ? n : NaN;
}

/** Compose a trade offer: what I give and what I ask from one other player. */
export function TradeDialog({
  g,
  seat,
  busy,
  onClose,
  onPropose,
}: {
  g: PublicGame;
  seat: number;
  busy: boolean;
  onClose: () => void;
  onPropose: (a: Action) => void;
}) {
  const others = g.seats.map((_, s) => s).filter((s) => s !== seat && !g.bankrupt[s]);
  const [to, setTo] = useState<number>(others[0] ?? -1);
  const [give, setGive] = useState<number[]>([]);
  const [get, setGet] = useState<number[]>([]);
  const [giveCash, setGiveCash] = useState("");
  const [getCash, setGetCash] = useState("");
  const [giveCards, setGiveCards] = useState(0);
  const [getCards, setGetCards] = useState(0);

  const mySide: TradeSide = { squares: give, cash: toInt(giveCash), cards: giveCards };
  const theirSide: TradeSide = { squares: get.filter((s) => g.owner[s] === to), cash: toInt(getCash), cards: Math.min(getCards, to >= 0 ? g.jailCards[to].length : 0) };
  const bad = Number.isNaN(mySide.cash) || Number.isNaN(theirSide.cash) ? "Suma trebuie să fie un număr întreg." : null;
  const problem = to < 0 ? "Nu are cine să facă schimb cu tine." : (bad ?? tradeProblem(g, seat, to, mySide, theirSide));

  const toggle = (list: number[], set: (v: number[]) => void, s: number) => set(list.includes(s) ? list.filter((x) => x !== s) : [...list, s]);

  const column = (owner: number, chosen: number[], set: (v: number[]) => void, testId: string) => {
    const props = PROPERTIES.filter((s) => g.owner[s] === owner);
    if (props.length === 0) return <p className="text-xs text-zinc-500">Nicio proprietate.</p>;
    return (
      <ul className="flex flex-col gap-1" data-testid={testId}>
        {props.map((s) => {
          const sq = BOARD[s];
          const ok = tradeable(g, owner, s);
          return (
            <li key={s}>
              <label className={`flex min-h-9 items-center gap-2 text-xs ${ok ? "cursor-pointer" : "opacity-40"}`}>
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-indigo-600"
                  checked={chosen.includes(s)}
                  disabled={!ok}
                  onChange={() => toggle(chosen, set, s)}
                />
                <span className="h-3 w-1.5 shrink-0 rounded-sm" style={{ background: sq.group !== undefined ? GROUPS[sq.group].color : "#52525b" }} />
                <span className="truncate">
                  {sq.name}
                  {g.mortgaged[s] ? " (ipotecată)" : ""}
                </span>
              </label>
            </li>
          );
        })}
      </ul>
    );
  };

  return (
    <Modal title="Propune un schimb" onClose={onClose} testId="trade-dialog">
      <h2 className="mb-3 text-lg font-black">🤝 Propune un schimb</h2>
      <label className="mb-3 flex flex-col gap-1 text-sm font-medium">
        Cu cine
        <select
          className={input}
          value={to}
          onChange={(e) => {
            setTo(Number(e.target.value));
            setGet([]);
            setGetCards(0);
          }}
          data-testid="trade-to"
        >
          {others.map((s) => (
            <option key={s} value={s}>
              {g.names[s]} ({money(g.cash[s])})
            </option>
          ))}
        </select>
      </label>

      <div className="grid grid-cols-2 gap-3">
        <section className="min-w-0">
          <h3 className="mb-1 flex items-center gap-1 text-sm font-bold">
            <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAYER_COLORS[seat] }} />
            Dai
          </h3>
          {column(seat, give, setGive, "trade-give")}
          <label className="mt-2 flex flex-col gap-1 text-xs font-medium">
            Bani (ai {money(g.cash[seat])})
            <input className={input} type="number" inputMode="numeric" min={0} value={giveCash} onChange={(e) => setGiveCash(e.target.value)} data-testid="trade-give-cash" />
          </label>
          {g.jailCards[seat].length > 0 && (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" className="h-4 w-4" checked={giveCards > 0} onChange={(e) => setGiveCards(e.target.checked ? 1 : 0)} />
              🎫 o carte de ieșire din închisoare
            </label>
          )}
        </section>
        <section className="min-w-0">
          <h3 className="mb-1 flex items-center gap-1 text-sm font-bold">
            {to >= 0 && <span className="h-2.5 w-2.5 rounded-full" style={{ background: PLAYER_COLORS[to] }} />}
            Ceri
          </h3>
          {to >= 0 && column(to, get, setGet, "trade-get")}
          <label className="mt-2 flex flex-col gap-1 text-xs font-medium">
            Bani
            <input className={input} type="number" inputMode="numeric" min={0} value={getCash} onChange={(e) => setGetCash(e.target.value)} data-testid="trade-get-cash" />
          </label>
          {to >= 0 && g.jailCards[to].length > 0 && (
            <label className="mt-2 flex items-center gap-2 text-xs">
              <input type="checkbox" className="h-4 w-4" checked={getCards > 0} onChange={(e) => setGetCards(e.target.checked ? 1 : 0)} />
              🎫 o carte de ieșire din închisoare
            </label>
          )}
        </section>
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Se pot schimba doar proprietăți fără clădiri în regiunea lor. Cele ipotecate rămân ipotecate. Jocul așteaptă răspunsul celuilalt (cel mult cât timpul unei ture).
      </p>
      <div className="mt-2">
        <ErrorText>{give.length + get.length + mySide.cash + theirSide.cash + giveCards + getCards > 0 ? problem : null}</ErrorText>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Button variant="secondary" onClick={onClose}>
          Anulează
        </Button>
        <Button
          disabled={busy || problem !== null}
          onClick={() => onPropose({ kind: "propose", to, give: mySide, get: theirSide })}
          data-testid="trade-send"
        >
          Trimite oferta
        </Button>
      </div>
    </Modal>
  );
}
