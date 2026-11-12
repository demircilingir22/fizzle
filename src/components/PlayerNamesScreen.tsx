"use client";

import { ArrowLeft, Gauge, Play, RotateCcw, Sparkles, Timer, TriangleAlert } from "lucide-react";
import type { FormEvent, ReactNode } from "react";
import { CozyLoader } from "@/components/CozyLoader";
import { MAX_NAME_LENGTH, defaultPlayerName, playerColor, type Settings } from "@/lib/game";

type PlayerNamesScreenProps = {
  settings: Settings;
  names: string[];
  onNameChange: (index: number, name: string) => void;
  onBack: () => void;
  onStart: () => void;
  onCancelLoading: () => void;
  loading: boolean;
  error: string | null;
};

export function PlayerNamesScreen({
  settings,
  names,
  onNameChange,
  onBack,
  onStart,
  onCancelLoading,
  loading,
  error,
}: PlayerNamesScreenProps) {
  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    if (!loading) onStart();
  }

  return (
    <main className="animate-screen-in relative mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-6 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex flex-wrap justify-center gap-2">
          <SummaryChip icon={<Sparkles className="size-4" strokeWidth={2.5} />} className="bg-lavender">
            {settings.genre}
          </SummaryChip>
          <SummaryChip icon={<Gauge className="size-4" strokeWidth={2.5} />} className="bg-butter">
            {settings.difficulty}
          </SummaryChip>
          <SummaryChip icon={<Timer className="size-4" strokeWidth={2.5} />} className="bg-peach">
            {settings.seconds}s each
          </SummaryChip>
        </div>
        <h2 className="font-display text-4xl font-bold sm:text-5xl">Who&apos;s playing?</h2>
        <p className="text-ink-soft font-semibold">Leave a box empty to keep the default name.</p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-6">
        <div className="grid gap-3 sm:grid-cols-2">
          {Array.from({ length: settings.playerCount }, (_, index) => {
            const color = playerColor(index);
            return (
              <label
                key={index}
                className="bg-paper focus-within:border-ink flex items-center gap-3 rounded-full border-[3px] border-ink/15 p-2 pr-5 transition-colors"
              >
                <span
                  className="font-display flex size-11 shrink-0 items-center justify-center rounded-[38%] border-[3px] border-ink text-lg font-bold"
                  style={{ backgroundColor: color.base }}
                  aria-hidden="true"
                >
                  {index + 1}
                </span>
                <span className="sr-only">Player {index + 1} name</span>
                <input
                  value={names[index] ?? ""}
                  onChange={(e) => onNameChange(index, e.target.value)}
                  placeholder={defaultPlayerName(index)}
                  maxLength={MAX_NAME_LENGTH}
                  autoComplete="off"
                  autoFocus={index === 0}
                  disabled={loading}
                  className="placeholder:text-ink-soft/50 font-display min-w-0 flex-1 bg-transparent text-xl font-medium outline-none"
                />
              </label>
            );
          })}
        </div>

        {error && (
          <div
            role="alert"
            className="animate-toast-in bg-blush flex items-center gap-3 rounded-3xl border-[3px] border-crimson/40 px-4 py-3"
          >
            <TriangleAlert className="text-crimson size-6 shrink-0" strokeWidth={2.5} />
            <p className="flex-1 font-bold">{error}</p>
            <button
              type="submit"
              className="press bg-paper flex items-center gap-1.5 rounded-full border-[3px] border-ink px-3 py-1.5 text-sm font-extrabold"
            >
              <RotateCcw className="size-4" strokeWidth={3} />
              Retry
            </button>
          </div>
        )}

        <div className="flex gap-3">
          <button
            type="button"
            onClick={onBack}
            className="press bg-paper font-display flex h-16 items-center justify-center gap-2 rounded-full border-[3px] border-ink px-6 text-xl font-semibold"
          >
            <ArrowLeft className="size-6" strokeWidth={3} />
            Back
          </button>
          <button
            type="submit"
            disabled={loading}
            className="press bg-mint font-display flex h-16 flex-1 items-center justify-center gap-2 rounded-full border-[3px] border-ink text-2xl font-bold disabled:opacity-60"
          >
            <Play className="size-6 fill-current" strokeWidth={3} />
            Start Match
          </button>
        </div>
      </form>

      {loading && (
        <div className="animate-screen-in bg-cream/85 fixed inset-0 z-20 flex items-center justify-center backdrop-blur-sm">
          <CozyLoader title={`Picking a ${settings.difficulty.toLowerCase()} ${settings.genre} category`} onCancel={onCancelLoading} />
        </div>
      )}
    </main>
  );
}

function SummaryChip({
  icon,
  className,
  children,
}: {
  icon: ReactNode;
  className: string;
  children: ReactNode;
}) {
  return (
    <span
      className={`flex max-w-full items-center gap-1.5 rounded-full border-2 border-ink/20 px-3 py-1 text-sm font-extrabold ${className}`}
    >
      {icon}
      <span className="truncate">{children}</span>
    </span>
  );
}
