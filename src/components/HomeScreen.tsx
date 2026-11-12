"use client";

import { ArrowRight, ChevronDown, Gauge, Timer, Users } from "lucide-react";
import { useId, type CSSProperties, type FormEvent, type ReactNode } from "react";
import { GameLogo } from "@/components/Logo";
import {
  DIFFICULTIES,
  MAX_GENRE_LENGTH,
  MAX_PLAYERS,
  MAX_SECONDS,
  MIN_PLAYERS,
  MIN_SECONDS,
  SECONDS_STEP,
  type Difficulty,
  type Settings,
} from "@/lib/game";

const QUICK_PICKS = ["One Piece", "Pokémon", "Football", "Pop Music", "Marvel"];

type HomeScreenProps = {
  settings: Settings;
  onChange: (patch: Partial<Settings>) => void;
  onSubmit: () => void;
};

export function HomeScreen({ settings, onChange, onSubmit }: HomeScreenProps) {
  const genreId = useId();
  const canSubmit = settings.genre.trim().length > 0;

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (canSubmit) onSubmit();
  }

  return (
    <main className="animate-screen-in mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-7 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <GameLogo />
        <p className="text-ink-soft text-base font-semibold sm:text-lg">
          Take turns naming things. Don&apos;t let your fuse burn out!
        </p>
      </div>

      {/* Genre */}
      <form onSubmit={handleSubmit} className="w-full">
        <label htmlFor={genreId} className="text-ink-soft mb-2 block pl-3 text-sm font-bold tracking-wide uppercase">
          Pick a genre
        </label>
        <div className="bg-paper focus-within:border-lavender-deep flex items-center gap-2 rounded-full border-[3px] border-ink p-2 pl-6 shadow-[0_6px_0_0_rgb(61_44_70/0.2)] transition-colors">
          <input
            id={genreId}
            value={settings.genre}
            onChange={(e) => onChange({ genre: e.target.value })}
            maxLength={MAX_GENRE_LENGTH}
            placeholder="e.g. One Piece"
            autoComplete="off"
            autoFocus
            className="placeholder:text-ink-soft/60 font-display min-w-0 flex-1 bg-transparent text-2xl font-medium outline-none sm:text-3xl"
          />
          <button
            type="submit"
            disabled={!canSubmit}
            aria-label="Continue to player names"
            className="press bg-coral flex size-14 shrink-0 items-center justify-center rounded-full border-[3px] border-ink text-ink disabled:cursor-not-allowed disabled:opacity-40 sm:size-16"
          >
            <ArrowRight className="size-7" strokeWidth={3} />
          </button>
        </div>
        <div className="mt-3 flex flex-wrap justify-center gap-2">
          {QUICK_PICKS.map((pick) => (
            <button
              key={pick}
              type="button"
              onClick={() => onChange({ genre: pick })}
              className="bg-paper/80 hover:bg-butter rounded-full border-2 border-ink/15 px-3 py-1 text-sm font-bold transition-colors"
            >
              {pick}
            </button>
          ))}
        </div>
      </form>

      {/* Difficulty + players */}
      <div className="grid w-full grid-cols-2 gap-3 sm:gap-4">
        <SettingCard icon={<Gauge className="size-4" strokeWidth={2.5} />} label="Difficulty">
          <DifficultyToggle value={settings.difficulty} onChange={(difficulty) => onChange({ difficulty })} />
        </SettingCard>
        <SettingCard icon={<Users className="size-4" strokeWidth={2.5} />} label="Players">
          <PlayerCountSelect value={settings.playerCount} onChange={(playerCount) => onChange({ playerCount })} />
        </SettingCard>
      </div>

      {/* Timer */}
      <SettingCard icon={<Timer className="size-4" strokeWidth={2.5} />} label="Time per player" className="w-full">
        <TimerSlider value={settings.seconds} onChange={(seconds) => onChange({ seconds })} />
      </SettingCard>
    </main>
  );
}

