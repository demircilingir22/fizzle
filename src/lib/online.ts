/**
 * Online rooms: the wire types shared by the room routes and the client, plus
 * the client's typed wrappers around /api/rooms/**.
 *
 * Dependency-free apart from types, so both sides can import it.
 */
import type { Difficulty, FeedItem, GamePhase, Topic } from "@/lib/game";

// ---------------------------------------------------------------------------
// Wire types
// ---------------------------------------------------------------------------

/** 4 letters with no look-alikes (no I or O; codes never contain digits). */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ";
export const ROOM_CODE_LENGTH = 4;

/** Keeps only characters that can appear in a room code, uppercased. */
export const cleanRoomCode = (value: string) =>
  [...value.toUpperCase()].filter((c) => ROOM_CODE_ALPHABET.includes(c)).join("").slice(0, ROOM_CODE_LENGTH);

export const isRoomCode = (value: string) => new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`).test(value);

export type RoomSettings = {
  genre: string;
  difficulty: Difficulty;
  seconds: number;
};

/**
 * - `lobby`: waiting room before the first match.
 * - `loading`: the server is generating a category for the next match.
 * - `playing`: a match exists (it may be over, showing the winner screen).
 * - `changing_settings`: the host is picking a new genre for the same players.
 */
export type RoomStatus = "lobby" | "loading" | "playing" | "changing_settings";

/** What started the current `loading` status. */
export type LoadingFrom = "lobby" | "replay" | "settings";

export type RoomPlayer = {
  /** Public seat id. The secret playerId never leaves the server. */
  id: string;
  name: string;
  /** Index into PLAYER_COLORS. */
  color: number;
  isHost: boolean;
  /** Hasn't polled for a few seconds (tab closed or backgrounded). */
  away: boolean;
};

export type MatchPlayer = {
  id: string;
  name: string;
  color: number;
  /**
   * Fuse left. For the active player while `turnStartedAt` is set, this is the
   * value at `turnStartedAt`; the live value is `remainingMs - (serverNow - turnStartedAt)`.
   */
  remainingMs: number;
  lastAnswer: string | null;
  answers: number;
  eliminated: boolean;
  /** Left the room mid-match (counts as eliminated). */
  left: boolean;
};

export type MatchEvent = {
  id: number;
  tone: "error" | "success" | "corrected";
  /** Index into `players` of whoever answered. */
  player: number;
  text: string;
};

export type OnlineMatch = {
  id: number;
  settings: RoomSettings;
  topic: Topic;
  /** In this match's shuffled turn order. */
  players: MatchPlayer[];
  phase: GamePhase;
  active: number;
  /** Server ms when the active clock started; null whenever the clock is stopped. */
  turnStartedAt: number | null;
  /** Server ms when the countdown or explosion ends; null otherwise (or while paused). */
  phaseEndsAt: number | null;
  paused: boolean;
  pausedBy: string | null;
  /** The referee is judging the active player's answer (their clock is frozen). */
  validating: boolean;
  /** The answer being judged, while `validating`. */
  checking: string | null;
  feed: FeedItem[];
  /** Normalized forms of accepted answers, for the instant client-side duplicate check. */
  usedKeys: string[];
  /** Elimination order, first out first. */
  eliminated: number[];
  exploding: number | null;
  winner: number | null;
  /** Latest referee outcome, shown as a toast on every screen. */
  event: MatchEvent | null;
};

export type RoomView = {
  code: string;
  status: RoomStatus;
  loadingFrom: LoadingFrom | null;
  settings: RoomSettings;
  /** In join order. */
  players: RoomPlayer[];
  hostId: string;
  /** The requester's public seat id, or null if they aren't in the room. */
  you: string | null;
  match: OnlineMatch | null;
  /** Last problem worth telling the room about (e.g. category generation failed). */
  notice: string | null;
  /** Bumped on every state change; clients ignore responses older than what they have. */
  version: number;
  /** Server clock (Unix ms) when this view was built, for clock-offset estimation. */
  serverNow: number;
  /** How long the client should wait before its next poll (set by ROOM_POLL_MS on the server). */
  pollMs: number;
};

export type ReplayAction = "same_genre" | "choose_genre" | "cancel_genre" | "new_genre";

/** Countdown before the first turn of an online match. */
export const ONLINE_COUNTDOWN_STEPS = 3;
export const ONLINE_COUNTDOWN_STEP_MS = 1000;
export const ONLINE_EXPLOSION_MS = 1600;

/** Polling interval for GET /api/rooms/[code] until the server's first `pollMs` arrives. */
export const POLL_MS = 250;

/** Header carrying the requester's secret playerId. */
export const PLAYER_ID_HEADER = "x-player-id";

// ---------------------------------------------------------------------------
// Client API
// ---------------------------------------------------------------------------

export class RoomRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "RoomRequestError";
  }
}

/** The room is gone (404) or we're no longer in it (410): stop polling and go home. */
export const isGoneError = (err: unknown) =>
  err instanceof RoomRequestError && (err.status === 404 || err.status === 410);

async function roomRequest(
  method: "GET" | "POST",
  path: string,
  playerId: string,
  body?: unknown,
  signal?: AbortSignal,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetch(`/api/rooms/${path}`, {
      method,
      cache: "no-store",
      headers: {
        [PLAYER_ID_HEADER]: playerId,
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (err) {
    if (signal?.aborted) throw err;
    throw new RoomRequestError("Couldn't reach the server. Check your connection and try again.", 0);
  }

  const data: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message =
      data && typeof data === "object" && "error" in data && typeof data.error === "string"
        ? data.error
        : `Request failed (${response.status})`;
    throw new RoomRequestError(message, response.status);
  }
  return data;
}

function asView(data: unknown): RoomView {
  if (
    !data ||
    typeof data !== "object" ||
    !("code" in data) ||
    !("status" in data) ||
    !("version" in data) ||
    !("serverNow" in data)
  ) {
    throw new RoomRequestError("The server sent a garbled room. Try again!", 502);
  }
  return data as RoomView;
}

export const roomApi = {
  get: async (code: string, playerId: string, signal?: AbortSignal) =>
    asView(await roomRequest("GET", code, playerId, undefined, signal)),

  create: async (playerId: string, name: string, settings: RoomSettings) =>
    asView(await roomRequest("POST", "create", playerId, { name, settings })),

  join: async (code: string, playerId: string, name: string) =>
    asView(await roomRequest("POST", `${code}/join`, playerId, { name })),

  start: async (code: string, playerId: string) => asView(await roomRequest("POST", `${code}/start`, playerId, {})),

  submit: async (code: string, playerId: string, submission: string) =>
    asView(await roomRequest("POST", `${code}/submit`, playerId, { submission })),

  timeout: async (code: string, playerId: string) =>
    asView(await roomRequest("POST", `${code}/timeout`, playerId, {})),

  pause: async (code: string, playerId: string, paused: boolean) =>
    asView(await roomRequest("POST", `${code}/pause`, playerId, { paused })),

  replay: async (code: string, playerId: string, action: ReplayAction, settings?: RoomSettings) =>
    asView(await roomRequest("POST", `${code}/replay`, playerId, { action, settings })),

  leave: async (code: string, playerId: string) => {
    await roomRequest("POST", `${code}/leave`, playerId, {});
  },
};
