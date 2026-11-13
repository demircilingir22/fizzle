/**
 * Client-side game model for Fizzle: settings, player colors, the match
 * reducer, and typed wrappers around the API routes.
 *
 * Nothing in here touches the AI SDK; the route types are imported as types only.
 */
import { nameVariantIds, toCanonicalId } from "@/lib/canonical";
import type { ValidateMoveResponse } from "@/lib/referee";
import type { GenerateTopicResponse } from "@/lib/topic";

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export const DIFFICULTIES = ["Easy", "Medium", "Hard"] as const;
export type Difficulty = (typeof DIFFICULTIES)[number];

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 8;
export const MIN_SECONDS = 15;
export const MAX_SECONDS = 120;
export const SECONDS_STEP = 5;

/** Limits mirror the API route validation. */
export const MAX_GENRE_LENGTH = 100;
export const MAX_ANSWER_LENGTH = 120;
export const MAX_NAME_LENGTH = 16;

export type Settings = {
  genre: string;
  difficulty: Difficulty;
  playerCount: number;
  seconds: number;
};

export const DEFAULT_SETTINGS: Settings = {
  genre: "",
  difficulty: "Easy",
  playerCount: 2,
  seconds: 60,
};

export type Topic = GenerateTopicResponse;
export type Verdict = ValidateMoveResponse;

/** A player in a local match. `color` is their seat color, kept through turn-order shuffles. */
export type LocalPlayer = { name: string; color: number };

/** Everything a match needs, frozen at the moment it starts. */
export type Match = {
  id: number;
  settings: Settings;
  topic: Topic;
  /** Players in this match's (shuffled) turn order. */
  players: LocalPlayer[];
};

export const defaultPlayerName = (index: number) => `Player ${index + 1}`;

// ---------------------------------------------------------------------------
// Player colors
// ---------------------------------------------------------------------------

export type PlayerColor = {
  /** Soft pastel used for the bomb body. */
  base: string;
  /** Deeper shade of the same hue for accents and text. */
  deep: string;
};

export const PLAYER_COLORS: PlayerColor[] = [
  { base: "#bfead5", deep: "#2f8a69" }, // mint
  { base: "#d8cbf6", deep: "#6d55c4" }, // lavender
  { base: "#ffd2b5", deep: "#c8612c" }, // peach
  { base: "#bfe0fa", deep: "#2f78b5" }, // sky
  { base: "#fff0a8", deep: "#a07c06" }, // butter
  { base: "#ffc8dc", deep: "#c2416f" }, // blush
  { base: "#d4e9c0", deep: "#55803a" }, // sage
  { base: "#b8ece8", deep: "#21858a" }, // aqua
];

export const playerColor = (index: number) => PLAYER_COLORS[index % PLAYER_COLORS.length];

const CORAL = "#ff8a73";
const CRIMSON = "#e03c4f";

/**
 * Bomb body color for a player with `fraction` (1 → 0) of their time left.
 * Blends pastel → coral over the first 60% of time used, then coral → crimson.
 */
export function bombColors(base: string, fraction: number): { fill: string; text: string } {
  const used = 1 - Math.min(1, Math.max(0, fraction));
  const fill =
    used <= 0.6
      ? `color-mix(in oklab, ${base}, ${CORAL} ${((used / 0.6) * 100).toFixed(1)}%)`
      : `color-mix(in oklab, ${CORAL}, ${CRIMSON} ${(((used - 0.6) / 0.4) * 100).toFixed(1)}%)`;
  return { fill, text: used > 0.82 ? "#fffaf3" : "#3d2c46" };
}

/** Clock readout in tenths, rounded up so "0.0" only shows once the fuse is out. */
export function formatClock(ms: number): string {
  return (Math.ceil(Math.max(0, ms) / 100) / 10).toFixed(1);
}

/** Grid shape for the bomb area: [columns, rows] on narrow and wide screens. */
export function gridShape(count: number): { narrow: [number, number]; wide: [number, number] } {
  const narrowCols = count <= 2 ? 1 : 2;
  const wideCols = count <= 4 ? count : count <= 6 ? 3 : 4;
  return {
    narrow: [narrowCols, Math.ceil(count / narrowCols)],
    wide: [wideCols, Math.ceil(count / wideCols)],
  };
}

// ---------------------------------------------------------------------------
// Match reducer (turn order, answers, eliminations). Clock time lives in the
// GameScreen's rAF loop, not here, so the reducer stays pure and cheap.
// ---------------------------------------------------------------------------

export type GamePhase = "countdown" | "playing" | "exploding" | "over";

export type GamePlayer = {
  name: string;
  /** Index into PLAYER_COLORS. */
  color: number;
  lastAnswer: string | null;
  answers: number;
  eliminated: boolean;
};

export type FeedItem = { canonicalId: string; displayName: string; player: number };

