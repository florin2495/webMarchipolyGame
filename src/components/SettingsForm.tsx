"use client";

import { useState } from "react";
import { LIMITS, minutesLabel, money, type Settings, settingsError, TURN_OPTIONS } from "@/lib/marchipoly";
import { ErrorText, Toggle } from "./ui";

const input =
  "min-h-11 w-full rounded-lg border border-zinc-300 bg-white px-3 text-base text-zinc-900 disabled:opacity-60 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100";

const MINUTE_OPTIONS: number[] = [];
for (let m = LIMITS.minutes.min; m <= LIMITS.minutes.max; m += LIMITS.minutes.step) MINUTE_OPTIONS.push(m);

/** One line that sums the rules up (room header, room list). */
export function settingsSummary(s: Settings): string {
  const end = s.endMode === "time" ? `${minutesLabel(s.minutes)}` : "până la faliment";
  return `${money(s.startMoney)} la start · salariu ${money(s.salary)} · ${s.auctions ? "cu licitație" : "fără licitație"} · ${end}`;
}

/**
 * Game settings chosen by the host. Controlled by the parent; the money field keeps its own text while typing
 * and reports a value only when it parses, so the host can clear it and retype.
 */
export function SettingsForm({
  value,
  onChange,
  disabled,
}: {
  value: Settings;
  onChange: (s: Settings) => void;
  disabled?: boolean;
}) {
  const set = (patch: Partial<Settings>) => onChange({ ...value, ...patch });
  const problem = settingsError(value);

  return (
    <div className="flex flex-col gap-3">
      <NumberField
        label="Banii de start ai fiecărui jucător"
        value={value.startMoney}
        min={LIMITS.startMoney.min}
        max={LIMITS.startMoney.max}
        step={LIMITS.startMoney.step}
        disabled={disabled}
        onValue={(startMoney) => set({ startMoney })}
      />
      <NumberField
        label="Salariul la Start (când treci sau oprești pe Start)"
        value={value.salary}
        min={LIMITS.salary.min}
        max={LIMITS.salary.max}
        step={LIMITS.salary.step}
        disabled={disabled}
        onValue={(salary) => set({ salary })}
      />
      <Toggle
        label="Licitație"
        hint={
          value.auctions
            ? "Dacă cineva nu cumpără proprietatea pe care a picat, ea se licitează între toți."
            : "Dacă cineva nu cumpără proprietatea pe care a picat, ea rămâne la bancă."
        }
        checked={value.auctions}
        disabled={disabled}
        onChange={(auctions) => set({ auctions })}
      />
      <label className="flex flex-col gap-1 text-sm font-medium">
        Timp pentru fiecare decizie
        <select
          className={input}
          value={value.turnSeconds}
          disabled={disabled}
          onChange={(e) => set({ turnSeconds: Number(e.target.value) })}
        >
          {TURN_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s < 60 ? `${s} de secunde` : s === 60 ? "1 minut" : `${s / 60 === 2 ? "2 minute" : `${s} de secunde`}`}
            </option>
          ))}
        </select>
      </label>
      <fieldset className="flex flex-col gap-1 text-sm font-medium">
        <legend className="mb-1">Finalul jocului</legend>
        <div className="grid grid-cols-2 gap-2">
          {(["bankrupt", "time"] as const).map((m) => (
            <label
              key={m}
              className={`flex min-h-11 items-center justify-center rounded-lg border px-2 text-center ${
                value.endMode === m ? "border-indigo-500 bg-indigo-50 font-semibold dark:bg-indigo-950" : "border-zinc-300 dark:border-zinc-700"
              } ${disabled ? "opacity-60" : "cursor-pointer"}`}
            >
              <input
                type="radio"
                name="endMode"
                className="sr-only"
                checked={value.endMode === m}
                disabled={disabled}
                onChange={() => set({ endMode: m })}
              />
              {m === "bankrupt" ? "Până rămâne unul" : "Limită de timp"}
            </label>
          ))}
        </div>
      </fieldset>
      {value.endMode === "time" && (
        <label className="flex flex-col gap-1 text-sm font-medium">
          Durata jocului
          <select className={input} value={value.minutes} disabled={disabled} onChange={(e) => set({ minutes: Number(e.target.value) })}>
            {MINUTE_OPTIONS.map((m) => (
              <option key={m} value={m}>
                {minutesLabel(m)}
              </option>
            ))}
          </select>
        </label>
      )}
      <p className="text-xs text-zinc-500">
        {value.endMode === "time"
          ? `După ${minutesLabel(value.minutes)} se termină runda începută, apoi câștigă averea cea mai mare (bani, proprietăți, clădiri).`
          : "Se joacă până când toți ceilalți dau faliment."}
      </p>
      <ErrorText>{problem}</ErrorText>
    </div>
  );
}

function NumberField({
  label,
  value,
  min,
  max,
  step,
  disabled,
  onValue,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  onValue: (n: number) => void;
}) {
  // Local text while typing; follows the parent value whenever that changes from outside.
  const [text, setText] = useState(String(value));
  const [seen, setSeen] = useState(value);
  if (seen !== value) {
    setSeen(value);
    if (Number(text) !== value) setText(String(value));
  }
  return (
    <label className="flex flex-col gap-1 text-sm font-medium">
      {label}
      <input
        type="number"
        inputMode="numeric"
        min={min}
        max={max}
        step={step}
        value={text}
        disabled={disabled}
        onChange={(e) => {
          setText(e.target.value);
          const n = Number(e.target.value);
          if (e.target.value !== "" && Number.isInteger(n)) onValue(n);
        }}
        className={input}
      />
      <span className="text-xs font-normal text-zinc-500">
        Între {money(min)} și {money(max)}, din {step} în {step}.
      </span>
    </label>
  );
}
