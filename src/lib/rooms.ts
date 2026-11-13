/**
 * Server-authoritative online rooms.
 *
 * Server-only. Room state is plain JSON kept in a hybrid store:
 * - Upstash Redis when UPSTASH_REDIS_REST_URL/TOKEN (or Vercel's KV_REST_API_URL/TOKEN)
 *   are set: production on Vercel, where every request may hit a different instance.
 * - Otherwise an in-memory globalThis.__blitzRooms Map, so `npm run dev` works offline.
 *
 * Every change is load → change → compare-and-set save (see updateRoom), retried
 * on conflict, so concurrent requests never overwrite each other's updates.
 *
 * There are no timers: every request first "catches up" the room to the current
 * time (countdown ending, a fuse running out, an explosion settling), so the
 * 250ms polling from clients drives the state machine.
 *
 * Clocks: each match player stores `remainingMs`; while the active player's
 * clock runs, `turnStartedAt` holds the server time it started. Stopping the
 * clock charges the elapsed time and clears `turnStartedAt`.
 */
import { Redis } from "@upstash/redis";
import { after } from "next/server";
import { aiErrorMessage, readJsonBody } from "@/lib/ai";
import { nameVariantIds, toCanonicalId } from "@/lib/canonical";
import {
  DIFFICULTIES,
  MAX_ANSWER_LENGTH,
  MAX_GENRE_LENGTH,
  MAX_NAME_LENGTH,
  MAX_PLAYERS,
  MAX_PREVIOUS_CATEGORIES,
  MAX_SECONDS,
  MIN_PLAYERS,
  MIN_SECONDS,
  PLAYER_COLORS,
  SECONDS_STEP,
  defaultPlayerName,
  nextSurvivor,
  type Difficulty,
  type Topic,
} from "@/lib/game";
import {
  ONLINE_COUNTDOWN_STEPS,
  ONLINE_COUNTDOWN_STEP_MS,
  ONLINE_EXPLOSION_MS,
  PLAYER_ID_HEADER,
  ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH,
  isRoomCode,
  type LoadingFrom,
  type MatchEvent,
  type OnlineMatch,
  type ReplayAction,
  type RoomSettings,
  type RoomStatus,
  type RoomView,
} from "@/lib/online";
import { judgeMove } from "@/lib/referee";
import { shuffle } from "@/lib/shuffle";
import { generateTopic } from "@/lib/topic";

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Rooms expire this long after their last save or heartbeat. */
const ROOM_TTL_SECONDS = 2 * 60 * 60;
/** A player hasn't polled for this long: shown as away. */
const AWAY_MS = 8_000;
/**
 * A player hasn't polled for this long: removed from the room. Generous because
 * browsers throttle timers in background tabs (down to once a minute).
 */
const STALE_MS = 90_000;
/** Heartbeats are written at most this often per player (well under AWAY_MS, so nobody flickers to away). */
const HEARTBEAT_EVERY_MS = 3_000;
/**
 * Poll interval during a match, overridable with ROOM_POLL_MS. Snappy in memory;
 * slower on Redis, where every poll is a function invocation plus a Redis read.
 */
const DEFAULT_POLL_MS = { memory: 250, redis: 500 } as const;
const MIN_POLL_MS = 100;
const MAX_POLL_MS = 2_000;
/** Lobby, results, loading and genre screens poll at least this slowly: nothing there is timed. */
const IDLE_POLL_MS = 1_000;
/** A category generation that hasn't finished by now is abandoned (its request probably died). */
const LOADING_TIMEOUT_MS = 60_000;
/** A referee call that hasn't answered by now is abandoned and the turn resumes. */
const VALIDATION_TIMEOUT_MS = 30_000;
/** How long "Start" waits for a category that's already being generated in the background. */
const PREFETCH_WAIT_MS = 12_000;
const PREFETCH_POLL_MS = 400;
/** A background category generation older than this is assumed dead. */
const PREFETCH_STALE_MS = 45_000;
/** Compare-and-set attempts before giving up on a busy room. */
const MAX_WRITE_ATTEMPTS = 12;

// ---------------------------------------------------------------------------
// State (everything here is JSON, so it can live in Redis)
// ---------------------------------------------------------------------------

type Member = {
  /** The client's secret playerId (from its sessionStorage). Never sent to clients. */
  secret: string;
  /** Public seat id. */
  id: string;
  name: string;
  color: number;
  joinedAt: number;
};

type Match = Omit<OnlineMatch, "validating" | "checking"> & {
  usedCanonicalIds: string[];
  /** Countdown time left when paused during the countdown. */
  pausedPhaseLeftMs: number | null;
  validating: { token: number; player: number; submission: string; startedAt: number } | null;
};

/** A category generated in the background (via `after`) for the next match. */
type Prefetch = {
  key: string;
  token: string;
  settings: RoomSettings;
  startedAt: number;
  /** Null while it's still being generated. */
  topic: Topic | null;
};

