"use client";

import { useRef, useState } from "react";
import { GameScreen } from "@/components/GameScreen";
import { HomeScreen } from "@/components/HomeScreen";
import { PlayerNamesScreen } from "@/components/PlayerNamesScreen";
import {
  DEFAULT_SETTINGS,
  MAX_AVOID_CATEGORIES,
  MAX_PLAYERS,
  defaultPlayerName,
  fetchTopic,
  type Difficulty,
  type Match,
  type Settings,
  type Topic,
} from "@/lib/game";

type Screen = "home" | "names" | "game";

type TopicRequest = { key: string; promise: Promise<Topic> };

const genreKey = (genre: string) => genre.trim().toLowerCase();
const topicKey = (genre: string, difficulty: Difficulty) => `${difficulty}|${genreKey(genre)}`;

export default function Home() {
  const [screen, setScreen] = useState<Screen>("home");
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [names, setNames] = useState<string[]>(() => Array<string>(MAX_PLAYERS).fill(""));
  const [match, setMatch] = useState<Match | null>(null);
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

  async function startMatch(matchSettings: Settings, playerNames: string[]) {
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
      playedCategories.current.set(genre, [...played, topic.category].slice(-MAX_AVOID_CATEGORIES));
      setMatch((previous) => ({ id: (previous?.id ?? 0) + 1, settings: matchSettings, topic, playerNames }));
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
    setScreen("home");
  }

  if (screen === "game" && match) {
    return (
      <GameScreen
        key={match.id}
        match={match}
        onHome={goHome}
        onPlayAgain={() => startMatch(match.settings, match.playerNames)}
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
          const playerNames = names
            .slice(0, settings.playerCount)
            .map((name, i) => name.trim() || defaultPlayerName(i));
          startMatch(settings, playerNames);
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
      onSubmit={() => {
        const genre = settings.genre.trim();
        setSettings((current) => ({ ...current, genre }));
        // Start generating the category now so it's ready when names are in.
        requestTopic(genre, settings.difficulty);
        setLoadError(null);
        setScreen("names");
      }}
    />
  );
}
