/**
 * Client-side online identity. Each browser tab is its own player: the
 * playerId lives in sessionStorage (not localStorage), so 2-4 tabs on one
 * computer can all join the same room as different players.
 *
 * Client-only: call these from event handlers and effects, never during render
 * on the server.
 */

const PLAYER_KEY = "blitz-duel:playerId";
const ROOM_KEY = "blitz-duel:roomCode";
const CHANNEL = "blitz-duel:players";

const ID_PATTERN = /^[A-Za-z0-9_-]{16,64}$/;

function session(): Storage | null {
  try {
    return window.sessionStorage;
  } catch {
    return null;
  }
}

function newId(): string {
  // getRandomValues works on plain-http LAN addresses, unlike crypto.randomUUID.
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Fallback when sessionStorage is blocked (the id then lasts until reload). */
let memoryId: string | null = null;

function storeId(id: string) {
  memoryId = id;
  try {
    session()?.setItem(PLAYER_KEY, id);
  } catch {
    // Storage full or blocked: the in-memory copy still works.
  }
}

/** This tab's secret player id, created on first use. */
export function getPlayerId(): string {
  let stored: string | null = null;
  try {
    stored = session()?.getItem(PLAYER_KEY) ?? null;
  } catch {
    stored = null;
  }
  const id = stored && ID_PATTERN.test(stored) ? stored : (memoryId ?? newId());
  if (id !== stored || id !== memoryId) storeId(id);
  return id;
}

/** The room this tab is in, so a reload drops the player straight back into it. */
export const savedRoom = {
  get(): string | null {
    try {
      return session()?.getItem(ROOM_KEY) ?? null;
    } catch {
      return null;
    }
  },
  set(code: string) {
    try {
      session()?.setItem(ROOM_KEY, code);
    } catch {
      // Not critical: only reload-resume is lost.
    }
  },
  clear() {
    try {
      session()?.removeItem(ROOM_KEY);
    } catch {
      // Ignore.
    }
  },
};

type ChannelMessage = { type: "hello" | "taken"; id: string };

/**
 * "Duplicate tab" copies sessionStorage, which would make two tabs the same
 * player. A newly opened tab announces its id; if another open tab already
 * uses it, the new tab switches to a fresh id (and forgets the copied room).
 * Returns a cleanup function.
 */
export function guardDuplicateTabs(onReplaced: () => void): () => void {
  if (typeof BroadcastChannel === "undefined") return () => {};
  const channel = new BroadcastChannel(CHANNEL);
  const announced = getPlayerId();
  let replaced = false;

  channel.onmessage = (event: MessageEvent<ChannelMessage>) => {
    const message = event.data;
    if (!message || typeof message.id !== "string") return;
    const mine = getPlayerId();
    if (message.type === "hello" && message.id === mine) {
      channel.postMessage({ type: "taken", id: mine } satisfies ChannelMessage);
    } else if (message.type === "taken" && message.id === announced && !replaced) {
      replaced = true;
      storeId(newId());
      savedRoom.clear();
      onReplaced();
    }
  };
  channel.postMessage({ type: "hello", id: announced } satisfies ChannelMessage);
  return () => channel.close();
}
