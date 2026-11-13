"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { LocalGame } from "@/components/LocalGame";
import { ModeSelectScreen } from "@/components/ModeSelectScreen";
import { OnlineGame } from "@/components/online/OnlineGame";
import { guardDuplicateTabs, savedRoom } from "@/lib/identity";
import { isRoomCode } from "@/lib/online";
import { INVITE_PARAM } from "@/lib/site";

type Mode = "select" | "local" | "online";

/** What this page load should open: an invite link (?room=ABCD) or the room this tab was in before a reload. */
type Boot = { invite: string | null; resume: string | null };

const SERVER_BOOT: Boot = { invite: null, resume: null };
let clientBoot: Boot | null = null;

/** Read once per page load, so stripping ?room= from the URL afterwards doesn't change it. */
function readBoot(): Boot {
  if (!clientBoot) {
    const param = new URLSearchParams(window.location.search).get(INVITE_PARAM)?.trim().toUpperCase() ?? "";
    clientBoot = { invite: isRoomCode(param) ? param : null, resume: savedRoom.get() };
  }
  return clientBoot;
}

const subscribeNever = () => () => {};

export default function Home() {
  /** null until the player picks a mode; until then an invite link or a saved room decides. */
  const [mode, setMode] = useState<Mode | null>(null);
  const boot = useSyncExternalStore(subscribeNever, readBoot, () => SERVER_BOOT);

  // A duplicated tab gets a fresh player id; send it back to the start if it was resuming a copied room.
  useEffect(() => guardDuplicateTabs(() => setMode((current) => (current === "local" ? current : "select"))), []);

  // The invite has been read: drop ?room= so a reload or "Leave" doesn't open it again.
  useEffect(() => {
    if (!new URLSearchParams(window.location.search).has(INVITE_PARAM)) return;
    const url = new URL(window.location.href);
    url.searchParams.delete(INVITE_PARAM);
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  const current: Mode = mode ?? (boot.invite || boot.resume ? "online" : "select");

  function exitToModeSelect() {
    savedRoom.clear();
    setMode("select");
  }

  if (current === "local") return <LocalGame onExit={exitToModeSelect} />;
  if (current === "online") {
    return (
      <OnlineGame
        inviteCode={mode === null ? boot.invite : null}
        resumeCode={mode === null ? boot.resume : null}
        onExit={exitToModeSelect}
      />
    );
  }
  return <ModeSelectScreen onLocal={() => setMode("local")} onOnline={() => setMode("online")} />;
}
