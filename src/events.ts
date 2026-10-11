import { config } from "./config";
import { decodeMeetingEvent } from "./protocol";
import type { Guest, MeetingEvent } from "./types";
// Lightweight JS SDK: management events only, no local message database.
export async function startEvents(
  guest: Guest,
  channel: string,
  since: number,
  event: (e: MeetingEvent) => void,
  status: (s: string) => void,
  invalid: () => void,
) {
  const { getSDK, CbEvents, LogLevel } = await import("@openim/client-sdk");
  // The SDK wrapper logs arguments before login applies its logLevel.
  const { default: logger } = await import("loglevel");
  logger.setLevel("silent", false);
  const sdk = getSDK();
  let active = true;
  const seen = new Set<string>();
  const receive = ({ data }: { data: unknown }) => {
    for (const message of Array.isArray(data) ? data : [data]) {
      const e = decodeMeetingEvent(
        message,
        config.adminId,
        guest.userId,
        channel,
        since,
      );
      if (!active || !e || seen.has(e.eventId)) continue;
      seen.add(e.eventId);
      if (seen.size > 1000) seen.delete(seen.values().next().value!);
      event(e);
    }
  };
  const ready = () => active && status("connected");
  const failed = () => active && status("unavailable");
  const expired = () => active && invalid();
  sdk.on(CbEvents.OnRecvNewMessages, receive);
  sdk.on(CbEvents.OnRecvNewMessage, receive);
  sdk.on(CbEvents.OnConnectSuccess, ready);
  sdk.on(CbEvents.OnConnecting, failed);
  sdk.on(CbEvents.OnConnectFailed, failed);
  sdk.on(CbEvents.OnKickedOffline, expired);
  sdk.on(CbEvents.OnUserTokenExpired, expired);
  sdk.on(CbEvents.OnUserTokenInvalid, expired);
  const stop = async () => {
    active = false;
    sdk.off(CbEvents.OnRecvNewMessages, receive);
    sdk.off(CbEvents.OnRecvNewMessage, receive);
    sdk.off(CbEvents.OnConnectSuccess, ready);
    sdk.off(CbEvents.OnConnecting, failed);
    sdk.off(CbEvents.OnConnectFailed, failed);
    sdk.off(CbEvents.OnKickedOffline, expired);
    sdk.off(CbEvents.OnUserTokenExpired, expired);
    sdk.off(CbEvents.OnUserTokenInvalid, expired);
    try {
      await sdk.logout();
    } catch {
      /* a failed login may already be logged out */
    }
  };
  void sdk
    .login({
      userID: guest.userId,
      token: guest.token,
      platformID: 5,
      apiAddr: config.imApi,
      wsAddr: config.imWs,
      logLevel: LogLevel.Silent,
    })
    .catch(failed);
  return stop;
}
