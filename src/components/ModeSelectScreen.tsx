"use client";

import { Globe, Users } from "lucide-react";
import { GameLogo } from "@/components/Logo";
import { ChoiceCard } from "@/components/ui";

type ModeSelectScreenProps = {
  onLocal: () => void;
  onOnline: () => void;
};

/** First screen: pass one device around, or play from separate screens. */
export function ModeSelectScreen({ onLocal, onOnline }: ModeSelectScreenProps) {
  return (
    <main className="animate-screen-in mx-auto flex w-full max-w-2xl flex-1 flex-col items-center justify-center gap-8 px-4 py-10">
      <div className="flex flex-col items-center gap-3 text-center">
        <GameLogo />
        <p className="text-ink-soft text-base font-semibold sm:text-lg">
          Take turns naming things. Don&apos;t let your fuse burn out!
        </p>
      </div>

      <div className="grid w-full gap-4 sm:grid-cols-2">
        <ChoiceCard
          icon={Users}
          title="Local Multiplayer"
          description="2 to 8 players passing one screen around."
          color="bg-mint"
          onClick={onLocal}
          autoFocus
        />
        <ChoiceCard
          icon={Globe}
          title="Online Multiplayer"
          description="Everyone on their own screen, joined by a room code."
          color="bg-lavender"
          onClick={onOnline}
        />
      </div>
    </main>
  );
}
