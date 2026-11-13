"use client";

import { Users } from "lucide-react";
import { useRef, useState } from "react";
import { GameScreen } from "@/components/GameScreen";
import { HomeScreen } from "@/components/HomeScreen";
import { PlayerNamesScreen } from "@/components/PlayerNamesScreen";
import {
  DEFAULT_SETTINGS,
  MAX_PLAYERS,
  MAX_PREVIOUS_CATEGORIES,
  defaultPlayerName,
  fetchTopic,
  playerColor,
  type Difficulty,
  type LocalPlayer,
  type Match,
  type Settings,
  type Topic,
} from "@/lib/game";
import { shuffle } from "@/lib/shuffle";

type Screen = "home" | "names" | "game";

type TopicRequest = { key: string; promise: Promise<Topic> };

const genreKey = (genre: string) => genre.trim().toLowerCase();
const topicKey = (genre: string, difficulty: Difficulty) => `${difficulty}|${genreKey(genre)}`;

/** Local pass-and-play: genre → player names → game, with rematches. */
export function LocalGame({ onExit }: { onExit: () => void }) {
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [names, setNames] = useState<string[]>(() => Array<string>(MAX_PLAYERS).fill(""));
  const [match, setMatch] = useState<Match | null>(null);
  /** Players kept from the last match by "New Genre (Same Players)"; null when picking players. */
  const [roster, setRoster] = useState<LocalPlayer[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  /** A topic request that hasn't been used by a match yet (prefetched or in flight). */
  const pendingTopic = useRef<TopicRequest | null>(null);
  /** Bumped to cancel an in-progress "start match" so a late topic is ignored. */
  const loadToken = useRef(0);
  /** Categories already played this session, per genre, so new matches don't repeat them. */
  const playedCategories = useRef(new Map<string, string[]>());

  function requestTopic(genre: string, difficulty: Difficulty): TopicRequest {
    const key = topicKey(genre, difficulty);
    const pending = pendingTopic.current;
    if (pending?.key === key) return pending;

    const played = playedCategories.current.get(genreKey(genre)) ?? [];
    const request: TopicRequest = { key, promise: fetchTopic(genre, difficulty, played) };
    // A failed request is forgotten so the next attempt fetches again.
    request.promise.catch(() => {
      if (pendingTopic.current === request) pendingTopic.current = null;
    });
    pendingTopic.current = request;
    return request;
  }

  async function startMatch(matchSettings: Settings, players: LocalPlayer[]) {
    const token = ++loadToken.current;
    setLoading(true);
    setLoadError(null);

    const request = requestTopic(matchSettings.genre, matchSettings.difficulty);
    try {
      const topic = await request.promise;
      if (token !== loadToken.current) return;
      if (pendingTopic.current === request) pendingTopic.current = null;
      const genre = genreKey(matchSettings.genre);
      const played = playedCategories.current.get(genre) ?? [];
      playedCategories.current.set(genre, [...played, topic.category].slice(-MAX_PREVIOUS_CATEGORIES));
      // Fresh random turn order (and starting player) every match.
      const order = shuffle(players);
      setMatch((previous) => ({ id: (previous?.id ?? 0) + 1, settings: matchSettings, topic, players: order }));
      setRoster(null);
      setScreen("game");
    } catch (err) {
      if (token !== loadToken.current) return;
      setLoadError(err instanceof Error ? err.message : "Couldn't pick a category. Try again!");
    } finally {
      if (token === loadToken.current) setLoading(false);
    }
  }

  function cancelLoading() {
    loadToken.current += 1;
    setLoading(false);
  }

  function goHome() {
    cancelLoading();
    setLoadError(null);
    setRoster(null);
    setScreen("home");
  }

  /** Post-game: back to the genre screen, keeping everyone (seat order restored). */
  function chooseNewGenre(players: LocalPlayer[]) {
    cancelLoading();
    setLoadError(null);
    setRoster([...players].sort((a, b) => a.color - b.color));
    setSettings((current) => ({ ...current, genre: "", playerCount: players.length }));
    setScreen("home");
  }

  /** Leave "same players" mode and pick players again, starting from the current names. */
  function editRoster(players: LocalPlayer[]) {
    setNames((current) => current.map((name, i) => players.find((p) => p.color === i)?.name ?? name));
    setSettings((current) => ({ ...current, playerCount: players.length }));
    setRoster(null);
  }

  if (screen === "game" && match) {
    return (
      <GameScreen
        key={match.id}
        match={match}
        onHome={goHome}
        onReplay={() => startMatch(match.settings, match.players)}
        onNewGenre={() => chooseNewGenre(match.players)}
        onLeave={onExit}
        onMatchOver={() => requestTopic(match.settings.genre, match.settings.difficulty)}
        rematchLoading={loading}
        rematchError={loadError}
      />
    );
  }

  if (screen === "names") {
    return (
      <PlayerNamesScreen
        settings={settings}
        names={names}
        onNameChange={(index, name) => setNames((current) => current.map((n, i) => (i === index ? name : n)))}
        onBack={goHome}
        onStart={() => {
          const players = names
            .slice(0, settings.playerCount)
            .map((name, i) => ({ name: name.trim() || defaultPlayerName(i), color: i }));
          startMatch(settings, players);
        }}
        onCancelLoading={cancelLoading}
        loading={loading}
        error={loadError}
      />
    );
  }

  return (
    <HomeScreen
      settings={settings}
      onChange={(patch) => setSettings((current) => ({ ...current, ...patch }))}
      onBack={onExit}
      hidePlayerCount={roster !== null}
      submitLabel={roster ? "Start the match with the same players" : "Continue to player names"}
      banner={roster && <RosterBanner players={roster} onEdit={() => editRoster(roster)} />}
      loading={loading}
      onCancelLoading={cancelLoading}
      error={roster ? loadError : null}
      onSubmit={() => {
        const genre = settings.genre.trim();
        const next = { ...settings, genre };
        setSettings(next);
        setLoadError(null);
        if (roster) {
          // Same players: skip the names screen and go straight to the match.
          startMatch({ ...next, playerCount: roster.length }, roster);
          return;
        }
        // Start generating the category now so it's ready when names are in.
        requestTopic(genre, settings.difficulty);
        setScreen("names");
      }}
    />
  );
}

function RosterBanner({ players, onEdit }: { players: LocalPlayer[]; onEdit: () => void }) {
  return (
    <div className="bg-paper/90 flex flex-col items-center gap-2 rounded-[1.75rem] border-[3px] border-ink/10 px-4 py-3">
      <p className="text-ink-soft flex items-center gap-1.5 text-xs font-extrabold tracking-wider uppercase">
        <Users className="size-4" strokeWidth={2.5} /> Same players, new genre
      </p>
      <ul className="flex flex-wrap justify-center gap-1.5">
        {players.map((player) => (
          <li
            key={player.color}
            className="max-w-36 truncate rounded-full border-2 border-ink/15 px-3 py-0.5 text-sm font-bold"
            style={{ backgroundColor: playerColor(player.color).base }}
          >
            {player.name}
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={onEdit}
        className="text-ink-soft hover:text-ink text-xs font-bold underline underline-offset-4"
      >
        Change players
      </button>
    </div>
  );
}