export type GameState = {
  phase: GamePhase;
  players: GamePlayer[];
  active: number;
  /** Canonical IDs the referee has accepted, sent back with every move. */
  usedCanonicalIds: string[];
  /** Normalized forms of accepted answers, for the instant client-side duplicate check. */
  usedKeys: string[];
  /** Accepted answers, newest first. */
  feed: FeedItem[];
  /** Player whose bomb is going off right now. */
  exploding: number | null;
  /** Elimination order, first out first. */
  eliminated: number[];
  winner: number | null;
};

export type GameAction =
  | { type: "start" }
  | { type: "accept"; player: number; canonicalId: string; displayName: string; submission: string }
  | { type: "explode"; player: number }
  | { type: "settle" };

export function initGame(players: LocalPlayer[]): GameState {
  return {
    phase: "countdown",
    players: players.map(({ name, color }) => ({ name, color, lastAnswer: null, answers: 0, eliminated: false })),
    active: 0,
    usedCanonicalIds: [],
    usedKeys: [],
    feed: [],
    exploding: null,
    eliminated: [],
    winner: null,
  };
}

/** Next player after `from` who is still in the game, wrapping around. */
export function nextSurvivor(players: readonly { eliminated: boolean }[], from: number): number {
  for (let step = 1; step <= players.length; step++) {
    const index = (from + step) % players.length;
    if (!players[index].eliminated) return index;
  }
  return from;
}

export function gameReducer(state: GameState, action: GameAction): GameState {
  switch (action.type) {
    case "start":
      return state.phase === "countdown" ? { ...state, phase: "playing" } : state;

    case "accept": {
      if (state.phase !== "playing" || action.player !== state.active) return state;
      const players = state.players.map((p, i) =>
        i === action.player ? { ...p, lastAnswer: action.displayName, answers: p.answers + 1 } : p,
      );
      // Includes both halves of names like "Gomu Gomu no Mi (Gum-Gum Fruit)" for the instant duplicate check.
      const keys = [action.canonicalId, toCanonicalId(action.submission), ...nameVariantIds(action.displayName)];
      return {
        ...state,
        players,
        active: nextSurvivor(players, action.player),
        usedCanonicalIds: [...state.usedCanonicalIds, action.canonicalId],
        usedKeys: [...new Set([...state.usedKeys, ...keys.filter(Boolean)])],
        feed: [
          { canonicalId: action.canonicalId, displayName: action.displayName, player: action.player },
          ...state.feed,
        ],
      };
    }

    case "explode": {
      if (state.phase !== "playing" || state.players[action.player].eliminated) return state;
      return {
        ...state,
        phase: "exploding",
        exploding: action.player,
        eliminated: [...state.eliminated, action.player],
        players: state.players.map((p, i) => (i === action.player ? { ...p, eliminated: true } : p)),
      };
    }

    case "settle": {
      if (state.phase !== "exploding" || state.exploding === null) return state;
      const survivors = state.players.flatMap((p, i) => (p.eliminated ? [] : [i]));
      if (survivors.length <= 1) {
        return { ...state, phase: "over", exploding: null, winner: survivors[0] ?? null };
      }
      return {
        ...state,
        phase: "playing",
        exploding: null,
        active: nextSurvivor(state.players, state.exploding),
      };
    }
  }
}

// ---------------------------------------------------------------------------
// API client
// ---------------------------------------------------------------------------

async function postJson(url: string, body: unknown, signal?: AbortSignal): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new Error("Couldn't reach the server. Check your connection and try again.");
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return data;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Most recent categories sent as `previousCategories` (the route accepts up to 20). */
export const MAX_PREVIOUS_CATEGORIES = 20;

export async function fetchTopic(
  genre: string,
  difficulty: Difficulty,
  previousCategories: string[] = [],
  signal?: AbortSignal,
): Promise<Topic> {
  const data = await postJson(
    "/api/generate-topic",
    { genre, difficulty, previousCategories: previousCategories.slice(-MAX_PREVIOUS_CATEGORIES) },
    signal,
  );
  if (
    !isRecord(data) ||
    typeof data.category !== "string" ||
    typeof data.description !== "string" ||
    typeof data.exampleAnswer !== "string"
  ) {
    throw new Error("The category came back garbled. Try again!");
  }
  return { category: data.category, description: data.description, exampleAnswer: data.exampleAnswer };
}

export type ValidateMoveRequest = {
  genre: string;
  category: string;
  submission: string;
  usedCanonicalIds: string[];
};

export async function validateMove(request: ValidateMoveRequest, signal?: AbortSignal): Promise<Verdict> {
  const data = await postJson("/api/validate-move", request, signal);
  if (
    !isRecord(data) ||
    typeof data.valid !== "boolean" ||
    typeof data.isDuplicate !== "boolean" ||
    typeof data.canonicalId !== "string" ||
    typeof data.displayName !== "string" ||
    typeof data.reason !== "string"
  ) {
    throw new Error("The referee mumbled. Try that answer again!");
  }
  return {
    valid: data.valid,
    isDuplicate: data.isDuplicate,
    canonicalId: data.canonicalId,
    displayName: data.displayName,
    autoCorrected: data.autoCorrected === true,
    reason: data.reason,
  };
}
