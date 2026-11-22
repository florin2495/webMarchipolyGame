"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import { api } from "@/lib/client/api";
import { useNow } from "@/lib/client/clock";
import { PREF_VIBRATE, useBoolPref } from "@/lib/client/prefs";
import { BOARD, GROUPS, JAIL_FINE, PROPERTIES } from "@/lib/board";
import { type Action, canManage, minBid, money, netWorth, PLAYER_COLORS, TIMEOUT_GRACE_MS, tradeText } from "@/lib/marchipoly";
import type { PublicGame, RoomState } from "@/lib/types";
import { Board } from "./Board";
import { PropertyDialog } from "./PropertyDialog";
import { TradeDialog } from "./TradeDialog";
import { Button, Card as Panel, ErrorText, OfflineBadge } from "./ui";

/** Extra wait before a non-host device triggers a timeout, so the host's device goes first. */
const FALLBACK_SEATED_MS = 3_000;
const FALLBACK_OBSERVER_MS = 6_000;

interface GameProps {
  state: RoomState;
  token: string;
  refresh: () => Promise<void>;
  /** Shows the state a write returned, without a /state fetch. */
  apply: (s: RoomState) => void;
}

/** "Toată tabla" for spectators, or the seat shown at the bottom. */
type View = "all" | number;

