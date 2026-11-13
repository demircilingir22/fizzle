"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { LocalGame } from "@/components/LocalGame";
import { ModeSelectScreen } from "@/components/ModeSelectScreen";
import { OnlineGame } from "@/components/online/OnlineGame";
import { guardDuplicateTabs, savedRoom } from "@/lib/identity";

type Mode = "select" | "local" | "online";

const subscribeNever = () => () => {};

export default function Home() {
  /** null until the player picks a mode; until then a saved room (after a reload) resumes online play. */
  const [mode, setMode] = useState<Mode | null>(null);
  const resumeCode = useSyncExternalStore(subscribeNever, savedRoom.get, () => null);

  // A duplicated tab gets a fresh player id; send it back to the start if it was resuming a copied room.
  useEffect(() => guardDuplicateTabs(() => setMode((current) => (current === "local" ? current : "select"))), []);

  const current: Mode = mode ?? (resumeCode ? "online" : "select");

  function exitToModeSelect() {
    savedRoom.clear();
    setMode("select");
  }

  if (current === "local") return <LocalGame onExit={exitToModeSelect} />;
  if (current === "online") {
    return <OnlineGame resumeCode={mode === null ? resumeCode : null} onExit={exitToModeSelect} />;
  }
  return <ModeSelectScreen onLocal={() => setMode("local")} onOnline={() => setMode("online")} />;
}
