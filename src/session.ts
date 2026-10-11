import { config } from "./config";
import type { Guest, Invitation } from "./types";
const prefix = `h5-meeting:${config.community}:`;
export const safeStorage = {
  get(store: Storage, key: string) {
    try {
      return store.getItem(prefix + key);
    } catch {
      return null;
    }
  },
  set(store: Storage, key: string, value: string) {
    try {
      store.setItem(prefix + key, value);
      return true;
    } catch {
      return false;
    }
  },
  remove(store: Storage, key: string) {
    try {
      store.removeItem(prefix + key);
    } catch {
      /* private browsing */
    }
  },
};
export function validGuest(
  value: unknown,
  roomId: string,
  now = Date.now(),
): value is Guest {
  const g = value as Guest | null;
  return (
    !!g &&
    g.identityType === "guest" &&
    g.roomId === roomId &&
    typeof g.userId === "string" &&
    g.userId.startsWith("guest_") &&
    typeof g.token === "string" &&
    !!g.token &&
    typeof g.nickname === "string" &&
    Date.parse(g.tokenExpiresAt) > now &&
    Date.parse(g.guestExpiresAt) > now
  );
}
export function loadGuest(roomId: string): Guest | null {
  try {
    const g = JSON.parse(
      safeStorage.get(localStorage, "guest:" + roomId) || "null",
    );
    if (validGuest(g, roomId)) return g;
    safeStorage.remove(localStorage, "guest:" + roomId);
    return null;
  } catch {
    return null;
  }
}
export const saveGuest = (g: Guest) =>
  safeStorage.set(localStorage, "guest:" + g.roomId, JSON.stringify(g));
export const clearGuest = (room: string) =>
  safeStorage.remove(localStorage, "guest:" + room);
export function parseInvitation(url: string): Invitation | null {
  const u = new URL(url);
  const hash = u.hash.slice(1);
  const q = new URLSearchParams(hash.includes("?") ? hash.split("?")[1] : hash);
  const get = (key: string) =>
    q.get(key) || u.searchParams.get(key) || undefined;
  const pathToken = u.pathname.match(/\/join\/([^/]+)\/?$/)?.[1];
  const channelInvite =
    get("channelInvite") ||
    (pathToken ? decodeURIComponent(pathToken) : undefined);
  if (!channelInvite || channelInvite.length > 2048) return null;
  return {
    channelInvite,
    roomInvite: get("roomInvite"),
    roomId: get("roomId"),
  };
}
export function captureInvitation(): Invitation | null {
  let invite: Invitation | null = null;
  try {
    invite = parseInvitation(location.href);
  } catch {
    /* invalid percent escape */
  }
  if (invite) {
    safeStorage.set(sessionStorage, "invite", JSON.stringify(invite));
    history.replaceState(
      null,
      "",
      location.pathname.includes("/join/") ? "/" : location.pathname,
    );
    return invite;
  }
  try {
    return JSON.parse(safeStorage.get(sessionStorage, "invite") || "null");
  } catch {
    return null;
  }
}
export function joinKey(room: string, nickname: string, invite?: string) {
  const key = "attempt:" + room;
  try {
    const prev = JSON.parse(safeStorage.get(sessionStorage, key) || "null");
    if (
      prev &&
      prev.nickname === nickname &&
      prev.invite === invite &&
      prev.until > Date.now()
    )
      return prev.id as string;
  } catch {
    /* new attempt */
  }
  const id = crypto.randomUUID();
  safeStorage.set(
    sessionStorage,
    key,
    JSON.stringify({ id, nickname, invite, until: Date.now() + 600000 }),
  );
  return id;
}
// OpenIM Web is a single platform session: coordinate across all meetings for this backend.
export async function lockSession(): Promise<() => void> {
  if (!navigator.locks)
    throw new Error("当前浏览器不支持会话协调，请使用较新的系统浏览器。");
  return new Promise((resolve, reject) => {
    void navigator.locks
      .request(prefix + "active", { ifAvailable: true }, (lock) => {
        if (!lock) {
          reject(new Error("另一个页面正在参加会议，请先在原页面挂断。"));
          return;
        }
        return new Promise<void>((release) => resolve(release));
      })
      .catch(reject);
  });
}