export type RoomState = {
  code: string;
  status: RoomStatus;
  loadingFrom: LoadingFrom | null;
  /** Set while `status` is "loading". */
  loading: { token: string; since: number; previousStatus: RoomStatus; settings: RoomSettings } | null;
  settings: RoomSettings;
  members: Member[];
  hostId: string;
  match: Match | null;
  matchCount: number;
  /** Categories already played in this room, per genre, so new matches don't repeat them. */
  played: Record<string, string[]>;
  prefetch: Prefetch | null;
  notice: string | null;
  /** Bumped on every change clients can see; clients ignore responses older than what they have. */
  version: number;
  /** Bumped per referee call so a late verdict for an old turn is ignored. */
  validationToken: number;
  eventCount: number;
};

/** Player id → last heartbeat (ms). Stored beside the state so polls don't rewrite the room. */
type Seen = Record<string, number>;

export class RoomError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "RoomError";
  }
}

function fail(status: number, message: string): never {
  throw new RoomError(status, message);
}

const bump = (state: RoomState) => {
  state.version += 1;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Storage adapter: Upstash Redis in production, in-memory locally
// ---------------------------------------------------------------------------

type RawRoom = { rev: number; state: string; seen: Seen };

interface RoomBackend {
  read(code: string): Promise<RawRoom | null>;
  /** Saves if the stored revision is still `expectedRev` (0 = create only if absent). Returns the new revision, or 0. */
  write(code: string, state: string, expectedRev: number): Promise<number>;
  /** Deletes if the stored revision is still `expectedRev`. */
  remove(code: string, expectedRev: number): Promise<boolean>;
  /** Records a heartbeat, if the room still exists. */
  touch(code: string, playerId: string, at: number): Promise<void>;
}

type MemoryEntry = RawRoom & { expiresAt: number };

declare global {
  var __blitzRooms: Map<string, MemoryEntry> | undefined;
}

function memoryBackend(): RoomBackend {
  const rooms: Map<string, MemoryEntry> = (globalThis.__blitzRooms ??= new Map());
  const live = (code: string) => {
    const entry = rooms.get(code);
    // Entries from before a hot reload may have an older shape: treat them as gone.
    if (!entry || typeof entry.state !== "string" || entry.expiresAt <= Date.now()) {
      rooms.delete(code);
      return null;
    }
    return entry;
  };
  const ttl = () => Date.now() + ROOM_TTL_SECONDS * 1000;

  return {
    async read(code) {
      const entry = live(code);
      return entry && { rev: entry.rev, state: entry.state, seen: { ...entry.seen } };
    },
    async write(code, state, expectedRev) {
      const entry = live(code);
      if ((entry?.rev ?? 0) !== expectedRev) return 0;
      for (const [other, e] of rooms) if (e.expiresAt <= Date.now()) rooms.delete(other);
      const rev = expectedRev + 1;
      rooms.set(code, { rev, state, seen: entry?.seen ?? {}, expiresAt: ttl() });
      return rev;
    },
    async remove(code, expectedRev) {
      if (live(code)?.rev !== expectedRev) return false;
      rooms.delete(code);
      return true;
    },
    async touch(code, playerId, at) {
      const entry = live(code);
      if (!entry) return;
      entry.seen[playerId] = at;
      entry.expiresAt = ttl();
    },
  };
}

// Each room is one hash at room:<code>: `rev`, `state` (JSON) and `seen:<playerId>` heartbeats.
const WRITE_SCRIPT = `
local rev = redis.call('HGET', KEYS[1], 'rev')
if ARGV[1] == '0' then
  if rev then return 0 end
elseif rev ~= ARGV[1] then
  return 0
end
local nextRev = (tonumber(rev) or 0) + 1
redis.call('HSET', KEYS[1], 'rev', nextRev, 'state', ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return nextRev`;

const REMOVE_SCRIPT = `
if redis.call('HGET', KEYS[1], 'rev') == ARGV[1] then
  redis.call('DEL', KEYS[1])
  return 1
end
return 0`;

const TOUCH_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('HSET', KEYS[1], ARGV[1], ARGV[2])
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[3]))
return 1`;

const SEEN_PREFIX = "seen:";

function redisBackend(url: string, token: string): RoomBackend {
  // Raw strings in, raw strings out: we parse the state JSON ourselves.
  const redis = new Redis({ url, token, automaticDeserialization: false });
  const writeScript = redis.createScript<number>(WRITE_SCRIPT);
  const removeScript = redis.createScript<number>(REMOVE_SCRIPT);
  const touchScript = redis.createScript<number>(TOUCH_SCRIPT);
  const key = (code: string) => `room:${code}`;
  const ttl = String(ROOM_TTL_SECONDS);

  return {
    async read(code) {
      const reply: unknown = await redis.hgetall(key(code));
      // Without automatic deserialization HGETALL is a flat [field, value, ...] array.
      const pairs: [string, unknown][] = Array.isArray(reply)
        ? Array.from({ length: Math.floor(reply.length / 2) }, (_, i) => [String(reply[2 * i]), reply[2 * i + 1]])
        : reply && typeof reply === "object"
          ? Object.entries(reply)
          : [];
      const fields = new Map(pairs);
      const state = fields.get("state");
      const rev = Number(fields.get("rev"));
      if (typeof state !== "string" || !Number.isInteger(rev) || rev < 1) return null;
      const seen: Seen = {};
      for (const [field, value] of pairs) {
        if (field.startsWith(SEEN_PREFIX)) seen[field.slice(SEEN_PREFIX.length)] = Number(value) || 0;
      }
      return { rev, state, seen };
    },
    async write(code, state, expectedRev) {
      return Number(await writeScript.exec([key(code)], [String(expectedRev), state, ttl])) || 0;
    },
    async remove(code, expectedRev) {
      return Number(await removeScript.exec([key(code)], [String(expectedRev)])) === 1;
    },
    async touch(code, playerId, at) {
      await touchScript.exec([key(code)], [SEEN_PREFIX + playerId, String(at), ttl]);
    },
  };
}

type RoomConfig = { backend: RoomBackend; pollMs: number };

function loadConfig(): RoomConfig {
  const url = (process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL)?.trim();
  const token = (process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN)?.trim();
  const backend = url && token ? redisBackend(url, token) : memoryBackend();
  if (!(url && token) && process.env.VERCEL) {
    console.warn(
      "[rooms] UPSTASH_REDIS_REST_URL/TOKEN are not set: using in-memory rooms, which serverless instances don't share.",
    );
  }

  const requested = Number(process.env.ROOM_POLL_MS);
  const pollMs =
    Number.isFinite(requested) && requested > 0
      ? Math.min(MAX_POLL_MS, Math.max(MIN_POLL_MS, Math.round(requested)))
      : DEFAULT_POLL_MS[url && token ? "redis" : "memory"];
  return { backend, pollMs };
}

let config: RoomConfig | null = null;
const roomConfig = () => (config ??= loadConfig());
const store = () => roomConfig().backend;

/**
 * Extra time before a clock that was handed to someone starts: they only find
 * out it's their turn on their next poll, and that wait must not cost them time.
 */
const handoffGraceMs = () => roomConfig().pollMs;

type StoredRoom = { state: RoomState; rev: number; seen: Seen };

/** Loads a room, or null if it doesn't exist (or expired). */
async function getRoom(code: string): Promise<StoredRoom | null> {
  const raw = await store().read(code);
  if (!raw) return null;
  try {
    return { state: JSON.parse(raw.state) as RoomState, rev: raw.rev, seen: raw.seen };
  } catch {
    return null;
  }
}

/** Saves a room loaded at revision `rev` (0 to create it). Returns the new revision, or 0 if someone saved first. */
async function saveRoom(state: RoomState, rev: number): Promise<number> {
  return store().write(state.code, JSON.stringify(state), rev);
}

/** Deletes a room loaded at revision `rev`, unless someone saved it since. */
async function deleteRoom(code: string, rev: number): Promise<boolean> {
  return store().remove(code, rev);
}

/** Records that a player is still polling. */
async function touchRoom(code: string, playerId: string, at: number): Promise<void> {
  await store().touch(code, playerId, at);
}

type Txn = { state: RoomState; seen: Seen; now: number };

const ROOM_NOT_FOUND = "Room not found. Check the code and try again.";

/**
 * Loads the room, runs `change` on it, and saves the result if anything changed
 * (a room left with no players is deleted instead). If another request saved
 * first, it reloads and runs `change` again, so `change` must be safe to re-run
 * and must not have side effects outside the state.
 */
async function updateRoom<T>(
  code: string,
  now: number,
  change: (txn: Txn) => T,
): Promise<{ state: RoomState; seen: Seen; result: T }> {
  for (let attempt = 0; attempt < MAX_WRITE_ATTEMPTS; attempt++) {
    const stored = await getRoom(code);
    if (!stored) fail(404, ROOM_NOT_FOUND);
    const before = JSON.stringify(stored.state);
    const previousPrefetch = stored.state.prefetch?.token;
    const txn: Txn = { state: stored.state, seen: stored.seen, now };
    const result = change(txn);
    const { state } = txn;

    if (JSON.stringify(state) === before) return { state, seen: txn.seen, result };

    if (state.members.length === 0) {
      if (await deleteRoom(code, stored.rev)) fail(404, ROOM_NOT_FOUND);
    } else if (await saveRoom(state, stored.rev)) {
      // A new background category generation was requested: start it after the response.
      if (state.prefetch && !state.prefetch.topic && state.prefetch.token !== previousPrefetch) {
        schedulePrefetch(code, state.prefetch.token);
      }
      return { state, seen: txn.seen, result };
    }
    // Someone else saved first: back off a little and redo the change on their version.
    await sleep(5 + Math.random() * 20 * (attempt + 1));
  }
  fail(503, "The room is busy. Try again!");
}

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function randomString(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

const randomToken = () => randomString("abcdefghijklmnopqrstuvwxyz0123456789", 16);

const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function requirePlayerId(value: string | null): string {
  if (!value || !PLAYER_ID_PATTERN.test(value)) fail(400, "Missing or invalid player id");
  return value;
}

export function requireRoomCode(value: string): string {
  const code = value.toUpperCase();
  if (!isRoomCode(code)) fail(404, ROOM_NOT_FOUND);
  return code;
}

const cleanText = (value: unknown) => (typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "");

function parseSettings(value: unknown): RoomSettings {
  const raw = value && typeof value === "object" ? (value as Record<string, unknown>) : {};
  const genre = cleanText(raw.genre);
  const difficulty = raw.difficulty as Difficulty;
  const seconds = raw.seconds;
  if (!genre || genre.length > MAX_GENRE_LENGTH) fail(400, "Pick a genre first!");
  if (!DIFFICULTIES.includes(difficulty)) fail(400, `difficulty must be one of ${DIFFICULTIES.join(", ")}`);
  if (
    typeof seconds !== "number" ||
    !Number.isInteger(seconds) ||
    seconds < MIN_SECONDS ||
    seconds > MAX_SECONDS ||
    seconds % SECONDS_STEP !== 0
  ) {
    fail(400, `seconds must be a multiple of ${SECONDS_STEP} from ${MIN_SECONDS} to ${MAX_SECONDS}`);
  }
  return { genre, difficulty, seconds };
}

/** Trims the name, falls back to "Player N", and de-duplicates it among `others`. */
function pickName(others: Member[], value: unknown): string {
  const base = cleanText(value).slice(0, MAX_NAME_LENGTH) || defaultPlayerName(others.length);
  const taken = new Set(others.map((m) => m.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function freeColor(members: Member[]): number {
  const used = new Set(members.map((m) => m.color));
  for (let color = 0; color < PLAYER_COLORS.length; color++) if (!used.has(color)) return color;
  return 0;
}

function newMember(members: Member[], secret: string, name: unknown, now: number): Member {
  return {
    secret,
    id: randomString("abcdefghijkmnpqrstuvwxyz23456789", 10),
    name: pickName(members, name),
    color: freeColor(members),
    joinedAt: now,
  };
}

const findMember = (state: RoomState, secret: string) => state.members.find((m) => m.secret === secret);

function requireMember(state: RoomState, secret: string): Member {
  return findMember(state, secret) ?? fail(410, "You're not in this room anymore.");
}

function requireHost(state: RoomState, member: Member) {
  if (state.hostId !== member.id) fail(403, "Only the host can do that.");
}

const lastSeen = (member: Member, seen: Seen) => Math.max(seen[member.id] ?? 0, member.joinedAt);

// ---------------------------------------------------------------------------
// Match clock + state machine
// ---------------------------------------------------------------------------

/** Charges the running clock up to `now` and stops it. */
function stopClock(match: Match, now: number) {
  if (match.turnStartedAt === null) return;
  const player = match.players[match.active];
  player.remainingMs = Math.max(0, player.remainingMs - Math.max(0, now - match.turnStartedAt));
  match.turnStartedAt = null;
}

/** Starts the active player's clock at `at`, if the game is live and not frozen. */
function startClock(match: Match, at: number) {
  if (match.phase !== "playing" || match.paused || match.validating || match.turnStartedAt !== null) return;
  match.turnStartedAt = at;
}

function explode(match: Match, player: number, at: number) {
  match.turnStartedAt = null;
  match.validating = null;
  const p = match.players[player];
  p.remainingMs = 0;
  p.eliminated = true;
  match.eliminated.push(player);
  match.phase = "exploding";
  match.exploding = player;
  match.phaseEndsAt = at + ONLINE_EXPLOSION_MS;
}

const survivorsOf = (match: Match) => match.players.flatMap((p, i) => (p.eliminated ? [] : [i]));

function endMatch(state: RoomState, match: Match, winner: number | null, now: number) {
  match.phase = "over";
  match.exploding = null;
  match.phaseEndsAt = null;
  match.turnStartedAt = null;
  match.validating = null;
  match.paused = false;
  match.pausedBy = null;
  match.winner = winner;
  // Get the next category going so "Replay (Same Genre)" starts quickly.
  requestPrefetch(state, match.settings, now);
}

function settle(state: RoomState, match: Match, at: number) {
  const survivors = survivorsOf(match);
  if (survivors.length <= 1) {
    endMatch(state, match, survivors[0] ?? null, at);
    return;
  }
  match.phase = "playing";
  match.phaseEndsAt = null;
  match.active = nextSurvivor(match.players, match.exploding ?? match.active);
  match.exploding = null;
  startClock(match, at + handoffGraceMs());
}

function pushEvent(state: RoomState, match: Match, event: Omit<MatchEvent, "id">) {
  state.eventCount += 1;
  match.event = { id: state.eventCount, ...event };
}

/**
 * Applies every time-based transition due by `now`. Transitions happen at the
 * exact time they were due, not when a request noticed them, so concurrent
 * requests compute identical results and polling cadence never matters.
 */
function advance(state: RoomState, now: number) {
  const match = state.match;
  if (!match) return;
  let changed = false;

  // A referee call whose request died (or hung) must not freeze the game forever.
  if (match.validating && now >= match.validating.startedAt + VALIDATION_TIMEOUT_MS) {
    const at = match.validating.startedAt + VALIDATION_TIMEOUT_MS;
    pushEvent(state, match, {
      tone: "error",
      player: match.validating.player,
      text: "The referee took too long. Try that answer again!",
    });
    match.validating = null;
    startClock(match, at + handoffGraceMs());
    changed = true;
  }

  if (!match.paused) {
    for (let guard = 0; guard < 4 * MAX_PLAYERS; guard++) {
      if (match.phase === "countdown" && match.phaseEndsAt !== null && now >= match.phaseEndsAt) {
        const at = match.phaseEndsAt;
        match.phase = "playing";
        match.phaseEndsAt = null;
        startClock(match, at);
      } else if (
        match.phase === "playing" &&
        match.turnStartedAt !== null &&
        now >= match.turnStartedAt + match.players[match.active].remainingMs
      ) {
        explode(match, match.active, match.turnStartedAt + match.players[match.active].remainingMs);
      } else if (match.phase === "exploding" && match.phaseEndsAt !== null && now >= match.phaseEndsAt) {
        settle(state, match, match.phaseEndsAt);
      } else {
        break;
      }
      changed = true;
    }
  }

  if (changed) bump(state);
}

/** A player left mid-match: they're out, without the explosion pause. */
function forfeit(state: RoomState, match: Match, index: number, now: number) {
  const player = match.players[index];
  player.left = true;
  if (player.eliminated || match.phase === "over") return;

  const wasActive = match.active === index;
  if (wasActive) stopClock(match, now);
  if (match.validating?.player === index) match.validating = null;
  player.eliminated = true;
  match.eliminated.push(index);

  // An explosion in progress settles on its own and picks the next player.
  if (match.phase === "exploding") return;

  const survivors = survivorsOf(match);
  if (survivors.length <= 1) {
    stopClock(match, now);
    endMatch(state, match, survivors[0] ?? null, now);
    return;
  }
  if (wasActive) {
    match.active = nextSurvivor(match.players, index);
    startClock(match, now + handoffGraceMs());
  }
}

function removeMember(state: RoomState, member: Member, now: number) {
  state.members = state.members.filter((m) => m.id !== member.id);
  const index = state.match?.players.findIndex((p) => p.id === member.id) ?? -1;
  if (state.match && index >= 0) forfeit(state, state.match, index, now);
  // Promote the longest-standing player.
  if (state.hostId === member.id && state.members.length > 0) state.hostId = state.members[0].id;
  bump(state);
}

/** A category generation that never finished (its request died) gives the room back. */
function expireLoading(state: RoomState, now: number) {
  if (state.status !== "loading" || !state.loading || now < state.loading.since + LOADING_TIMEOUT_MS) return;
  state.status = state.loading.previousStatus;
  state.loading = null;
  state.loadingFrom = null;
  state.notice = "Picking a category took too long. Try again!";
  bump(state);
}

/**
 * Brings a loaded room up to date: drops players who stopped polling, then
 * applies anything that came due. `requester` is obviously still here.
 */
function catchUp(txn: Txn, requester?: Member) {
  const { state, seen, now } = txn;
  if (requester) seen[requester.id] = now;
  for (const member of [...state.members]) {
    if (now - lastSeen(member, seen) > STALE_MS) removeMember(state, member, now);
  }
  expireLoading(state, now);
  advance(state, now);
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const genreKey = (genre: string) => genre.trim().toLowerCase();
const topicKey = (settings: RoomSettings) => `${settings.difficulty}|${genreKey(settings.genre)}`;

async function requestTopic(settings: RoomSettings, previousCategories: string[]): Promise<Topic> {
  const topic = await generateTopic({
    genre: settings.genre,
    difficulty: settings.difficulty,
    previousCategories,
  });
  if (!topic) throw new Error("AI returned an incomplete topic");
  return topic;
}

/** Asks for a category to be generated in the background (it starts once the change is saved). */
function requestPrefetch(state: RoomState, settings: RoomSettings, now: number) {
  const key = topicKey(settings);
  const current = state.prefetch;
  if (current?.key === key && (current.topic || now - current.startedAt < PREFETCH_STALE_MS)) return;
  state.prefetch = { key, token: randomToken(), settings, startedAt: now, topic: null };
}

function schedulePrefetch(code: string, token: string) {
  // Runs after the response is sent; on Vercel the function stays alive for it (waitUntil).
  after(() => runPrefetch(code, token));
}

async function runPrefetch(code: string, token: string) {
  try {
    const stored = await getRoom(code);
    const prefetch = stored?.state.prefetch;
    if (!stored || prefetch?.token !== token || prefetch.topic) return;

    let topic: Topic | null = null;
    try {
      topic = await requestTopic(prefetch.settings, stored.state.played[genreKey(prefetch.settings.genre)] ?? []);
    } catch (err) {
      console.error("[rooms] background category failed:", err instanceof Error ? err.message : err);
    }

    await updateRoom(code, Date.now(), ({ state }) => {
      if (state.prefetch?.token !== token) return;
      // A failed prefetch is dropped; "Start" then generates one itself.
      state.prefetch = topic ? { ...state.prefetch, topic } : null;
    });
  } catch (err) {
    if (!(err instanceof RoomError)) console.error("[rooms] background category failed:", err);
  }
}

/**
 * The category for the next match: the background one when it matches (waiting
 * a little if it's still being generated), otherwise a fresh one.
 */
async function obtainTopic(code: string, settings: RoomSettings): Promise<Topic> {
  const key = topicKey(settings);
  const giveUpAt = Date.now() + PREFETCH_WAIT_MS;
  for (;;) {
    const stored = await getRoom(code);
    if (!stored) fail(404, ROOM_NOT_FOUND);
    const { prefetch, played } = stored.state;
    if (prefetch?.key === key) {
      if (prefetch.topic) return prefetch.topic;
      const now = Date.now();
      if (now < giveUpAt && now - prefetch.startedAt < PREFETCH_STALE_MS) {
        await sleep(PREFETCH_POLL_MS);
        continue;
      }
    }
    return requestTopic(settings, played[genreKey(settings.genre)] ?? []);
  }
}

function newMatch(state: RoomState, settings: RoomSettings, topic: Topic, now: number): Match {
  const order = shuffle(state.members);
  const key = genreKey(settings.genre);
  state.played[key] = [...(state.played[key] ?? []), topic.category].slice(-MAX_PREVIOUS_CATEGORIES);
  state.matchCount += 1;
  return {
    id: state.matchCount,
    settings,
    topic,
    players: order.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      remainingMs: settings.seconds * 1000,
      lastAnswer: null,
      answers: 0,
      eliminated: false,
      left: false,
    })),
    phase: "countdown",
    active: 0,
    turnStartedAt: null,
    phaseEndsAt: now + ONLINE_COUNTDOWN_STEPS * ONLINE_COUNTDOWN_STEP_MS,
    pausedPhaseLeftMs: null,
    paused: false,
    pausedBy: null,
    validating: null,
    usedCanonicalIds: [],
    usedKeys: [],
    feed: [],
    eliminated: [],
    exploding: null,
    winner: null,
    event: null,
  };
}

/** Puts the room into "loading" (everyone sees the loader). Returns the load's token. */
function beginLoading(state: RoomState, settings: RoomSettings, from: LoadingFrom, now: number): string {
  if (state.members.length < MIN_PLAYERS) fail(409, `Need at least ${MIN_PLAYERS} players to start.`);
  const token = randomToken();
  state.loading = { token, since: now, previousStatus: state.status, settings };
  state.status = "loading";
  state.loadingFrom = from;
  state.notice = null;
  bump(state);
  return token;
}

/**
 * Generates the category, then starts a new match with every current member in
 * a freshly shuffled turn order (or gives the room back with a notice).
 */
async function finishLoading(code: string, token: string, settings: RoomSettings) {
  let topic: Topic | null = null;
  let problem: string | null = null;
  try {
    topic = await obtainTopic(code, settings);
  } catch (err) {
    if (err instanceof RoomError) throw err;
    problem = aiErrorMessage(err, "Couldn't pick a category. Try again!");
  }

  return updateRoom(code, Date.now(), ({ state, now }) => {
    // Timed out, or replaced by a newer load.
    if (state.status !== "loading" || state.loading?.token !== token) return;
    if (topic && state.members.length >= MIN_PLAYERS) {
      state.match = newMatch(state, settings, topic, now);
      state.status = "playing";
      state.prefetch = null;
    } else {
      state.status = state.loading.previousStatus;
      state.notice = problem ?? `Need at least ${MIN_PLAYERS} players to start.`;
    }
    state.loading = null;
    state.loadingFrom = null;
    bump(state);
  });
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function toView(state: RoomState, seen: Seen, secret: string | null): RoomView {
  const now = Date.now();
  const match = state.match;
  const viewer = secret === null ? undefined : findMember(state, secret);
  return {
    code: state.code,
    status: state.status,
    loadingFrom: state.loadingFrom,
    settings: state.settings,
    players: state.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      isHost: m.id === state.hostId,
      away: viewer?.id !== m.id && now - lastSeen(m, seen) > AWAY_MS,
    })),
    hostId: state.hostId,
    you: viewer?.id ?? null,
    match: match && {
      id: match.id,
      settings: match.settings,
      topic: match.topic,
      players: match.players,
      phase: match.phase,
      active: match.active,
      turnStartedAt: match.turnStartedAt,
      phaseEndsAt: match.phaseEndsAt,
      paused: match.paused,
      pausedBy: match.pausedBy,
      validating: match.validating !== null,
      checking: match.validating?.submission ?? null,
      feed: match.feed,
      usedKeys: match.usedKeys,
      eliminated: match.eliminated,
      exploding: match.exploding,
      winner: match.winner,
      event: match.event,
    },
    notice: state.notice,
    version: state.version,
    serverNow: now,
    pollMs:
      state.status === "playing" && match && match.phase !== "over"
        ? roomConfig().pollMs
        : Math.max(roomConfig().pollMs, IDLE_POLL_MS),
  };
}

/** Writes the requester's heartbeat after the response, at most once a second. */
function heartbeat(code: string, member: Member | undefined, previous: number | undefined, now: number) {
  if (!member || (previous !== undefined && now - previous < HEARTBEAT_EVERY_MS)) return;
  after(() => touchRoom(code, member.id, now).catch((err) => console.error("[rooms] heartbeat failed:", err)));
}

// ---------------------------------------------------------------------------
// Actions (one per route)
// ---------------------------------------------------------------------------

export async function createRoom(secret: string, body: Record<string, unknown>): Promise<RoomView> {
  const now = Date.now();
  const settings = parseSettings(body.settings);
  const host = newMember([], secret, body.name, now);

  for (let attempt = 0; attempt < 20; attempt++) {
    const state: RoomState = {
      code: randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH),
      status: "lobby",
      loadingFrom: null,
      loading: null,
      settings,
      members: [host],
      hostId: host.id,
      match: null,
      matchCount: 0,
      played: {},
      prefetch: null,
      notice: null,
      version: 1,
      validationToken: 0,
      eventCount: 0,
    };
    // Start on the first category while everyone joins.
    requestPrefetch(state, settings, now);
    // Revision 0 = only if the code is free.
    if (await saveRoom(state, 0)) {
      if (state.prefetch) schedulePrefetch(state.code, state.prefetch.token);
      return toView(state, {}, secret);
    }
  }
  fail(503, "Couldn't find a free room code. Try again!");
}

/** Room state for polling. Non-members (checking a code before joining) get `you: null`. */
export async function pollRoom(rawCode: string, secret: string): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  const now = Date.now();
  const { state, seen, result } = await updateRoom(code, now, (txn) => {
    const member = findMember(txn.state, secret);
    const previous = member && txn.seen[member.id];
    catchUp(txn, member);
    return { member, previous };
  });
  heartbeat(code, result.member, result.previous, now);
  return toView(state, seen, secret);
}

export async function joinRoom(rawCode: string, secret: string, body: Record<string, unknown>): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  const { state, seen } = await updateRoom(code, Date.now(), (txn) => {
    const { state, now } = txn;
    const existing = findMember(state, secret);
    catchUp(txn, existing);
    if (existing) {
      // Rejoining from the same tab just refreshes the name.
      existing.name = pickName(
        state.members.filter((m) => m.id !== existing.id),
        body.name,
      );
    } else {
      if (state.members.length >= MAX_PLAYERS) fail(409, `This room is full (${MAX_PLAYERS} players max).`);
      state.members.push(newMember(state.members, secret, body.name, now));
    }
    bump(state);
  });
  return toView(state, seen, secret);
}

export async function startRoom(rawCode: string, secret: string): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  const { result } = await updateRoom(code, Date.now(), (txn) => {
    const member = requireMember(txn.state, secret);
    catchUp(txn, member);
    requireHost(txn.state, member);
    if (txn.state.status !== "lobby") fail(409, "The game has already started.");
    return { token: beginLoading(txn.state, txn.state.settings, "lobby", txn.now), settings: txn.state.settings };
  });
  const { state, seen } = await finishLoading(code, result.token, result.settings);
  return toView(state, seen, secret);
}

export async function submitAnswer(
  rawCode: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  // The clock freezes at the moment the server receives the answer.
  const receivedAt = Date.now();
  const submission = cleanText(body.submission);
  if (!submission) fail(400, "Type an answer first!");
  if (submission.length > MAX_ANSWER_LENGTH) fail(400, "That answer is too long.");
  const key = toCanonicalId(submission);

  const { result: turn } = await updateRoom(code, receivedAt, (txn) => {
    const { state, now } = txn;
    const member = requireMember(state, secret);
    catchUp(txn, member);
    const match = state.match;
    if (state.status !== "playing" || !match) fail(409, "No match in progress.");
    if (match.phase === "exploding" && match.exploding !== null && match.players[match.exploding].id === member.id) {
      fail(409, "Time's up!");
    }
    if (match.phase !== "playing") fail(409, "Answers aren't open right now.");
    if (match.paused) fail(409, "The game is paused.");
    if (match.validating) fail(409, "The referee is still checking an answer.");
    const player = match.active;
    if (match.players[player].id !== member.id) fail(403, "It's not your turn.");
    // Instant duplicate check. The clock keeps running, as in local games.
    if (key && match.usedKeys.includes(key)) fail(409, `“${submission}” was already said!`);

    stopClock(match, now);
    state.validationToken += 1;
    match.validating = { token: state.validationToken, player, submission, startedAt: now };
    bump(state);
    return {
      matchId: match.id,
      token: state.validationToken,
      player,
      genre: match.settings.genre,
      category: match.topic.category,
      usedCanonicalIds: [...match.usedCanonicalIds],
    };
  });

  let verdict: Awaited<ReturnType<typeof judgeMove>> = null;
  let problem: string | null = null;
  try {
    verdict = await judgeMove({
      genre: turn.genre,
      category: turn.category,
      submission,
      usedCanonicalIds: turn.usedCanonicalIds,
    });
    if (!verdict) problem = "The referee mumbled. Try that answer again!";
  } catch (err) {
    problem = aiErrorMessage(err, "The referee is unavailable. Try again!");
  }

  const { state, seen } = await updateRoom(code, Date.now(), (txn) => {
    const { state, now } = txn;
    catchUp(txn, findMember(state, secret));
    const match = state.match;
    // The player left, the referee timed out, or the match moved on while it thought.
    if (!match || match.id !== turn.matchId || match.validating?.token !== turn.token) return;

    const player = turn.player;
    const accepted = !!verdict && verdict.valid && !verdict.isDuplicate;
    match.validating = null;
    if (verdict && accepted) {
      const p = match.players[player];
      p.lastAnswer = verdict.displayName;
      p.answers += 1;
      const keys = [verdict.canonicalId, key, ...nameVariantIds(verdict.displayName)];
      match.usedCanonicalIds.push(verdict.canonicalId);
      match.usedKeys = [...new Set([...match.usedKeys, ...keys.filter(Boolean)])];
      match.feed = [{ canonicalId: verdict.canonicalId, displayName: verdict.displayName, player }, ...match.feed];
      match.active = nextSurvivor(match.players, player);
      pushEvent(state, match, {
        tone: verdict.autoCorrected ? "corrected" : "success",
        player,
        text: verdict.displayName,
      });
    } else {
      pushEvent(state, match, {
        tone: "error",
        player,
        text:
          problem ??
          (verdict?.reason || (verdict?.isDuplicate ? "That one was already used!" : "That one doesn't count.")),
      });
    }
    // Referee time is never charged. A rejected answer resumes right away (the
    // answerer gets this response); an accepted one hands the turn over with grace.
    startClock(match, accepted ? now + handoffGraceMs() : now);
    bump(state);
  });
  return toView(state, seen, secret);
}

/** A client saw a fuse hit zero. Catching up applies it if it's really due. */
export async function reportTimeout(rawCode: string, secret: string): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  const { state, seen } = await updateRoom(code, Date.now(), (txn) => {
    catchUp(txn, requireMember(txn.state, secret));
  });
  return toView(state, seen, secret);
}

export async function setPaused(rawCode: string, secret: string, body: Record<string, unknown>): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  const paused = body.paused === true;
  const { state, seen } = await updateRoom(code, Date.now(), (txn) => {
    const { state, now } = txn;
    const member = requireMember(state, secret);
    catchUp(txn, member);
    const match = state.match;
    if (state.status !== "playing" || !match) fail(409, "No match in progress.");
    if (paused === match.paused) return;

    if (paused) {
      if (match.phase === "countdown") {
        match.pausedPhaseLeftMs = Math.max(0, (match.phaseEndsAt ?? now) - now);
        match.phaseEndsAt = null;
      } else if (match.phase === "playing") {
        stopClock(match, now);
      } else {
        fail(409, "Can't pause right now.");
      }
      match.paused = true;
      match.pausedBy = member.name;
    } else {
      match.paused = false;
      match.pausedBy = null;
      if (match.phase === "countdown") {
        match.phaseEndsAt = now + (match.pausedPhaseLeftMs ?? ONLINE_COUNTDOWN_STEP_MS);
        match.pausedPhaseLeftMs = null;
      } else {
        // Most players learn about the resume on their next poll.
        startClock(match, now + handoffGraceMs());
      }
    }
    bump(state);
  });
  return toView(state, seen, secret);
}

const REPLAY_ACTIONS: ReplayAction[] = ["same_genre", "choose_genre", "cancel_genre", "new_genre"];

export async function replayRoom(
  rawCode: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<RoomView> {
  const code = requireRoomCode(rawCode);
  const action = body.action as ReplayAction;
  if (!REPLAY_ACTIONS.includes(action)) fail(400, `action must be one of ${REPLAY_ACTIONS.join(", ")}`);
  const newSettings = action === "new_genre" ? parseSettings(body.settings) : null;

  const updated = await updateRoom(code, Date.now(), (txn) => {
    const { state, now } = txn;
    const member = requireMember(state, secret);
    catchUp(txn, member);
    requireHost(state, member);
    const matchOver = state.status === "playing" && state.match?.phase === "over";

    switch (action) {
      case "same_genre":
        if (!matchOver || !state.match) fail(409, "The match isn't over yet.");
        return { token: beginLoading(state, state.match.settings, "replay", now), settings: state.match.settings };

      case "choose_genre":
        if (!matchOver) fail(409, "The match isn't over yet.");
        state.status = "changing_settings";
        state.notice = null;
        bump(state);
        return null;

      case "cancel_genre":
        if (state.status !== "changing_settings") fail(409, "Nobody is choosing a genre.");
        state.status = state.match ? "playing" : "lobby";
        state.notice = null;
        bump(state);
        return null;

      case "new_genre": {
        if (state.status !== "changing_settings" || !newSettings) fail(409, "Choose a new genre first.");
        state.settings = newSettings;
        return { token: beginLoading(state, newSettings, "settings", now), settings: newSettings };
      }
    }
  });

  if (!updated.result) return toView(updated.state, updated.seen, secret);
  const { state, seen } = await finishLoading(code, updated.result.token, updated.result.settings);
  return toView(state, seen, secret);
}

export async function leaveRoom(rawCode: string, secret: string): Promise<void> {
  const code = requireRoomCode(rawCode);
  try {
    await updateRoom(code, Date.now(), ({ state, now }) => {
      const member = findMember(state, secret);
      if (member) removeMember(state, member, now);
    });
  } catch (err) {
    // Already gone (or the room closed because we were the last one out): that's a successful leave.
    if (!(err instanceof RoomError && err.status === 404)) throw err;
  }
}

// ---------------------------------------------------------------------------
// Route glue
// ---------------------------------------------------------------------------

type RoomAction = (playerId: string, body: Record<string, unknown>) => Promise<unknown>;

/**
 * Runs a room action for a route handler: reads the player id header and JSON
 * body, awaits the action, and maps RoomErrors to JSON error responses.
 */
export async function handleRoomRequest(request: Request, action: RoomAction): Promise<Response> {
  try {
    const playerId = requirePlayerId(request.headers.get(PLAYER_ID_HEADER));
    const body = request.method === "GET" ? {} : ((await readJsonBody(request)) ?? {});
    const result = await action(playerId, body);
    return Response.json(result ?? { ok: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (err) {
    if (err instanceof RoomError || (err instanceof Error && err.name === "RoomError")) {
      return Response.json({ error: err.message }, { status: (err as RoomError).status });
    }
    console.error("[rooms]", err);
    return Response.json({ error: "Something went wrong. Try again!" }, { status: 500 });
  }
}