export function Game({ state, token, refresh, apply }: GameProps) {
  const g = state.game!;
  const { room, me } = state;
  const isHost = room.hostPlayerId === me.id;
  const base = `/api/rooms/${room.code}`;
  const deviceNow = useNow();
  const now = deviceNow === 0 ? 0 : deviceNow + (state.clockOffset ?? 0); // server time
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [vibrate] = useBoolPref(PREF_VIBRATE, true);
  const [selected, setSelected] = useState<number | null>(null);
  const [trading, setTrading] = useState(false);
  const [view, setView] = useState<View>("all");

  async function run(fn: () => Promise<unknown>) {
    setBusy(true);
    setError("");
    try {
      const res = await fn();
      // Moves answer with the new state: no second request. Other writes still re-fetch.
      const fresh = (res as { state?: RoomState } | null)?.state;
      if (fresh) apply(fresh);
      else await refresh();
      return true;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Eroare.");
      void refresh();
      return false;
    } finally {
      setBusy(false);
    }
  }
  const send = (action: Action) => run(() => api(`${base}/action`, { token, body: action }));

  // Lazy turn timer: whoever has the page open plays the decision once its time is up.
  // The host's device goes first; seated players and then spectators are fallbacks.
  const fired = useRef<string | null>(null);
  const fallback = isHost ? 0 : g.mySeat !== null ? FALLBACK_SEATED_MS : FALLBACK_OBSERVER_MS;
  useEffect(() => {
    if (now === 0 || g.phase === "over" || g.turnDeadline === null) return;
    if (now < g.turnDeadline + TIMEOUT_GRACE_MS + fallback) return;
    const key = g.turnKey;
    if (fired.current === key) return;
    fired.current = key;
    api(`${base}/timeout`, { token, body: { turn: key } })
      .catch(() => undefined) // somebody else was faster: fine
      .finally(() => void refresh());
  }, [now, g.phase, g.turnDeadline, g.turnKey, fallback, base, token, refresh]);

  // Buzz once when a decision comes to me.
  const myDecision = g.mySeat !== null && g.actor === g.mySeat;
  const buzzed = useRef<string | null>(null);
  useEffect(() => {
    if (!myDecision || buzzed.current === g.turnKey) return;
    buzzed.current = g.turnKey;
    if (vibrate && typeof navigator !== "undefined" && "vibrate" in navigator) navigator.vibrate?.(200);
  }, [myDecision, g.turnKey, vibrate]);

  const n = g.seats.length;
  const viewSeat = g.mySeat !== null ? g.mySeat : view === "all" ? null : view;
  // Everyone else on top, in the order they play after the one at the bottom.
  const top = viewSeat === null ? g.seats.map((_, i) => i) : Array.from({ length: n - 1 }, (_, k) => (viewSeat + k + 1) % n);
  const secondsLeft = g.turnDeadline !== null && now > 0 ? Math.max(0, Math.ceil((g.turnDeadline - now) / 1000)) : null;

  return (
    <>
      <TurnBanner g={g} secondsLeft={secondsLeft} />

      <div
        className={`grid gap-1.5 ${top.length >= 5 ? "grid-cols-3" : top.length === 4 ? "grid-cols-4" : "grid-cols-3"}`}
        data-testid="player-strip"
      >
        {top.map((seat) => (
          <PlayerChip
            key={seat}
            g={g}
            seat={seat}
            connected={state.players.find((p) => p.id === g.seats[seat])?.connected}
            onClick={g.mySeat === null ? () => setView(seat) : undefined}
          />
        ))}
      </div>

      <Board g={g} selected={selected} onSelect={setSelected} highlight={g.actor} />

      <LastCard g={g} />

      {g.phase !== "over" && (
        <ActionArea
          g={g}
          busy={busy}
          isHost={isHost}
          send={send}
          onTrade={() => setTrading(true)}
          onSkip={() => {
            if (window.confirm("Sari peste decizia jucătorului? Jocul o ia automat (cum ar face la expirarea timpului).")) {
              void run(() => api(`${base}/timeout`, { token, body: { turn: g.turnKey } }));
            }
          }}
        />
      )}
      <ErrorText>{error}</ErrorText>

      {viewSeat !== null && (
        <MyPanel
          g={g}
          seat={viewSeat}
          mine={g.mySeat === viewSeat}
          connected={state.players.find((p) => p.id === g.seats[viewSeat])?.connected}
          onSelect={setSelected}
        />
      )}

      {g.mySeat === null && (
        <SpectatorPanel g={g} view={view} setView={setView} queued={state.me.queued} busy={busy} onQueue={() => void run(() => api(`${base}/queue`, { token, body: {} }))} />
      )}

      {g.phase === "over" && (
        <Standings
          g={g}
          isHost={isHost}
          busy={busy}
          onNewGame={() => void run(() => api(`${base}/new-round`, { token, body: {} }))}
        />
      )}

      <GameLog g={g} />

      {selected !== null && (
        <PropertyDialog g={g} square={selected} busy={busy} onClose={() => setSelected(null)} send={(a) => void send(a)} />
      )}
      {trading && g.mySeat !== null && (
        <TradeDialog
          g={g}
          seat={g.mySeat}
          busy={busy}
          onClose={() => setTrading(false)}
          onPropose={async (a) => {
            if (await send(a)) setTrading(false);
          }}
        />
      )}
    </>
  );
}

function TurnBanner({ g, secondsLeft }: { g: PublicGame; secondsLeft: number | null }) {
  const a = g.actor;
  let label: string;
  if (g.phase === "over") label = "Jocul s-a terminat";
  else if (a === g.mySeat) label = "Tura ta";
  else label = `Tura lui ${g.names[a ?? g.turn]}`;
  const time = g.endsAt !== null && g.phase !== "over" ? g.endsAt : null;
  return (
    <div className="flex items-center justify-between gap-2 rounded-xl bg-indigo-600 px-3 py-2 text-white shadow">
      <span className="flex min-w-0 items-center gap-2">
        {a !== null && g.phase !== "over" && (
          <span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white" style={{ background: PLAYER_COLORS[a] }} />
        )}
        <span className="truncate font-bold" data-testid="turn-label">
          {label}
        </span>
      </span>
      <span className="flex shrink-0 items-center gap-2 font-mono text-sm">
        {time !== null && <EndClock endsAt={time} />}
        {secondsLeft !== null && g.phase !== "over" && (
          <span className={`rounded px-1.5 ${secondsLeft <= 10 ? "bg-rose-500" : "bg-indigo-800"}`} data-testid="turn-timer">
            ⏱ {secondsLeft}s
          </span>
        )}
      </span>
    </div>
  );
}