function SettingCard({
  icon,
  label,
  children,
  className = "",
}: {
  icon: ReactNode;
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={`bg-paper/90 rounded-[1.75rem] border-[3px] border-ink/10 p-3 sm:p-4 ${className}`}>
      <div className="text-ink-soft mb-2.5 flex items-center gap-1.5 pl-1 text-xs font-extrabold tracking-wider uppercase sm:text-sm">
        {icon}
        {label}
      </div>
      {children}
    </div>
  );
}

const DIFFICULTY_STYLE: Record<Difficulty, string> = {
  Easy: "var(--color-mint)",
  Medium: "var(--color-butter)",
  Hard: "var(--color-coral)",
};

/** One button: each click slides the pill to the next difficulty (Easy → Medium → Hard → Easy). */
function DifficultyToggle({ value, onChange }: { value: Difficulty; onChange: (value: Difficulty) => void }) {
  const index = DIFFICULTIES.indexOf(value);
  const next = DIFFICULTIES[(index + 1) % DIFFICULTIES.length];

  return (
    <button
      type="button"
      onClick={() => onChange(next)}
      aria-label={`Difficulty: ${value}. Click for ${next}.`}
      className="bg-cream-deep relative grid h-12 w-full grid-cols-3 rounded-full p-1 transition-transform active:scale-[0.97]"
    >
      <span
        aria-hidden="true"
        className="absolute top-1 bottom-1 left-1 w-[calc((100%-0.5rem)/3)] rounded-full border-[3px] border-ink shadow-[0_3px_0_0_rgb(61_44_70/0.2)] transition-[transform,background-color] duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)]"
        style={{ transform: `translateX(${index * 100}%)`, backgroundColor: DIFFICULTY_STYLE[value] }}
      />
      {DIFFICULTIES.map((difficulty) => (
        <span
          key={difficulty}
          aria-hidden="true"
          className={`relative z-10 flex items-center justify-center text-xs font-extrabold transition-colors sm:text-sm ${
            difficulty === value ? "text-ink" : "text-ink-soft/70"
          }`}
        >
          {difficulty}
        </span>
      ))}
    </button>
  );
}

function PlayerCountSelect({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const options = Array.from({ length: MAX_PLAYERS - MIN_PLAYERS + 1 }, (_, i) => MIN_PLAYERS + i);
  return (
    <div className="relative">
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        aria-label="Number of players"
        className="bg-sky focus-visible:ring-lavender-deep/40 font-display h-12 w-full cursor-pointer appearance-none rounded-full border-[3px] border-ink pr-10 pl-5 text-lg font-semibold shadow-[0_3px_0_0_rgb(61_44_70/0.2)] outline-none focus-visible:ring-4"
      >
        {options.map((count) => (
          <option key={count} value={count}>
            {count} players
          </option>
        ))}
      </select>
      <ChevronDown
        className="pointer-events-none absolute top-1/2 right-4 size-5 -translate-y-1/2"
        strokeWidth={3}
        aria-hidden="true"
      />
    </div>
  );
}

function TimerSlider({ value, onChange }: { value: number; onChange: (value: number) => void }) {
  const fill = ((value - MIN_SECONDS) / (MAX_SECONDS - MIN_SECONDS)) * 100;
  return (
    <div className="flex items-center gap-4 px-1">
      <div className="flex-1">
        <input
          type="range"
          min={MIN_SECONDS}
          max={MAX_SECONDS}
          step={SECONDS_STEP}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          aria-label="Seconds per player"
          aria-valuetext={`${value} seconds`}
          className="cozy-range"
          style={{ "--fill": `${fill}%` } as CSSProperties}
        />
        <div className="text-ink-soft/70 mt-1.5 flex justify-between text-xs font-bold">
          <span>{MIN_SECONDS}s</span>
          <span>{MAX_SECONDS}s</span>
        </div>
      </div>
      <output className="bg-peach font-display min-w-[5.5rem] rounded-2xl border-[3px] border-ink px-3 py-1.5 text-center text-3xl font-bold tabular-nums shadow-[0_3px_0_0_rgb(61_44_70/0.2)]">
        {value}
        <span className="text-xl">s</span>
      </output>
    </div>
  );
}
