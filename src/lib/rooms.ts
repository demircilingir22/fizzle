/**
 * Server-authoritative online rooms, kept in memory in a globalThis singleton
 * so state survives hot reloads and is shared by every room route.
 *
 * Server-only. There are no timers: every request first "advances" the room to
 * the current time (countdown ending, a fuse running out, an explosion
 * settling), so the 250ms polling from clients drives the state machine.
 *
 * Clocks: each match player stores `remainingMs`; while the active player's
 * clock runs, `turnStartedAt` holds the server time it started. Stopping the
 * clock charges the elapsed time and clears `turnStartedAt`.
 */
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
  ROOM_CODE_ALPHABET,
  PLAYER_ID_HEADER,
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
// State
// ---------------------------------------------------------------------------

/** A player hasn't polled for this long: shown as away. */
const AWAY_MS = 8_000;
/**
 * A player hasn't polled for this long: removed from the room. Generous because
 * browsers throttle timers in background tabs (down to once a minute).
 */
const STALE_MS = 90_000;
/** A room nobody has polled for this long is deleted. */
const ROOM_IDLE_MS = 10 * 60_000;

type Member = {
  /** The client's secret playerId (from its sessionStorage). Never sent to clients. */
  secret: string;
  /** Public seat id. */
  id: string;
  name: string;
  color: number;
  lastSeen: number;
};

type Match = Omit<OnlineMatch, "validating" | "checking"> & {
  usedCanonicalIds: string[];
  /** Countdown time left when paused during the countdown. */
  pausedPhaseLeftMs: number | null;
  validating: { token: number; player: number; submission: string } | null;
};

type Room = {
  code: string;
  status: RoomStatus;
  loadingFrom: LoadingFrom | null;
  settings: RoomSettings;
  members: Member[];
  hostId: string;
  match: Match | null;
  matchCount: number;
  /** Categories already played in this room, per genre, so new matches don't repeat them. */
  played: Record<string, string[]>;
  /** A category being generated ahead of time for the next match. */
  prefetch: { key: string; promise: Promise<Topic> } | null;
  notice: string | null;
  version: number;
  /** Bumped to discard a stale category generation. */
  loadToken: number;
  /** Bumped per referee call so a late verdict for an old turn is ignored. */
  validationToken: number;
  eventCount: number;
  lastActivity: number;
};

declare global {
  var __blitzRooms: Map<string, Room> | undefined;
}

const rooms: Map<string, Room> = (globalThis.__blitzRooms ??= new Map());

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

const bump = (room: Room) => {
  room.version += 1;
};

const isLive = (room: Room) => rooms.get(room.code) === room;

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