function EndClock({ endsAt }: { endsAt: number }) {
  const now = useNow();
  if (now === 0) return null;
  const left = Math.max(0, endsAt - now);
  const m = Math.floor(left / 60_000);
  const s = Math.floor((left % 60_000) / 1000);
  return (
    <span className="rounded bg-indigo-800 px-1.5" title="Timp rămas până la ultima rundă">
      ⌛ {left === 0 ? "ultima rundă" : `${m}:${String(s).padStart(2, "0")}`}
    </span>
  );
}

/** A short "+120 lei" / "−50 lei" that floats up when someone's cash changes. */
function useMoneyPop(cash: number) {
  const [prev, setPrev] = useState(cash);
  const [pop, setPop] = useState<{ delta: number; key: number } | null>(null);
  if (prev !== cash) {
    setPrev(cash);
    setPop({ delta: cash - prev, key: (pop?.key ?? 0) + 1 });
  }
  return pop;
}

function MoneyPop({ cash }: { cash: number }) {
  const pop = useMoneyPop(cash);
  if (!pop) return null;
  return (
    <span
      key={pop.key}
      className={`money-pop pointer-events-none absolute -top-1 right-1 text-xs font-black ${pop.delta > 0 ? "text-emerald-500" : "text-rose-500"}`}
    >
      {pop.delta > 0 ? "+" : "−"}
      {Math.abs(pop.delta)}
    </span>
  );
}

function PlayerChip({ g, seat, connected, onClick }: { g: PublicGame; seat: number; connected: boolean | undefined; onClick?: () => void }) {
  const active = g.actor === seat;
  const owned = PROPERTIES.filter((s) => g.owner[s] === seat).length;
  const out = g.bankrupt[seat];
  const className = `relative min-w-0 rounded-lg border bg-white px-1.5 py-1 text-left dark:bg-zinc-950 ${
    active ? "border-amber-400 ring-2 ring-amber-300" : "border-zinc-200 dark:border-zinc-800"
  } ${out ? "opacity-50" : ""}`;
  const content = (
    <>
      <span className="flex min-w-0 items-center gap-1">
        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[seat] }} />
        <span className="truncate text-xs font-bold">{g.names[seat]}</span>
      </span>
      <span className="block truncate font-mono text-xs">{out ? `faliment · locul ${g.place[seat] ?? "-"}` : money(g.cash[seat])}</span>
      <span className="flex items-center gap-1 text-[10px] text-zinc-500">
        🏠 {owned}
        {g.inJail[seat] && <span title="În închisoare">🔒</span>}
        {g.jailCards[seat].length > 0 && <span title="Carte de ieșire din închisoare">🎫</span>}
        <OfflineBadge connected={connected} />
      </span>
      {!out && <MoneyPop cash={g.cash[seat]} />}
    </>
  );
  return onClick ? (
    <button type="button" onClick={onClick} className={className} data-testid={`player-${seat}`}>
      {content}
    </button>
  ) : (
    <div className={className} data-testid={`player-${seat}`}>
      {content}
    </div>
  );
}

function LastCard({ g }: { g: PublicGame }) {
  const c = g.lastCard;
  if (!c) return null;
  const last = g.log.filter((e) => e.text.includes(` trage `)).at(-1);
  if (!last) return null;
  return (
    <div
      className={`rounded-lg border px-3 py-2 text-xs ${
        c.deck === "noroc" ? "border-emerald-300 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950" : "border-violet-300 bg-violet-50 dark:border-violet-800 dark:bg-violet-950"
      }`}
      data-testid="last-card"
    >
      {c.deck === "noroc" ? "🍀 " : "🔮 "}
      {last.text}
    </div>
  );
}

