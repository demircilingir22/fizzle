"use client";

import { KeyRound, LogOut, Users } from "lucide-react";
import { useEffect, useEffectEvent, useState } from "react";
import { CozyLoader } from "@/components/CozyLoader";
import { BombMascot } from "@/components/Logo";
import { HomeScreen } from "@/components/HomeScreen";
import { OnlineGameScreen } from "@/components/online/OnlineGameScreen";
import { OnlineLobby } from "@/components/online/OnlineLobby";
import { JoinCodeScreen, NameEntryScreen, OnlineEntryScreen, WaitingScreen } from "@/components/online/OnlineScreens";
import { SettingsSummary, SummaryChip } from "@/components/ui";
import { DEFAULT_SETTINGS, MAX_PLAYERS, playerColor, type Settings } from "@/lib/game";
import { getPlayerId, savedRoom } from "@/lib/identity";
import { roomApi, type RoomPlayer, type RoomSettings, type RoomView } from "@/lib/online";
import { useRoom } from "@/lib/useRoom";

type Step =
  | { name: "entry" }
  | { name: "host-setup" }
  | { name: "host-name" }
  /** Opened from an invite link (?room=ABCD): checking the room before asking for a name. */
  | { name: "invite"; code: string }
  | { name: "join-code"; code?: string }
  | { name: "join-name"; preview: RoomView }
  | { name: "room"; code: string; initial: RoomView | null };

const errorMessage = (err: unknown, fallback: string) => (err instanceof Error ? err.message : fallback);

/** Looks a code up before joining. Throws (with a player-facing message) if it's missing or full. */
async function checkRoomCode(code: string): Promise<RoomView> {
  const preview = await roomApi.get(code, getPlayerId());
  if (!preview.you && preview.players.length >= MAX_PLAYERS) {
    throw new Error(`Room ${code} is full (${MAX_PLAYERS} players max).`);
  }
  return preview;
}

const toRoomSettings = ({ genre, difficulty, seconds }: Settings): RoomSettings => ({
  genre: genre.trim(),
  difficulty,
  seconds,
});

type OnlineGameProps = {
  /** Room code from an invite link, to join right away. */
  inviteCode: string | null;
  /** Room this tab was in before a reload. */
  resumeCode: string | null;
  onExit: () => void;
};

