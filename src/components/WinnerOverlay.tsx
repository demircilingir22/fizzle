"use client";

import { Crown, House, LoaderCircle, RotateCcw, TriangleAlert } from "lucide-react";
import type { CSSProperties } from "react";
import { BombMascot } from "@/components/Logo";
import { formatClock, playerColor, type GamePlayer } from "@/lib/game";

// Deterministic pseudo-random so confetti layout is identical on every render.
const rand = (i: number, salt: number) => {
  const x = Math.sin(i * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
};
const CONFETTI_COLORS = ["#bfead5", "#d8cbf6", "#ffd2b5", "#bfe0fa", "#fff0a8", "#ffc8dc", "#ff8a73"];
const CONFETTI = Array.from(
  { length: 42 },
  (_, i) =>
    ({
      "--x": `${(rand(i, 1) * 100).toFixed(1)}%`,
      "--w": `${(8 + rand(i, 2) * 8).toFixed(1)}px`,
      "--color": CONFETTI_COLORS[i % CONFETTI_COLORS.length],
      "--duration": `${(3.2 + rand(i, 3) * 2.6).toFixed(2)}s`,
      "--delay": `${(-rand(i, 4) * 5).toFixed(2)}s`,
      "--drift": `${((rand(i, 5) - 0.5) * 160).toFixed(0)}px`,
      "--spin": `${(360 + rand(i, 6) * 720).toFixed(0)}deg`,
    }) as CSSProperties,
);

type WinnerOverlayProps = {
  players: GamePlayer[];
  winner: number | null;
  /** Elimination order, first out first. */
  eliminated: number[];
  winnerTimeMs: number;
  totalAnswers: number;
  onPlayAgain: () => void;
  onHome: () => void;
  loading: boolean;
  error: string | null;
};

export function WinnerOverlay({
  players,
  winner,
  eliminated,
  winnerTimeMs,
  totalAnswers,
  onPlayAgain,
  onHome,
  loading,
  error,
}: WinnerOverlayProps) {
  const champion = winner === null ? null : players[winner];
  const color = playerColor(winner ?? 0);
  // Winner first, then the rest in reverse elimination order.
  const standings = winner === null ? [...eliminated].reverse() : [winner, ...[...eliminated].reverse()];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="winner-title"
      className="animate-screen-in bg-cream/80 fixed inset-0 z-40 flex items-center justify-center overflow-hidden p-4 backdrop-blur-sm"
    >
      <div aria-hidden="true">
        {CONFETTI.map((style, i) => (
          <span key={i} className="confetti" style={style} />
        ))}
      </div>

      <div className="bg-paper animate-pop-in relative flex max-h-full w-full max-w-md flex-col items-center gap-4 overflow-y-auto rounded-[2.5rem] border-[3px] border-ink p-6 text-center shadow-[0_10px_0_0_rgb(61_44_70/0.2)] sm:p-8">
        <div className="relative">
          <Crown
            className="text-butter absolute -top-7 left-1/2 size-12 -translate-x-1/2 rotate-[-8deg] fill-current drop-shadow-[0_2px_0_#3d2c46]"
            strokeWidth={2}
            stroke="#3d2c46"
            aria-hidden="true"
          />
          <BombMascot className="animate-float size-28" color={color.base} />
        </div>

        <div>
          <p className="text-ink-soft text-sm font-extrabold tracking-widest uppercase">Last bomb standing</p>
          <h2 id="winner-title" className="font-display mt-1 text-4xl leading-tight font-bold sm:text-5xl">
            {champion ? (
              <>
                <span style={{ color: color.deep }}>{champion.name}</span> wins!
              </>
            ) : (
              "Nobody survived!"
            )}
          </h2>
        </div>

        {champion && (
          <div className="flex flex-wrap justify-center gap-2 text-sm font-extrabold">
            <span className="bg-mint rounded-full border-2 border-ink/15 px-3 py-1">
              {formatClock(winnerTimeMs)}s left on the fuse
            </span>
            <span className="bg-lavender rounded-full border-2 border-ink/15 px-3 py-1">
              {champion.answers} {champion.answers === 1 ? "answer" : "answers"}
            </span>
            <span className="bg-peach rounded-full border-2 border-ink/15 px-3 py-1">{totalAnswers} named in total</span>
          </div>
        )}

        {players.length > 2 && (
          <ol className="w-full space-y-1.5 text-left">
            {standings.map((playerIndex, place) => (
              <li
                key={playerIndex}
                className="flex items-center gap-3 rounded-2xl px-3 py-1.5 font-bold"
                style={{ backgroundColor: place === 0 && champion ? playerColor(playerIndex).base : "var(--color-cream)" }}
              >
                <span className="font-display w-6 text-center text-lg">{place + 1}</span>
                <span className="flex-1 truncate">{players[playerIndex].name}</span>
                <span className="text-ink-soft text-sm">{players[playerIndex].answers} ✓</span>
              </li>
            ))}
          </ol>
        )}

        {error && (
          <p role="alert" className="bg-blush flex items-center gap-2 rounded-2xl px-3 py-2 text-left text-sm font-bold">
            <TriangleAlert className="text-crimson size-5 shrink-0" strokeWidth={2.5} />
            {error}
          </p>
        )}

        <div className="flex w-full flex-col gap-3 sm:flex-row">
          <button
            type="button"
            onClick={onPlayAgain}
            disabled={loading}
            autoFocus
            className="press bg-mint font-display flex h-14 flex-1 items-center justify-center gap-2 rounded-full border-[3px] border-ink text-xl font-bold disabled:opacity-70"
          >
            {loading ? (
              <>
                <LoaderCircle className="size-6 animate-spin" strokeWidth={3} /> New category…
              </>
            ) : (
              <>
                <RotateCcw className="size-6" strokeWidth={3} /> Play Again
              </>
            )}
          </button>
          <button
            type="button"
            onClick={onHome}
            className="press bg-paper font-display flex h-14 items-center justify-center gap-2 rounded-full border-[3px] border-ink px-6 text-xl font-semibold"
          >
            <House className="size-5" strokeWidth={3} /> Home
          </button>
        </div>
      </div>
    </div>
  );
}
