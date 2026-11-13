"use client";

import { Check, Copy, Crown, Hourglass, LoaderCircle, Play, UserPlus, WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { BombMascot } from "@/components/Logo";
import { BackButton, ErrorBanner, SettingsSummary } from "@/components/ui";
import { MAX_PLAYERS, MIN_PLAYERS, playerColor } from "@/lib/game";
import type { RoomView } from "@/lib/online";

type OnlineLobbyProps = {
  room: RoomView;
  onStart: () => void;
  onLeave: () => void;
  starting: boolean;
  error: string | null;
};

async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // The async clipboard API needs a secure context; fall back for plain-http LAN play.
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.appendChild(area);
    area.select();
    const ok = document.execCommand("copy");
    area.remove();
    return ok;
  }
}

export function OnlineLobby({ room, onStart, onLeave, starting, error }: OnlineLobbyProps) {
  const isHost = room.you === room.hostId;
  const host = room.players.find((p) => p.isHost);
  const enough = room.players.length >= MIN_PLAYERS;
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 1600);
    return () => clearTimeout(timer);
  }, [copied]);

  return (
    <main className="animate-screen-in mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-6 px-4 py-8">
      <div className="-mb-2 w-full">
        <BackButton onClick={onLeave} label="Leave" />
      </div>

      {/* Room code */}
      <section
        aria-label="Room code"
        className="bg-paper flex w-full flex-col items-center gap-2 rounded-[2.25rem] border-[3px] border-ink px-5 py-5 text-center shadow-[0_8px_0_0_rgb(61_44_70/0.18)]"
      >
        <p className="text-ink-soft text-xs font-extrabold tracking-widest uppercase">Room code</p>
        <div className="flex items-center gap-3">
          <span className="font-display text-coral pl-[0.3em] text-6xl font-bold tracking-[0.3em] [text-shadow:0_4px_0_var(--color-ink)] sm:text-7xl">
            {room.code}
          </span>
          <button
            type="button"
            onClick={async () => setCopied(await copyText(room.code))}
            aria-label={copied ? "Room code copied" : "Copy room code"}
            className="press bg-butter flex h-12 items-center gap-1.5 rounded-full border-[3px] border-ink px-4 text-sm font-extrabold"
          >
            {copied ? <Check className="size-5" strokeWidth={3} /> : <Copy className="size-5" strokeWidth={2.5} />}
            {copied ? "Copied!" : "Copy"}
          </button>
        </div>
        <p className="text-ink-soft text-sm font-semibold">Friends join from Online Multiplayer → Join Room.</p>
        <SettingsSummary
          genre={room.settings.genre}
          difficulty={room.settings.difficulty}
          seconds={room.settings.seconds}
        />
      </section>

      {/* Players */}
      <section aria-label="Players" className="w-full">
        <h2 className="text-ink-soft mb-2 flex items-center justify-between px-2 text-sm font-extrabold tracking-wider uppercase">
          <span>Players</span>
          <span aria-live="polite">
            {room.players.length} / {MAX_PLAYERS}
          </span>
        </h2>
        <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {room.players.map((player) => {
            const color = playerColor(player.color);
            const isYou = player.id === room.you;
            return (
              <li
                key={player.id}
                className={`animate-pop-in relative flex flex-col items-center gap-1 rounded-[1.75rem] border-[3px] px-2 pt-3 pb-2.5 ${
                  isYou ? "border-ink" : "border-ink/15"
                } ${player.away ? "opacity-60" : ""}`}
                style={{ backgroundColor: color.base }}
              >
                {player.isHost && (
                  <span className="bg-butter absolute -top-2.5 -left-1.5 flex -rotate-[8deg] items-center gap-1 rounded-full border-2 border-ink px-2 py-0.5 text-xs font-extrabold">
                    <Crown className="size-3.5" strokeWidth={2.5} /> Host
                  </span>
                )}
                <BombMascot className="size-14" color={color.base} />
                <span className="font-display w-full truncate text-center text-lg leading-tight font-semibold">
                  {player.name}
                </span>
                <span className="text-xs font-extrabold" style={{ color: color.deep }}>
                  {isYou ? "You" : player.away ? (
                    <span className="flex items-center gap-1">
                      <WifiOff className="size-3" strokeWidth={3} /> Away
                    </span>
                  ) : (
                    "Ready"
                  )}
                </span>
              </li>
            );
          })}
          {room.players.length < MAX_PLAYERS && (
            <li className="text-ink-soft/70 flex min-h-36 flex-col items-center justify-center gap-1 rounded-[1.75rem] border-[3px] border-dashed border-ink/15 p-2 text-center text-sm font-bold">
              <UserPlus className="size-6" strokeWidth={2.5} />
              Waiting for players…
            </li>
          )}
        </ul>
      </section>

      {error && <ErrorBanner>{error}</ErrorBanner>}

      {isHost ? (
        <div className="flex w-full flex-col items-center gap-2">
          <button
            type="button"
            onClick={onStart}
            disabled={!enough || starting}
            className="press bg-mint font-display flex h-16 w-full max-w-sm items-center justify-center gap-2 rounded-full border-[3px] border-ink text-2xl font-bold disabled:cursor-not-allowed disabled:opacity-50"
          >
            {starting ? (
              <LoaderCircle className="size-6 animate-spin" strokeWidth={3} />
            ) : (
              <Play className="size-6 fill-current" strokeWidth={3} />
            )}
            {starting ? "Starting…" : "Start Game"}
          </button>
          {!enough && (
            <p className="text-ink-soft text-sm font-bold">Need at least {MIN_PLAYERS} players to start.</p>
          )}
        </div>
      ) : (
        <p
          role="status"
          className="bg-paper flex items-center gap-2 rounded-full border-[3px] border-ink/15 px-5 py-2.5 font-bold motion-safe:animate-pulse"
        >
          <Hourglass className="size-5" strokeWidth={2.5} />
          Waiting for {host ? host.name : "the host"} to start the game...
        </p>
      )}
    </main>
  );
}