/** Online multiplayer: create/join a room, then the lobby and synced matches. */
export function OnlineGame({ inviteCode, resumeCode, onExit }: OnlineGameProps) {
  const [step, setStep] = useState<Step>(() =>
    inviteCode
      ? { name: "invite", code: inviteCode }
      : resumeCode
        ? { name: "room", code: resumeCode, initial: null }
        : { name: "entry" },
  );
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** Why the player was sent back to the entry screen. */
  const [notice, setNotice] = useState<string | null>(null);

  function go(next: Step, nextError: string | null = null) {
    setError(nextError);
    setBusy(false);
    setStep(next);
  }

  function enterRoom(view: RoomView) {
    savedRoom.set(view.code);
    setNotice(null);
    go({ name: "room", code: view.code, initial: view });
  }

  function openPreview(preview: RoomView) {
    // Already in this room from this tab (went back by mistake, or opened their own invite): walk straight in.
    if (preview.you) enterRoom(preview);
    else go({ name: "join-name", preview });
  }

  const finishInvite = useEffectEvent((code: string, result: { preview: RoomView } | { error: unknown }) => {
    if ("preview" in result) openPreview(result.preview);
    // Show the code on the join screen so they can fix a typo or try again.
    else go({ name: "join-code", code }, errorMessage(result.error, "Couldn't find that room. Try again!"));
  });

  const inviteStepCode = step.name === "invite" ? step.code : null;
  useEffect(() => {
    if (!inviteStepCode) return;
    // Following an invite to another room means leaving the one this tab was in.
    if (resumeCode && resumeCode !== inviteStepCode) {
      roomApi.leave(resumeCode, getPlayerId()).catch(() => {});
      savedRoom.clear();
    }
    let cancelled = false;
    checkRoomCode(inviteStepCode).then(
      (preview) => !cancelled && finishInvite(inviteStepCode, { preview }),
      (error: unknown) => !cancelled && finishInvite(inviteStepCode, { error }),
    );
    return () => {
      cancelled = true;
    };
  }, [inviteStepCode, resumeCode]);

  async function run(task: () => Promise<void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      await task();
    } catch (err) {
      setError(errorMessage(err, fallback));
      setBusy(false);
    }
  }

  switch (step.name) {
    case "entry":
      return (
        <OnlineEntryScreen
          onCreate={() => go({ name: "host-setup" })}
          onJoin={() => go({ name: "join-code" })}
          onBack={onExit}
          notice={notice}
        />
      );

    case "host-setup":
      return (
        <HomeScreen
          settings={settings}
          onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
          onBack={() => go({ name: "entry" })}
          hidePlayerCount
          submitLabel="Continue to your name"
          banner={
            <p className="bg-peach rounded-full border-2 border-ink/15 px-4 py-1 text-sm font-extrabold">
              Hosting an online room · 2 to {MAX_PLAYERS} players
            </p>
          }
          onSubmit={() => {
            setSettings((current) => ({ ...current, genre: current.genre.trim() }));
            go({ name: "host-name" });
          }}
        />
      );

    case "host-name":
      return (
        <NameEntryScreen
          title="What's your name?"
          summary={<SettingsSummary {...toRoomSettings(settings)} />}
          submitLabel="Create room"
          onBack={() => go({ name: "host-setup" })}
          loading={busy}
          error={error}
          onSubmit={(name) =>
            run(async () => enterRoom(await roomApi.create(getPlayerId(), name, toRoomSettings(settings))), "Couldn't create the room. Try again!")
          }
        />
      );

    case "invite":
      return (
        <Centered>
          <BombMascot className="animate-float size-28" color="#bfe0fa" />
          <p role="status" className="font-display text-2xl font-semibold">
            Opening your invite to room <span className="tracking-wider">{step.code}</span>…
          </p>
          <button
            type="button"
            onClick={() => go({ name: "entry" })}
            className="text-ink-soft hover:text-ink text-sm font-bold underline underline-offset-4"
          >
            Cancel
          </button>
        </Centered>
      );

    case "join-code":
      return (
        <JoinCodeScreen
          initialCode={step.code}
          onBack={() => go({ name: "entry" })}
          loading={busy}
          error={error}
          onSubmit={(code) =>
            run(async () => openPreview(await checkRoomCode(code)), "Couldn't find that room. Try again!")
          }
        />
      );

    case "join-name": {
      const { preview } = step;
      return (
        <NameEntryScreen
          title="What's your name?"
          summary={
            <div className="flex flex-col items-center gap-2">
              <div className="flex flex-wrap justify-center gap-2">
                <SummaryChip icon={<KeyRound className="size-4" strokeWidth={2.5} />} className="bg-sky tracking-wider">
                  Room {preview.code}
                </SummaryChip>
                <SummaryChip icon={<Users className="size-4" strokeWidth={2.5} />} className="bg-mint">
                  {preview.players.length} in the room
                </SummaryChip>
              </div>
              <SettingsSummary {...preview.settings} />
            </div>
          }
          submitLabel="Join room"
          onBack={() => go({ name: "join-code", code: preview.code })}
          loading={busy}
          error={error}
          onSubmit={(name) =>
            run(async () => enterRoom(await roomApi.join(preview.code, getPlayerId(), name)), "Couldn't join the room. Try again!")
          }
        />
      );
    }

    case "room":
      return (
        <RoomSession
          key={step.code}
          code={step.code}
          initial={step.initial}
          onLeave={() => {
            roomApi.leave(step.code, getPlayerId()).catch(() => {});
            onExit();
          }}
          onGone={(message) => {
            savedRoom.clear();
            setNotice(message);
            go({ name: "entry" });
          }}
        />
      );
  }
}

type RoomSessionProps = {
  code: string;
  initial: RoomView | null;
  onLeave: () => void;
  onGone: (message: string) => void;
};

