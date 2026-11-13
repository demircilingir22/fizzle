/** Public site identity, shared by metadata and the invite flow. */

export const SITE_NAME = "Fizzle";
export const SITE_HOST = "fizzlegame.com";
export const SITE_URL = `https://${SITE_HOST}`;

export const SITE_TITLE = "Fizzle — The Pastel Bomb Naming Game";
export const SITE_DESCRIPTION =
  "Pass the ticking pastel bomb! Name items in the category before your fuse runs out. Play locally or online at fizzlegame.com.";

/** Query parameter carrying a room code in invite links: fizzlegame.com/?room=ABCD */
export const INVITE_PARAM = "room";

/** Dev and LAN hosts, where invite links should point at this machine instead of fizzlegame.com. */
export function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    /^127\./.test(hostname) ||
    /^10\./.test(hostname) ||
    /^192\.168\./.test(hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
  );
}

/** Where invitees should go: this machine during local play, fizzlegame.com everywhere else. */
export function inviteOrigin(location: Pick<Location, "hostname" | "origin">): string {
  return isLocalHost(location.hostname) ? location.origin : SITE_URL;
}

export const inviteLink = (origin: string, code: string) => `${origin}/?${INVITE_PARAM}=${encodeURIComponent(code)}`;
