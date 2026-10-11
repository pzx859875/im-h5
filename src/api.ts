import { config } from "./config";
import type {
  Channel,
  Guest,
  Member,
  Preview,
  Snapshot,
  SpeakRequest,
} from "./types";
export class ApiError extends Error {
  constructor(
    public status: number,
    public reason = "",
    public code = 0,
  ) {
    super(reason || `HTTP ${status}`);
  }
}
const reasons: Record<string, string> = {
  channel_capacity_reached: "会议人数已满，请稍后重试。",
  channel_full: "会议人数已满，请稍后重试。",
  invitation_expired: "邀请已过期，请联系分享人。",
  invitation_revoked: "邀请已撤销，请联系分享人。",
  invitation_invalid: "邀请无效，请重新打开完整邀请链接。",
  channel_ended: "会议已结束。",
  guest_expired: "游客身份已到期，请重新打开邀请链接。",
  guest_revoked: "游客资格已失效。",
  guest_disabled: "暂未开放游客入会。",
  room_guest_invitation_required:
    "此聊天室需要独立的游客邀请，请联系分享人补全链接。",
  participant_kicked: "你已被管理员移出会议。",
  speak_request_cooldown: "操作较频繁，请稍后再试。",
  "speak request is only available in host mode":
    "当前为自由发言模式，无需申请。",
  "channel participant not found": "入会状态同步中，请稍后重新申请。",
  "microphone is already allowed": "发言权限正在同步，请稍后开启麦克风。",
  "channel full": "会议人数已满，请稍后重试。",
  "channel has ended": "会议已结束。",
};
export function friendlyError(error: unknown) {
  if (error instanceof ApiError) {
    if (reasons[error.reason]) return reasons[error.reason];
    if (error.status === 401) return "游客身份验证失败，请重新打开邀请链接。";
    if (error.status === 403) return "当前操作不可用，请联系会议管理员。";
    if (error.status === 404 || error.status === 501)
      return "此能力暂未开放，请稍后再试。";
    if (error.status === 0) return "网络连接失败，请检查网络后重试。";
    return "操作未完成，请稍后重试或联系会议管理员。";
  }
  if (
    error instanceof Error &&
    ["NotAllowedError", "PermissionDeniedError"].includes(error.name)
  )
    return "麦克风未获授权。可在浏览器设置中允许，或继续旁听和聊天。";
  if (error instanceof Error && error.name === "NotFoundError")
    return "未找到麦克风，可以继续旁听和聊天。";
  return error instanceof UserError
    ? error.message
    : "操作未完成，请检查网络和设备后重试。";
}
export class UserError extends Error {}
const legacyReasons: Record<string, string> = {
  "guest qualification invalid or expired": "guest_expired",
  "room or channel guest mode disabled": "guest_disabled",
  "channel participant was kicked": "participant_kicked",
  "invitation invalid": "invitation_invalid",
  "invitation expired": "invitation_expired",
  "invitation revoked": "invitation_revoked",
  "channel ended": "channel_ended",
  "channel capacity reached": "channel_capacity_reached",
  "speak request is cooling down": "speak_request_cooldown",
  "speak request already pending": "speak_request_already_pending",
  "speak request is not pending": "speak_request_not_pending",
};
export function terminalAuth(error: unknown) {
  return (
    error instanceof ApiError &&
    (error.status === 401 ||
      ["guest_expired", "guest_revoked", "participant_kicked"].includes(
        error.reason,
      ))
  );
}
export function terminalAccess(error: unknown) {
  return (
    terminalAuth(error) ||
    (error instanceof ApiError &&
      ["guest_disabled", "channel_ended"].includes(error.reason))
  );
}
export class RoomApi {
  token = "";
  constructor(
    public base = config.community,
    private fetcher: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}
  async call<T>(
    path: string,
    method = "GET",
    body?: unknown,
    extra?: Record<string, string>,
    keepalive = false,
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 15000);
    try {
      const res = await this.fetcher(this.base + path, {
        method,
        headers: {
          ...(body === undefined ? {} : { "Content-Type": "application/json" }),
          ...(this.token ? { token: this.token } : {}),
          ...extra,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: abort.signal,
        credentials: "omit",
        cache: "no-store",
        referrerPolicy: "no-referrer",
        keepalive,
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data || data.errCode !== 0)
        throw new ApiError(
          res.status,
          data?.reason || legacyReasons[data?.errMsg] || data?.errMsg || "",
          data?.errCode,
        );
      return data.data as T;
    } catch (e) {
      if (e instanceof ApiError) throw e;
      throw new ApiError(0);
    } finally {
      clearTimeout(timer);
    }
  }
  preview = (invite: string) =>
    this.call<Preview>(
      `/channel-invitations/${encodeURIComponent(invite)}/preview`,
    );
  guestJoin = (
    room: string,
    nickname: string,
    platformID: number,
    key: string,
    inviteToken?: string,
  ) =>
    this.call<Guest>(
      `/guest/rooms/${encodeURIComponent(room)}/join`,
      "POST",
      { nickname, platformID, ...(inviteToken ? { inviteToken } : {}) },
      { "Idempotency-Key": key },
    );
  refresh = () => this.call<Guest>("/guest/token/refresh", "POST", {});
  eligibility = (invite: string) =>
    this.call<{ canJoin: boolean; reason?: string }>(
      `/channel-invitations/${encodeURIComponent(invite)}/eligibility`,
    );
  accept = (invite: string) =>
    this.call<{ serverUrl: string; token: string }>(
      `/channel-invitations/${encodeURIComponent(invite)}/accept`,
      "POST",
      {},
    );
  channel = (id: string) =>
    this.call<Channel>(`/channel/${encodeURIComponent(id)}`);
  members = (id: string) =>
    this.call<Member[]>(`/channelMemberList/${encodeURIComponent(id)}`);
  requestSpeak = (id: string) =>
    this.call<SpeakRequest>(
      `/channels/${encodeURIComponent(id)}/speak-requests`,
      "POST",
      {},
    );
  cancelSpeak = (id: string) =>
    this.call(
      `/channels/${encodeURIComponent(id)}/speak-requests/me`,
      "DELETE",
    );
  snapshot = (id: string) =>
    this.call<Snapshot>(`/channels/${encodeURIComponent(id)}/session/me`);
  leave = (id: string) =>
    this.call(
      `/channelLeave/${encodeURIComponent(id)}`,
      "POST",
      {},
      undefined,
      true,
    );
}