function ActionArea({
  g,
  busy,
  isHost,
  send,
  onTrade,
  onSkip,
}: {
  g: PublicGame;
  busy: boolean;
  isHost: boolean;
  send: (a: Action) => Promise<boolean>;
  onTrade: () => void;
  onSkip: () => void;
}) {
  const me = g.mySeat;
  const actor = g.actor;
  const mine = me !== null && actor === me;
  const t = g.trade;

  const skip = isHost && actor !== null && actor !== me && (
    <button type="button" onClick={onSkip} disabled={busy} className="text-xs font-semibold text-zinc-500 underline" data-testid="host-skip">
      ⏭ Sari peste {g.names[actor]}
    </button>
  );

  let body: ReactNode = null;
  if (t) {
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          🤝 <b>Propunere de schimb:</b> {tradeText(g, t)}.
        </p>
        {me === t.to ? (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void send({ kind: "reject" })} data-testid="act-reject">
              Refuz
            </Button>
            <Button disabled={busy} onClick={() => void send({ kind: "accept" })} data-testid="act-accept">
              Accept
            </Button>
          </div>
        ) : me === t.from ? (
          <Button variant="secondary" disabled={busy} onClick={() => void send({ kind: "cancel" })} data-testid="act-cancel">
            Retrag propunerea
          </Button>
        ) : (
          <p className="text-xs text-zinc-500">Așteptăm răspunsul lui {g.names[t.to]}.</p>
        )}
      </div>
    );
  } else if (g.phase === "auction" && g.auction) {
    body = <AuctionPanel g={g} mine={mine} busy={busy} send={send} />;
  } else if (g.phase === "debt" && g.debts[0]) {
    const d = g.debts[0];
    const to = d.to === "pot" ? "la Parcare" : d.to === "bank" ? "băncii" : `lui ${g.names[d.to]}`;
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          💸 <b>{g.names[d.seat]}</b> datorează {money(d.amount)} {to} ({d.reason}) și are {money(g.cash[d.seat])}.
        </p>
        {mine && (
          <>
            <p className="text-xs text-zinc-500">
              Strânge banii: atinge proprietățile tale ca să vinzi clădiri sau să ipotechezi, sau propune un schimb. Dacă nu se poate, declari faliment.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button
                variant="danger"
                disabled={busy}
                data-testid="act-bankrupt"
                onClick={() => {
                  if (window.confirm("Sigur declari faliment? Ieși din joc.")) void send({ kind: "bankrupt" });
                }}
              >
                Faliment
              </Button>
              <Button disabled={busy || g.cash[d.seat] < d.amount} onClick={() => void send({ kind: "pay" })} data-testid="act-pay">
                Plătesc {money(d.amount)}
              </Button>
            </div>
            <Button variant="secondary" disabled={busy} onClick={onTrade} data-testid="act-trade">
              🤝 Propune un schimb
            </Button>
          </>
        )}
      </div>
    );
  } else if (mine && g.phase === "buy" && g.buySquare !== null) {
    const sq = BOARD[g.buySquare];
    const price = sq.price ?? 0;
    body = (
      <div className="flex flex-col gap-2">
        <p className="text-sm">
          Ai ajuns pe <b>{sq.name}</b>. O cumperi cu {money(price)}?{" "}
          <span className="text-xs text-zinc-500">
            {g.settings.auctions ? "Dacă nu, se licitează între toți." : "Dacă nu, rămâne la bancă."}
          </span>
        </p>
        <div className="grid grid-cols-2 gap-2">
          <Button variant="secondary" disabled={busy} onClick={() => void send({ kind: "decline" })} data-testid="act-decline">
            Nu cumpăr
          </Button>
          <Button disabled={busy || g.cash[me!] < price} onClick={() => void send({ kind: "buy" })} data-testid="act-buy">
            Cumpăr ({money(price)})
          </Button>
        </div>
      </div>
    );
  } else if (mine && g.phase === "roll") {
    const jailed = g.inJail[me!];
    body = (
      <div className="flex flex-col gap-2">
        {jailed && (
          <p className="text-sm">
            🔒 Ești în închisoare (încercarea {g.jailTries[me!] + 1} din 3). Dai cu zarul pentru o dublă, plătești {money(JAIL_FINE)} sau folosești o carte.
          </p>
        )}
        <Button disabled={busy} onClick={() => void send({ kind: "roll" })} data-testid="act-roll">
          🎲 {jailed ? "Încerc o dublă" : g.rolled ? "Dau din nou (dublă)" : "Dau cu zarul"}
        </Button>
        {jailed && (
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy || g.cash[me!] < JAIL_FINE} onClick={() => void send({ kind: "payJail" })} data-testid="act-pay-jail">
              Plătesc {money(JAIL_FINE)}
            </Button>
            <Button variant="secondary" disabled={busy || g.jailCards[me!].length === 0} onClick={() => void send({ kind: "useCard" })} data-testid="act-use-card">
              🎫 Folosesc cartea
            </Button>
          </div>
        )}
        <Button variant="secondary" disabled={busy || !canManage(g, me!)} onClick={onTrade} data-testid="act-trade">
          🤝 Propune un schimb
        </Button>
      </div>
    );
  } else if (mine && g.phase === "done") {
    body = (
      <div className="grid grid-cols-2 gap-2">
        <Button variant="secondary" disabled={busy} onClick={onTrade} data-testid="act-trade">
          🤝 Schimb
        </Button>
        <Button disabled={busy} onClick={() => void send({ kind: "end" })} data-testid="act-end">
          Termin tura
        </Button>
      </div>
    );
  } else if (actor !== null) {
    const what =
      g.phase === "buy" && g.buySquare !== null
        ? `se gândește dacă cumpără ${BOARD[g.buySquare].name}`
        : g.phase === "roll"
          ? "dă cu zarul"
          : "își termină tura";
    body = (
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        {g.names[actor]} {what}…
      </p>
    );
  }

  return (
    <Panel className="flex flex-col gap-2" data-testid={mine ? "action-bar" : "status-bar"}>
      {body}
      {skip}
    </Panel>
  );
}