function randomString(alphabet: string, length: number): string {
  const bytes = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function newRoomCode(): string {
  for (let attempt = 0; attempt < 200; attempt++) {
    const code = randomString(ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH);
    if (!rooms.has(code)) return code;
  }
  fail(503, "Couldn't find a free room code. Try again!");
}

const PLAYER_ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

export function requirePlayerId(value: string | null): string {
  if (!value || !PLAYER_ID_PATTERN.test(value)) fail(400, "Missing or invalid player id");
  return value;
}

export function requireRoomCode(value: string): string {
  const code = value.toUpperCase();
  if (!isRoomCode(code)) fail(404, "Room not found. Check the code and try again.");
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

/** Trims the name, falls back to "Player N", and de-duplicates it within the room. */
function pickName(room: Room | null, value: unknown): string {
  const members = room?.members ?? [];
  const base = cleanText(value).slice(0, MAX_NAME_LENGTH) || defaultPlayerName(members.length);
  const taken = new Set(members.map((m) => m.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const candidate = base.slice(0, MAX_NAME_LENGTH - suffix.length) + suffix;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

function freeColor(room: Room | null): number {
  const used = new Set(room?.members.map((m) => m.color));
  for (let color = 0; color < PLAYER_COLORS.length; color++) if (!used.has(color)) return color;
  return 0;
}

function newMember(room: Room | null, secret: string, name: unknown, now: number): Member {
  return {
    secret,
    id: randomString("abcdefghijkmnpqrstuvwxyz23456789", 10),
    name: pickName(room, name),
    color: freeColor(room),
    lastSeen: now,
  };
}

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

function endMatch(room: Room, match: Match, winner: number | null) {
  match.phase = "over";
  match.exploding = null;
  match.phaseEndsAt = null;
  match.turnStartedAt = null;
  match.validating = null;
  match.paused = false;
  match.pausedBy = null;
  match.winner = winner;
  // Get the next category going so "Replay (Same Genre)" starts quickly.
  prefetchTopic(room, match.settings);
}

function settle(room: Room, match: Match, at: number) {
  const survivors = survivorsOf(match);
  if (survivors.length <= 1) {
    endMatch(room, match, survivors[0] ?? null);
    return;
  }
  match.phase = "playing";
  match.phaseEndsAt = null;
  match.active = nextSurvivor(match.players, match.exploding ?? match.active);
  match.exploding = null;
  startClock(match, at);
}

/**
 * Applies every time-based transition due by `now`. Transitions happen at the
 * exact time they were due, not when a request noticed them, so results never
 * depend on polling cadence.
 */
function advance(room: Room, now: number) {
  const match = room.match;
  if (!match || match.paused) return;
  let changed = false;

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
      settle(room, match, match.phaseEndsAt);
    } else {
      break;
    }
    changed = true;
  }

  if (changed) bump(room);
}

/** A player left mid-match: they're out, without the explosion pause. */
function forfeit(room: Room, match: Match, index: number, now: number) {
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
    endMatch(room, match, survivors[0] ?? null);
    return;
  }
  if (wasActive) {
    match.active = nextSurvivor(match.players, index);
    startClock(match, now);
  }
}

function pushEvent(room: Room, match: Match, event: Omit<MatchEvent, "id">) {
  room.eventCount += 1;
  match.event = { id: room.eventCount, ...event };
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

function removeMember(room: Room, member: Member, now: number) {
  room.members = room.members.filter((m) => m !== member);
  const index = room.match?.players.findIndex((p) => p.id === member.id) ?? -1;
  if (room.match && index >= 0) forfeit(room, room.match, index, now);

  if (room.members.length === 0) {
    rooms.delete(room.code);
    return;
  }
  // Promote the longest-standing player.
  if (room.hostId === member.id) room.hostId = room.members[0].id;
  bump(room);
}

/** Drops players who stopped polling, and rooms nobody is polling. */
function sweep(now: number) {
  for (const room of rooms.values()) {
    if (now - room.lastActivity > ROOM_IDLE_MS) {
      rooms.delete(room.code);
      continue;
    }
    for (const member of room.members) {
      if (now - member.lastSeen > STALE_MS) removeMember(room, member, now);
    }
  }
}

/** Looks up the room and the requester, marks them as seen, and advances the clock. */
function enter(rawCode: string, secret: string, now: number): { room: Room; member: Member } {
  const code = requireRoomCode(rawCode);
  const room = rooms.get(code);
  const member = room?.members.find((m) => m.secret === secret);
  if (room && member) {
    member.lastSeen = now;
    room.lastActivity = now;
  }
  sweep(now);
  if (!room || !isLive(room)) fail(404, "Room not found. It may have closed.");
  if (!member || !room.members.includes(member)) fail(410, "You're not in this room anymore.");
  advance(room, now);
  return { room, member };
}

function requireHost(room: Room, member: Member) {
  if (room.hostId !== member.id) fail(403, "Only the host can do that.");
}

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

const genreKey = (genre: string) => genre.trim().toLowerCase();
const topicKey = (settings: RoomSettings) => `${settings.difficulty}|${genreKey(settings.genre)}`;

async function requestTopic(room: Room, settings: RoomSettings): Promise<Topic> {
  const topic = await generateTopic({
    genre: settings.genre,
    difficulty: settings.difficulty,
    previousCategories: room.played[genreKey(settings.genre)] ?? [],
  });
  if (!topic) throw new Error("AI returned an incomplete topic");
  return topic;
}

function prefetchTopic(room: Room, settings: RoomSettings) {
  const key = topicKey(settings);
  if (room.prefetch?.key === key) return;
  const promise = requestTopic(room, settings);
  // Failures are handled (and retried) when the prefetch is used.
  promise.catch(() => {});
  room.prefetch = { key, promise };
}

/** Uses the prefetched category when it matches, otherwise generates one. */
async function obtainTopic(room: Room, settings: RoomSettings): Promise<Topic> {
  const prefetched = room.prefetch;
  room.prefetch = null;
  if (prefetched?.key === topicKey(settings)) {
    try {
      return await prefetched.promise;
    } catch {
      // Fall through and try again.
    }
  }
  return requestTopic(room, settings);
}

function newMatch(room: Room, settings: RoomSettings, topic: Topic, now: number): Match {
  const order = shuffle(room.members);
  const key = genreKey(settings.genre);
  room.played[key] = [...(room.played[key] ?? []), topic.category].slice(-MAX_PREVIOUS_CATEGORIES);
  room.matchCount += 1;
  return {
    id: room.matchCount,
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

/**
 * Generates a category and starts a new match with every current member in a
 * freshly shuffled turn order. Everyone sees `loading` meanwhile.
 */
async function loadMatch(room: Room, settings: RoomSettings, from: LoadingFrom) {
  if (room.members.length < MIN_PLAYERS) fail(409, `Need at least ${MIN_PLAYERS} players to start.`);

  const previousStatus = room.status;
  room.status = "loading";
  room.loadingFrom = from;
  room.notice = null;
  const token = ++room.loadToken;
  bump(room);

  let topic: Topic | null = null;
  let problem: string | null = null;
  try {
    topic = await obtainTopic(room, settings);
  } catch (err) {
    problem = aiErrorMessage(err, "Couldn't pick a category. Try again!");
  }

  // The room closed, or a newer load replaced this one.
  if (!isLive(room) || room.loadToken !== token || room.status !== "loading") return;

  if (topic && room.members.length >= MIN_PLAYERS) {
    room.match = newMatch(room, settings, topic, Date.now());
    room.status = "playing";
  } else {
    room.status = previousStatus;
    room.notice = problem ?? `Need at least ${MIN_PLAYERS} players to start.`;
  }
  room.loadingFrom = null;
  bump(room);
}

// ---------------------------------------------------------------------------
// View
// ---------------------------------------------------------------------------

function toView(room: Room, viewer: Member | null, now: number): RoomView {
  const match = room.match;
  return {
    code: room.code,
    status: room.status,
    loadingFrom: room.loadingFrom,
    settings: room.settings,
    players: room.members.map((m) => ({
      id: m.id,
      name: m.name,
      color: m.color,
      isHost: m.id === room.hostId,
      away: now - m.lastSeen > AWAY_MS,
    })),
    hostId: room.hostId,
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
    notice: room.notice,
    version: room.version,
    serverNow: now,
  };
}

// ---------------------------------------------------------------------------
// Actions (one per route)
// ---------------------------------------------------------------------------

export function createRoom(secret: string, body: Record<string, unknown>): RoomView {
  const now = Date.now();
  sweep(now);
  const settings = parseSettings(body.settings);
  const host = newMember(null, secret, body.name, now);
  const room: Room = {
    code: newRoomCode(),
    status: "lobby",
    loadingFrom: null,
    settings,
    members: [host],
    hostId: host.id,
    match: null,
    matchCount: 0,
    played: {},
    prefetch: null,
    notice: null,
    version: 1,
    loadToken: 0,
    validationToken: 0,
    eventCount: 0,
    lastActivity: now,
  };
  rooms.set(room.code, room);
  // Start on the first category while everyone joins.
  prefetchTopic(room, settings);
  return toView(room, host, now);
}

/** Room state for polling. Non-members (checking a code before joining) get `you: null`. */
export function getRoom(rawCode: string, secret: string): RoomView {
  const now = Date.now();
  const code = requireRoomCode(rawCode);
  const room = rooms.get(code);
  if (!room?.members.some((m) => m.secret === secret)) {
    sweep(now);
    if (!room || !isLive(room)) fail(404, "Room not found. Check the code and try again.");
    advance(room, now);
    return toView(room, null, now);
  }
  const { member } = enter(code, secret, now);
  return toView(room, member, now);
}

export function joinRoom(rawCode: string, secret: string, body: Record<string, unknown>): RoomView {
  const now = Date.now();
  const code = requireRoomCode(rawCode);
  sweep(now);
  const room = rooms.get(code);
  if (!room) fail(404, "Room not found. Check the code and try again.");

  let member = room.members.find((m) => m.secret === secret);
  if (member) {
    // Rejoining from the same tab just refreshes the name.
    member.lastSeen = now;
    const others = { ...room, members: room.members.filter((m) => m !== member) };
    member.name = pickName(others, body.name);
  } else {
    if (room.members.length >= MAX_PLAYERS) fail(409, `This room is full (${MAX_PLAYERS} players max).`);
    member = newMember(room, secret, body.name, now);
    room.members.push(member);
  }
  room.lastActivity = now;
  advance(room, now);
  bump(room);
  return toView(room, member, now);
}

export async function startRoom(rawCode: string, secret: string): Promise<RoomView> {
  const { room, member } = enter(rawCode, secret, Date.now());
  requireHost(room, member);
  if (room.status !== "lobby") fail(409, "The game has already started.");
  await loadMatch(room, room.settings, "lobby");
  return toView(room, member, Date.now());
}

export async function submitAnswer(
  rawCode: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<RoomView> {
  // The clock freezes at the moment the server receives the answer.
  const receivedAt = Date.now();
  const { room, member } = enter(rawCode, secret, receivedAt);
  const match = room.match;
  if (room.status !== "playing" || !match) fail(409, "No match in progress.");

  const submission = cleanText(body.submission);
  if (!submission) fail(400, "Type an answer first!");
  if (submission.length > MAX_ANSWER_LENGTH) fail(400, "That answer is too long.");
  if (match.phase === "exploding" && match.exploding !== null && match.players[match.exploding].id === member.id) {
    fail(409, "Time's up!");
  }
  if (match.phase !== "playing") fail(409, "Answers aren't open right now.");
  if (match.paused) fail(409, "The game is paused.");
  if (match.validating) fail(409, "The referee is still checking an answer.");
  const player = match.active;
  if (match.players[player].id !== member.id) fail(403, "It's not your turn.");

  // Instant duplicate check. The clock keeps running, as in local games.
  const key = toCanonicalId(submission);
  if (key && match.usedKeys.includes(key)) fail(409, `“${submission}” was already said!`);

  stopClock(match, receivedAt);
  const token = ++room.validationToken;
  match.validating = { token, player, submission };
  bump(room);

  let verdict: Awaited<ReturnType<typeof judgeMove>> = null;
  let problem: string | null = null;
  try {
    verdict = await judgeMove({
      genre: match.settings.genre,
      category: match.topic.category,
      submission,
      usedCanonicalIds: match.usedCanonicalIds,
    });
    if (!verdict) problem = "The referee mumbled. Try that answer again!";
  } catch (err) {
    problem = aiErrorMessage(err, "The referee is unavailable. Try again!");
  }

  const now = Date.now();
  // The room closed, the player left, or the match moved on while the referee thought.
  if (!isLive(room)) fail(410, "The room closed.");
  if (room.match !== match || match.validating?.token !== token) return toView(room, member, now);

  match.validating = null;
  if (verdict && verdict.valid && !verdict.isDuplicate) {
    const p = match.players[player];
    p.lastAnswer = verdict.displayName;
    p.answers += 1;
    const keys = [verdict.canonicalId, key, ...nameVariantIds(verdict.displayName)];
    match.usedCanonicalIds.push(verdict.canonicalId);
    match.usedKeys = [...new Set([...match.usedKeys, ...keys.filter(Boolean)])];
    match.feed = [{ canonicalId: verdict.canonicalId, displayName: verdict.displayName, player }, ...match.feed];
    match.active = nextSurvivor(match.players, player);
    pushEvent(room, match, {
      tone: verdict.autoCorrected ? "corrected" : "success",
      player,
      text: verdict.displayName,
    });
  } else {
    pushEvent(room, match, {
      tone: "error",
      player,
      text:
        problem ??
        (verdict?.reason || (verdict?.isDuplicate ? "That one was already used!" : "That one doesn't count.")),
    });
  }
  // Resume (or start the next player's clock) from now: referee time is never charged.
  startClock(match, now);
  bump(room);
  return toView(room, member, now);
}

/** A client saw a fuse hit zero. `enter` already applied it if it's really due. */
export function reportTimeout(rawCode: string, secret: string): RoomView {
  const now = Date.now();
  const { room, member } = enter(rawCode, secret, now);
  return toView(room, member, now);
}

export function setPaused(rawCode: string, secret: string, body: Record<string, unknown>): RoomView {
  const now = Date.now();
  const { room, member } = enter(rawCode, secret, now);
  const match = room.match;
  if (room.status !== "playing" || !match) fail(409, "No match in progress.");
  const paused = body.paused === true;
  if (paused === match.paused) return toView(room, member, now);

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
      startClock(match, now);
    }
  }
  bump(room);
  return toView(room, member, now);
}

const REPLAY_ACTIONS: ReplayAction[] = ["same_genre", "choose_genre", "cancel_genre", "new_genre"];

export async function replayRoom(
  rawCode: string,
  secret: string,
  body: Record<string, unknown>,
): Promise<RoomView> {
  const { room, member } = enter(rawCode, secret, Date.now());
  requireHost(room, member);
  const action = body.action as ReplayAction;
  if (!REPLAY_ACTIONS.includes(action)) fail(400, `action must be one of ${REPLAY_ACTIONS.join(", ")}`);
  const matchOver = room.status === "playing" && room.match?.phase === "over";

  switch (action) {
    case "same_genre":
      if (!matchOver || !room.match) fail(409, "The match isn't over yet.");
      await loadMatch(room, room.match.settings, "replay");
      break;

    case "choose_genre":
      if (!matchOver) fail(409, "The match isn't over yet.");
      room.status = "changing_settings";
      room.notice = null;
      bump(room);
      break;

    case "cancel_genre":
      if (room.status !== "changing_settings") fail(409, "Nobody is choosing a genre.");
      room.status = room.match ? "playing" : "lobby";
      room.notice = null;
      bump(room);
      break;

    case "new_genre": {
      if (room.status !== "changing_settings") fail(409, "Choose a new genre first.");
      const settings = parseSettings(body.settings);
      room.settings = settings;
      await loadMatch(room, settings, "settings");
      break;
    }
  }
  return toView(room, member, Date.now());
}

export function leaveRoom(rawCode: string, secret: string) {
  const now = Date.now();
  const code = requireRoomCode(rawCode);
  const room = rooms.get(code);
  const member = room?.members.find((m) => m.secret === secret);
  if (room && member) removeMember(room, member, now);
}

// ---------------------------------------------------------------------------
// Route glue
// ---------------------------------------------------------------------------

type RoomAction = (playerId: string, body: Record<string, unknown>) => unknown;

/**
 * Runs a room action for a route handler: reads the player id header and JSON
 * body, and maps RoomErrors to JSON error responses.
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