/** Everything inside a room, driven by the polled room status. */
function RoomSession({ code, initial, onLeave, onGone }: RoomSessionProps) {
  const { room, offline, act, serverNow } = useRoom(code, initial, onGone);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** The host's pick for "New Genre (Same Players)"; null until they touch the form. */
  const [draft, setDraft] = useState<Settings | null>(null);

  async function perform(run: (code: string, playerId: string) => Promise<RoomView>, fallback: string) {
    setBusy(true);
    setActionError(null);
    try {
      await act(run);
    } catch (err) {
      setActionError(errorMessage(err, fallback));
    } finally {
      setBusy(false);
    }
  }

  if (!room) {
    return (
      <Centered>
        <CozyLoader title={`Rejoining room ${code}`} />
        <LeaveLink onLeave={onLeave} />
      </Centered>
    );
  }

  const isHost = room.you === room.hostId;
  const host = room.players.find((p) => p.isHost);

  if (room.status === "lobby") {
    return (
      <OnlineLobby
        room={room}
        onStart={() => perform((c, p) => roomApi.start(c, p), "Couldn't start the game. Try again!")}
        onLeave={onLeave}
        starting={busy}
        error={room.notice ?? actionError}
      />
    );
  }

  if (room.status === "changing_settings") {
    if (!isHost) {
      return (
        <WaitingScreen title="Host is choosing a new genre..." onLeave={onLeave}>
          <p className="text-ink-soft font-semibold">
            {host?.name ?? "The host"} is picking the next genre. Same players, fresh fuses.
          </p>
          <RosterChips players={room.players} />
        </WaitingScreen>
      );
    }
    const form = draft ?? { ...DEFAULT_SETTINGS, ...room.settings, genre: "", playerCount: room.players.length };
    return (
      <HomeScreen
        settings={form}
        onChange={(patch) => setDraft({ ...form, ...patch })}
        onBack={() => perform((c, p) => roomApi.replay(c, p, "cancel_genre"), "Couldn't go back. Try again!")}
        hidePlayerCount
        submitLabel="Start the match with the same players"
        banner={<RosterChips players={room.players} label="Same players, new genre" />}
        loading={busy}
        error={room.notice ?? actionError}
        onSubmit={() => {
          setDraft(null);
          perform((c, p) => roomApi.replay(c, p, "new_genre", toRoomSettings(form)), "Couldn't start the match. Try again!");
        }}
      />
    );
  }

  const match = room.match;
  const showGame = match && (room.status === "playing" || (room.status === "loading" && room.loadingFrom === "replay"));

  if (!showGame) {
    const { genre, difficulty } = room.settings;
    return (
      <Centered>
        <CozyLoader title={`Picking a ${difficulty.toLowerCase()} ${genre} category`} />
        <LeaveLink onLeave={onLeave} />
      </Centered>
    );
  }

  return (
    <OnlineGameScreen
      key={match.id}
      room={room}
      match={match}
      serverNow={serverNow}
      offline={offline}
      onSubmit={(submission) => act((c, p) => roomApi.submit(c, p, submission))}
      onPause={(paused) => act((c, p) => roomApi.pause(c, p, paused))}
      onTimeout={() => {
        act((c, p) => roomApi.timeout(c, p)).catch(() => {});
      }}
      onReplay={() => perform((c, p) => roomApi.replay(c, p, "same_genre"), "Couldn't start a rematch. Try again!")}
      onNewGenre={() => {
        setDraft(null);
        perform((c, p) => roomApi.replay(c, p, "choose_genre"), "Couldn't change the genre. Try again!");
      }}
      onLeave={onLeave}
      actionError={actionError}
    />
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="animate-screen-in flex flex-1 flex-col items-center justify-center gap-6 px-4 py-10">
      {children}
    </main>
  );
}

function LeaveLink({ onLeave }: { onLeave: () => void }) {
  return (
    <button
      type="button"
      onClick={onLeave}
      className="text-ink-soft hover:text-ink flex items-center gap-1.5 text-sm font-bold underline underline-offset-4"
    >
      <LogOut className="size-4" strokeWidth={2.5} /> Leave Lobby
    </button>
  );
}

function RosterChips({ players, label }: { players: RoomPlayer[]; label?: string }) {
  return (
    <div className="flex flex-col items-center gap-2">
      {label && (
        <p className="text-ink-soft flex items-center gap-1.5 text-xs font-extrabold tracking-wider uppercase">
          <Users className="size-4" strokeWidth={2.5} /> {label}
        </p>
      )}
      <ul className="flex flex-wrap justify-center gap-1.5">
        {players.map((player) => (
          <li
            key={player.id}
            className="max-w-36 truncate rounded-full border-2 border-ink/15 px-3 py-0.5 text-sm font-bold"
            style={{ backgroundColor: playerColor(player.color).base }}
          >
            {player.name}
          </li>
        ))}
      </ul>
    </div>
  );
}
