"use client";

import type { ReactNode } from "react";
import { BOARD, GROUPS, houseCost, mortgageValue, STATION_RENTS, unmortgageCost, UTILITY_MULTIPLIERS } from "@/lib/board";
import { type Action, buildProblem, mortgageProblem, money, ownsGroup, PLAYER_COLORS, sellProblem, unmortgageProblem } from "@/lib/marchipoly";
import type { PublicGame } from "@/lib/types";
import { Button } from "./ui";

export function Modal({ title, onClose, children, testId }: { title: string; onClose: () => void; children: ReactNode; testId?: string }) {
  return (
    <div className="fixed inset-0 z-50 overflow-y-auto overscroll-contain bg-black/50">
      <div
        className="flex min-h-full items-end justify-center p-3 pt-[max(1rem,env(safe-area-inset-top))] sm:items-center"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-label={title}
          onKeyDown={(e) => {
            if (e.key === "Escape") onClose();
          }}
          className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-4 text-zinc-900 shadow-xl dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-100"
          data-testid={testId}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

const SQUARE_TEXT: Record<string, string> = {
  start: "Treci pe aici și încasezi 200 de la bancă.",
  jail: "Doar în vizită, dacă nu ai fost trimis aici. Din închisoare ieși cu o dublă, cu 50 sau cu o carte.",
  parking: "Aici se strâng toate taxele și amenzile. Cine se oprește aici le ia pe toate.",
  gotojail: "Mergi direct la închisoare, fără să treci pe la Start.",
  noroc: "Tragi o carte Noroc.",
  destin: "Tragi o carte Destin.",
};

export function PropertyDialog({
  g,
  square,
  busy,
  onClose,
  send,
}: {
  g: PublicGame;
  square: number;
  busy: boolean;
  onClose: () => void;
  send: (a: Action) => void;
}) {
  const sq = BOARD[square];
  const owner = g.owner[square];
  const me = g.mySeat;
  const mine = me !== null && owner === me;
  const group = sq.group !== undefined ? GROUPS[sq.group] : null;
  const h = g.houses[square];
  const activeRow =
    owner === null || g.mortgaged[square] ? -1 : h > 0 ? h + 1 : ownsGroup(g, owner, square) ? 1 : 0;
  const here = g.seats.map((_, s) => s).filter((s) => !g.bankrupt[s] && g.pos[s] === square);

  const manage: { label: string; action: Action; problem: string | null; testId: string }[] = [];
  if (mine) {
    if (sq.kind === "street") {
      manage.push({
        label: h === 4 ? `Construiește hotel (${money(houseCost(square))})` : `Construiește casă (${money(houseCost(square))})`,
        action: { kind: "build", square },
        problem: buildProblem(g, me, square),
        testId: "prop-build",
      });
      if (h > 0) {
        manage.push({
          label: `Vinde ${h === 5 ? "hotelul" : "o casă"} (${money(Math.floor(houseCost(square) / 2))})`,
          action: { kind: "sell", square },
          problem: sellProblem(g, me, square),
          testId: "prop-sell",
        });
      }
    }
    if (g.mortgaged[square]) {
      manage.push({
        label: `Răscumpără (${money(unmortgageCost(square))})`,
        action: { kind: "unmortgage", square },
        problem: unmortgageProblem(g, me, square),
        testId: "prop-unmortgage",
      });
    } else {
      manage.push({
        label: `Ipotechează (+${money(mortgageValue(square))})`,
        action: { kind: "mortgage", square },
        problem: mortgageProblem(g, me, square),
        testId: "prop-mortgage",
      });
    }
  }

  return (
    <Modal title={sq.name} onClose={onClose} testId="property-dialog">
      <div className="-mx-4 -mt-4 mb-3 rounded-t-xl px-4 py-3 text-white" style={{ background: group?.color ?? "#3f3f46" }}>
        <p className="text-xs font-semibold uppercase opacity-80">{group?.name ?? (sq.kind === "station" ? "Gară" : sq.kind === "utility" ? "Utilitate" : "Pătrat")}</p>
        <h2 className="text-xl font-black">{sq.name}</h2>
      </div>

      {sq.price !== undefined ? (
        <div className="flex flex-col gap-2 text-sm">
          <p>
            Preț: <b>{money(sq.price)}</b> · Ipotecă: {money(mortgageValue(square))}
          </p>
          {sq.kind === "street" && sq.rents && (
            <table className="w-full text-left text-xs">
              <tbody>
                {[
                  ["Chirie", sq.rents[0]],
                  ["Cu toată regiunea", sq.rents[0] * 2],
                  ["Cu 1 casă", sq.rents[1]],
                  ["Cu 2 case", sq.rents[2]],
                  ["Cu 3 case", sq.rents[3]],
                  ["Cu 4 case", sq.rents[4]],
                  ["Cu hotel", sq.rents[5]],
                ].map(([label, v], k) => {
                  return (
                    <tr key={label as string} className={k === activeRow ? "font-bold text-indigo-600 dark:text-indigo-400" : ""}>
                      <td className="py-0.5">{label}</td>
                      <td className="py-0.5 text-right font-mono">{money(v as number)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          {sq.kind === "street" && <p className="text-xs text-zinc-500">O casă costă {money(houseCost(square))}; hotelul se ridică după 4 case.</p>}
          {sq.kind === "station" && (
            <p className="text-xs">Chirie după câte gări are proprietarul: {STATION_RENTS.map((r, k) => `${k + 1}: ${money(r)}`).join(" · ")}.</p>
          )}
          {sq.kind === "utility" && (
            <p className="text-xs">
              Chirie: de {UTILITY_MULTIPLIERS[0]} ori zarurile cu o uzină, de {UTILITY_MULTIPLIERS[1]} ori cu amândouă.
            </p>
          )}
          <p className="flex items-center gap-2">
            Proprietar:{" "}
            {owner === null ? (
              <b>banca</b>
            ) : (
              <>
                <span className="h-3 w-3 rounded-full" style={{ background: PLAYER_COLORS[owner] }} />
                <b>{g.names[owner]}</b>
              </>
            )}
            {g.mortgaged[square] && <span className="rounded bg-zinc-200 px-1.5 text-[10px] font-bold uppercase dark:bg-zinc-800">ipotecată</span>}
          </p>
          {h > 0 && <p>Clădiri: {h === 5 ? "🏨 hotel" : `🏠 ${h} ${h === 1 ? "casă" : "case"}`}</p>}
        </div>
      ) : (
        <p className="text-sm">{sq.tax !== undefined ? `Plătești ${money(sq.tax)} la Parcare.` : SQUARE_TEXT[sq.kind]}</p>
      )}

      {here.length > 0 && <p className="mt-2 text-xs text-zinc-500">Aici: {here.map((s) => g.names[s]).join(", ")}</p>}

      {manage.length > 0 && (
        <div className="mt-3 flex flex-col gap-2">
          {manage.map((m) => (
            <div key={m.testId}>
              <Button
                className="w-full"
                variant="secondary"
                disabled={busy || m.problem !== null}
                onClick={() => send(m.action)}
                data-testid={m.testId}
              >
                {m.label}
              </Button>
              {m.problem && <p className="mt-0.5 text-[11px] text-zinc-500">{m.problem}</p>}
            </div>
          ))}
        </div>
      )}

      <Button className="mt-3 w-full" onClick={onClose}>
        Închide
      </Button>
    </Modal>
  );
}