function AuctionPanel({ g, mine, busy, send }: { g: PublicGame; mine: boolean; busy: boolean; send: (a: Action) => Promise<boolean> }) {
  const a = g.auction!;
  const sq = BOARD[a.square];
  const min = minBid(g);
  const [typed, setTyped] = useState<string>("");
  const amount = typed === "" ? min : Number(typed);
  const cash = g.mySeat !== null ? g.cash[g.mySeat] : 0;
  const ok = Number.isInteger(amount) && amount >= min && amount <= cash;
  return (
    <div className="flex flex-col gap-2" data-testid="auction">
      <p className="text-sm">
        🔨 Licitație: <b>{sq.name}</b> (preț {money(sq.price ?? 0)}).{" "}
        {a.bidder !== null ? (
          <>
            Cea mai mare ofertă: <b>{money(a.high)}</b>, {g.names[a.bidder]}.
          </>
        ) : (
          "Nicio ofertă încă."
        )}
      </p>
      <p className="text-xs text-zinc-500">
        Mai licitează: {a.active.map((s) => g.names[s]).join(", ")}. Acum: <b>{g.names[a.turn]}</b>.
      </p>
      {mine && (
        <>
          <div className="flex gap-2">
            {[min, min + 40, min + 90].map((v) => (
              <button
                key={v}
                type="button"
                disabled={busy || v > cash}
                onClick={() => setTyped(String(v))}
                className={`min-h-10 flex-1 rounded-lg border text-sm font-semibold disabled:opacity-40 ${amount === v ? "border-indigo-500 bg-indigo-50 dark:bg-indigo-950" : "border-zinc-300 dark:border-zinc-700"}`}
              >
                {v}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-sm">
            Oferta ta
            <input
              type="number"
              inputMode="numeric"
              min={min}
              max={cash}
              step={10}
              value={typed === "" ? min : typed}
              onChange={(e) => setTyped(e.target.value)}
              className="min-h-10 w-28 rounded-lg border border-zinc-300 bg-white px-2 text-base text-zinc-900 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100"
              data-testid="bid-amount"
            />
            <span className="text-xs text-zinc-500">ai {money(cash)}</span>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <Button variant="secondary" disabled={busy} onClick={() => void send({ kind: "pass" })} data-testid="act-pass">
              Renunț
            </Button>
            <Button
              disabled={busy || !ok}
              onClick={async () => {
                if (await send({ kind: "bid", amount })) setTyped("");
              }}
              data-testid="act-bid"
            >
              Licitez {ok ? money(amount) : ""}
            </Button>
          </div>
        </>
      )}
    </div>
  );
}

function MyPanel({
  g,
  seat,
  mine,
  connected,
  onSelect,
}: {
  g: PublicGame;
  seat: number;
  mine: boolean;
  connected: boolean | undefined;
  onSelect: (square: number) => void;
}) {
  const owned = PROPERTIES.filter((s) => g.owner[s] === seat);
  const out = g.bankrupt[seat];
  return (
    <Panel className={`relative ${g.actor === seat ? "ring-2 ring-amber-300" : ""}`} data-testid="my-panel">
      <div className="flex items-center justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2">
          <span className="h-4 w-4 shrink-0 rounded-full ring-2 ring-white" style={{ background: PLAYER_COLORS[seat] }} />
          <span className="truncate font-black">
            {g.names[seat]}
            {mine && <span className="font-normal text-zinc-500"> (tu)</span>}
          </span>
          <OfflineBadge connected={connected} />
        </span>
        <span className="relative font-mono text-lg font-black" data-testid="my-cash">
          {money(g.cash[seat])}
          {!out && <MoneyPop cash={g.cash[seat]} />}
        </span>
      </div>
      <p className="mt-1 text-xs text-zinc-500">
        {out
          ? `A dat faliment (locul ${g.place[seat] ?? "-"}).`
          : `Pe ${BOARD[g.pos[seat]].name}${g.inJail[seat] ? " · în închisoare 🔒" : ""}${
              g.jailCards[seat].length > 0 ? ` · ${g.jailCards[seat].length} 🎫 ieșire din închisoare` : ""
            } · avere ${money(netWorth(g, seat))}`}
      </p>
      {owned.length === 0 ? (
        <p className="mt-2 text-sm text-zinc-500">{mine ? "Nu ai încă proprietăți." : "Nicio proprietate."}</p>
      ) : (
        <ul className="mt-2 flex flex-wrap gap-1.5" data-testid="my-properties">
          {owned.map((s) => {
            const sq = BOARD[s];
            const color = sq.group !== undefined ? GROUPS[sq.group].color : "#52525b";
            const h = g.houses[s];
            return (
              <li key={s}>
                <button
                  type="button"
                  onClick={() => onSelect(s)}
                  className={`min-h-8 rounded-md border-2 bg-white px-2 text-xs font-semibold dark:bg-zinc-900 ${g.mortgaged[s] ? "border-dashed opacity-60" : ""}`}
                  style={{ borderColor: color }}
                >
                  {sq.kind === "station" ? "🚂 " : sq.kind === "utility" ? "⚡ " : ""}
                  {sq.name}
                  {h > 0 && <span className="ml-1">{h === 5 ? "🏨" : `🏠${h}`}</span>}
                  {g.mortgaged[s] && <span className="ml-1 text-[10px] uppercase">ipotecă</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {mine && owned.length > 0 && <p className="mt-2 text-[11px] text-zinc-500">Atinge o proprietate ca să construiești, vinzi sau ipotechezi.</p>}
    </Panel>
  );
}

function SpectatorPanel({
  g,
  view,
  setView,
  queued,
  busy,
  onQueue,
}: {
  g: PublicGame;
  view: View;
  setView: (v: View) => void;
  queued: boolean;
  busy: boolean;
  onQueue: () => void;
}) {
  const chip = (active: boolean) =>
    `min-h-9 rounded-full border px-3 text-xs font-semibold ${active ? "border-indigo-500 bg-indigo-600 text-white" : "border-zinc-300 dark:border-zinc-700"}`;
  return (
    <Panel data-testid="observer-panel">
      <p className="mb-2 text-sm text-zinc-600 dark:text-zinc-400">
        👀 Ești spectator. Alege pe cine vezi jos, sau toată tabla.
        {queued && " Ești la coadă pentru jocul următor."}
      </p>
      <div className="mb-3 flex flex-wrap gap-1.5" data-testid="view-switcher">
        <button type="button" className={chip(view === "all")} onClick={() => setView("all")} data-testid="view-all">
          Toată tabla
        </button>
        {g.seats.map((_, s) => (
          <button key={s} type="button" className={chip(view === s)} onClick={() => setView(s)} data-testid={`view-seat-${s}`}>
            <span className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: PLAYER_COLORS[s] }} />
            {g.names[s]}
          </button>
        ))}
      </div>
      <Button variant="secondary" className="w-full" disabled={busy} onClick={onQueue} data-testid="queue-toggle">
        {queued ? "Ies de la coadă" : "🎲 Intru în jocul următor"}
      </Button>
    </Panel>
  );
}

function Standings({ g, isHost, busy, onNewGame }: { g: PublicGame; isHost: boolean; busy: boolean; onNewGame: () => void }) {
  const ranked = g.seats.map((_, s) => s).sort((a, b) => (g.place[a] ?? 99) - (g.place[b] ?? 99));
  return (
    <Panel data-testid="standings">
      <h2 className="mb-2 text-lg font-black">🏆 {g.winner !== null ? `${g.names[g.winner]} a câștigat!` : "Joc terminat"}</h2>
      <p className="mb-2 text-xs text-zinc-500">
        {g.endReason === "time" ? "Timpul s-a terminat: câștigă averea cea mai mare." : "Toți ceilalți au dat faliment."}
      </p>
      <ol className="flex flex-col divide-y divide-zinc-200 dark:divide-zinc-800">
        {ranked.map((s) => (
          <li key={s} className="flex items-center justify-between gap-2 py-1.5 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="w-6 font-mono font-bold">{g.place[s] ?? "-"}.</span>
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: PLAYER_COLORS[s] }} />
              <span className="truncate">{g.names[s]}</span>
            </span>
            <span className="font-mono text-xs">{g.bankrupt[s] ? "faliment" : money(netWorth(g, s))}</span>
          </li>
        ))}
      </ol>
      {isHost ? (
        <Button className="mt-3 w-full" disabled={busy} onClick={onNewGame} data-testid="new-game">
          Joc nou (înapoi în lobby)
        </Button>
      ) : (
        <p className="mt-3 text-center text-xs text-zinc-500">Host-ul poate porni un joc nou.</p>
      )}
    </Panel>
  );
}

function GameLog({ g }: { g: PublicGame }) {
  const entries = g.log.slice(-25).reverse();
  return (
    <Panel className="py-2">
      <details open>
        <summary className="flex min-h-9 cursor-pointer items-center font-bold">Ce s-a întâmplat</summary>
        <ul className="mt-1 flex max-h-56 flex-col gap-1 overflow-y-auto text-xs" data-testid="game-log">
          {entries.map((e) => (
            <li key={e.n} className="flex gap-1.5">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ background: e.seat !== null ? PLAYER_COLORS[e.seat] : "#a1a1aa" }} />
              <span>{e.text}</span>
            </li>
          ))}
        </ul>
      </details>
    </Panel>
  );
}
