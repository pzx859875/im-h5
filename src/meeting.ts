import {
  Room,
  RoomEvent,
  Track,
  ConnectionState,
  type RemoteParticipant,
} from "livekit-client";
import {
  RoomApi,
  ApiError,
  UserError,
  friendlyError,
  terminalAuth,
  terminalAccess,
} from "./api";
import { config } from "./config";
import {
  clearGuest,
  joinKey,
  loadGuest,
  lockSession,
  saveGuest,
  validGuest,
} from "./session";
import { decodeChat, encodeChat, nicknameValid } from "./protocol";
import { startEvents } from "./events";
import { prepareImage, uploadImageFile, validateImage } from "./images";
import type {
  Channel,
  ChatMessage,
  Guest,
  Invitation,
  Member,
  MeetingEvent,
  Preview,
  RequestStatus,
  Snapshot,
} from "./types";

export interface MeetingState {
  phase:
    | "entry"
    | "loading"
    | "joining"
    | "online"
    | "reconnecting"
    | "leaving"
    | "left"
    | "ended";
  preview?: Preview;
  guest?: Guest;
  channel?: Channel;
  roomId?: string;
  error: string;
  notice: string;
  members: Member[];
  messages: ChatMessage[];
  room?: Room;
  mediaRevision: number;
  canMic: boolean;
  mic: boolean;
  muted: boolean;
  request: RequestStatus;
  requestId?: string;
  requestExpires?: string;
  actionBusy: boolean;
  imageBusy: boolean;
  imStatus: string;
  snapshot?: Snapshot;
  snapshotAvailable: boolean;
  canPlayAudio: boolean;
  cooldownUntil: number;
}
export function microphoneAllowed(room: Room) {
  const p = room.localParticipant.permissions;
  // Proto TrackSource.MICROPHONE = 2. Empty list grants all sources per LiveKit.
  return (
    !!p?.canPublish &&
    (p.canPublishSources.length === 0 || p.canPublishSources.includes(2))
  );
}
export class MeetingController {
  state: MeetingState = {
    phase: "entry",
    error: "",
    notice: "",
    members: [],
    messages: [],
    mediaRevision: 0,
    canMic: false,
    mic: false,
    muted: false,
    request: "unknown",
    actionBusy: false,
    imageBusy: false,
    imStatus: "idle",
    snapshotAvailable: config.selfSnapshot,
    canPlayAudio: true,
    cooldownUntil: 0,
  };
  private listeners = new Set<() => void>();
  private generation = 0;
  private release?: () => void;
  private stopEvents?: () => Promise<void>;
  private eventTask?: Promise<void>;
  private tick?: ReturnType<typeof setInterval>;
  private memberTimer?: ReturnType<typeof setTimeout>;
  private polling = false;
  private refreshBusy = false;
  private accepted = false;
  private eventTime = 0;
  private enteredAt = 0;
  private seen = new Set<string>();
  private imageFiles = new Map<string, File>();
  private imageUrls = new Map<string, string>();
  private uploadAbort?: AbortController;
  private apiMembers: Member[] = [];
  private departed = new Set<string>();
  private memberRequest = 0;
  constructor(
    public invitation: Invitation | null,
    public api = new RoomApi(),
  ) {}
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  getSnapshot = () => this.state;
  private set(patch: Partial<MeetingState>) {
    this.state = { ...this.state, ...patch };
    for (const f of this.listeners) f();
  }
  dismiss = () => this.set({ error: "", notice: "" });
  private clearInvalidGuest(error: unknown) {
    // A channel closure/kick must not create a replacement Room identity.
    if (
      terminalAuth(error) &&
      error instanceof ApiError &&
      !["participant_kicked", "guest_disabled"].includes(error.reason) &&
      this.state.roomId
    ) {
      clearGuest(this.state.roomId);
      this.set({ guest: undefined });
    }
  }
  private stopOnAccessError(error: unknown) {
    if (!terminalAccess(error)) return false;
    this.clearInvalidGuest(error);
    void this.leave(friendlyError(error), true);
    return true;
  }
  async preview() {
    if (!this.invitation) return;
    const gen = ++this.generation;
    this.set({ phase: "loading", error: "" });
    try {
      const p = await this.api.preview(this.invitation.channelInvite);
      if (gen !== this.generation) return;
      if (!p?.channelId)
        throw new UserError("暂时无法读取会议，请联系分享人。");
      const roomId = p.roomId || this.invitation.roomId;
      if (
        p.roomId &&
        this.invitation.roomId &&
        p.roomId !== this.invitation.roomId
      )
        throw new UserError("邀请信息不一致，请联系分享人重新生成链接。");
      this.set({
        preview: p,
        roomId,
        guest: roomId ? loadGuest(roomId) || undefined : undefined,
        phase: p.meetingState === "ended" ? "ended" : "entry",
      });
    } catch (e) {
      if (gen === this.generation)
        this.set({ phase: "entry", error: friendlyError(e) });
    }
  }
  async join(nickname: string) {
    const { preview, roomId } = this.state;
    if (
      !preview ||
      !roomId ||
      !this.invitation ||
      !["entry", "left"].includes(this.state.phase)
    )
      return;
    if (!nicknameValid(nickname)) {
      this.set({ error: "请输入 1–40 个字符的昵称。" });
      return;
    }
    if (
      !window.isSecureContext ||
      !navigator.mediaDevices ||
      !window.RTCPeerConnection
    ) {
      this.set({
        error: "当前环境不支持语音会议，请通过 HTTPS 链接在系统浏览器打开。",
      });
      return;
    }
    const gen = ++this.generation;
    this.set({
      phase: "joining",
      error: "",
      notice: "",
      request: "unknown",
      requestId: undefined,
      requestExpires: undefined,
      messages: [],
      members: [],
      snapshot: undefined,
      muted: false,
      mic: false,
      canMic: false,
    });
    this.seen.clear();
    this.eventTime = 0;
    try {
      try {
        this.release = await lockSession();
      } catch (e) {
        throw new UserError((e as Error).message);
      }
      if (gen !== this.generation) {
        this.release?.();
        this.release = undefined;
        return;
      }
      let guest = loadGuest(roomId);
      if (!guest) {
        this.api.token = "";
        const result = await this.api.guestJoin(
          roomId,
          nickname.trim(),
          5,
          joinKey(roomId, nickname.trim(), this.invitation.roomInvite),
          this.invitation.roomInvite,
        );
        if (gen !== this.generation) return;
        guest = { ...result, nickname: nickname.trim() };
        if (!validGuest(guest, roomId))
          throw new UserError("游客凭证不完整，请联系会议管理员。");
        if (!saveGuest(guest))
          this.set({
            notice: "当前浏览器无法保存身份，关闭页面后可能需要重新入会。",
          });
      }
      this.api.token = guest.token;
      this.set({ guest });
      const eligibility = await this.api.eligibility(
        this.invitation.channelInvite,
      );
      if (gen !== this.generation) return;
      if (!eligibility?.canJoin) throw new ApiError(400, eligibility?.reason);
      // Mark uncertain acceptance too: timeout may mean server reserved a slot.
      this.accepted = true;
      const media = await this.api.accept(this.invitation.channelInvite);
      if (gen !== this.generation) {
        void this.api.leave(preview.channelId).catch(() => {});
        return;
      }
      // Private-channel detail is unavailable until the LiveKit webhook records
      // membership. Invitation acceptance has already validated Room binding.
      let channel: Channel | undefined;
      try {
        channel = await this.api.channel(preview.channelId);
      } catch (e) {
        if (!(
          e instanceof ApiError &&
          e.reason === "not allowed to view private channel"
        ))
          throw e;
      }
      if (gen !== this.generation) return;
      if (
        channel &&
        (channel.roomId !== roomId || channel.channelId !== preview.channelId)
      )
        throw new UserError("会议与聊天室信息不一致，已停止入会。");
      if (channel?.actualEndTime) throw new ApiError(400, "channel_ended");
      if (channel?.guestEnabled === false)
        throw new ApiError(400, "guest_disabled");
      if (!media?.serverUrl || !media.token)
        throw new UserError("媒体连接信息尚未就绪。");
      if (
        location.protocol === "https:" &&
        !/^wss:|^https:/.test(media.serverUrl)
      )
        throw new UserError("媒体服务暂未配置安全连接，请联系会议管理员。");
      const room = new Room({
        adaptiveStream: true,
        dynacast: true,
        stopLocalTrackOnUnpublish: true,
      });
      this.set({ room, channel });
      this.bindRoom(room, gen);
      await room.connect(media.serverUrl, media.token, { autoSubscribe: true });
      if (gen !== this.generation) {
        await room.disconnect();
        return;
      }
      await room.localParticipant.setMicrophoneEnabled(false);
      // Match APP display metadata so connected guests have a nickname even
      // before the server's participant-joined webhook updates the member API.
      // This is display data only; roles and action permissions remain server-owned.
      void room.localParticipant
        .setMetadata(
          JSON.stringify({
            userInfo: { userID: guest.userId, nickname: guest.nickname },
          }),
        )
        .catch(() => {});
      this.enteredAt = Date.now();
      this.set({
        phase: "online",
        imStatus: config.imEvents ? "connecting" : "disabled",
      });
      this.syncMedia();
      void room.startAudio().catch(() => this.set({ canPlayAudio: false }));
      void this.loadMembers();
      void this.syncSnapshot();
      void this.checkChannel();
      if (config.imEvents) this.eventTask = this.connectEvents(gen);
      this.tick = setInterval(() => {
        void this.maintain(gen);
      }, 5000);
    } catch (e) {
      if (gen !== this.generation) return;
      ++this.generation;
      this.clearInvalidGuest(e);
      await this.cleanup();
      this.set({
        phase: terminalAccess(e) ? "ended" : "entry",
        error: friendlyError(e),
        room: undefined,
        mic: false,
        canMic: false,
      });
    }
  }
  private async connectEvents(gen: number) {
    if (!this.state.guest || !this.state.preview) return;
    try {
      const stop = await startEvents(
        this.state.guest,
        this.state.preview.channelId,
        this.enteredAt,
        (e) => {
          if (gen === this.generation) this.onEvent(e);
        },
        (imStatus) => {
          if (gen === this.generation) this.set({ imStatus });
        },
        () => {
          if (gen === this.generation) {
            clearGuest(this.state.roomId!);
            void this.leave(
              "身份已失效或在其他页面登录，请重新打开邀请链接。",
              true,
            );
          }
        },
      );
      if (gen !== this.generation) await stop();
      else this.stopEvents = stop;
    } catch {
      if (gen === this.generation) this.set({ imStatus: "unavailable" });
    }
  }
  private bindRoom(room: Room, gen: number) {
    const active = () => gen === this.generation;
    const sync = () => {
      if (active()) this.syncMedia();
    };
    for (const e of [
      RoomEvent.TrackSubscribed,
      RoomEvent.TrackUnsubscribed,
      RoomEvent.TrackMuted,
      RoomEvent.TrackUnmuted,
      RoomEvent.LocalTrackPublished,
      RoomEvent.LocalTrackUnpublished,
    ])
      room.on(e, sync);
    room.on(RoomEvent.ParticipantPermissionsChanged, (_prev, participant) => {
      if (active() && participant === room.localParticipant) {
        if (microphoneAllowed(room))
          this.set({
            muted: false,
            request: "approved",
            requestExpires: undefined,
          });
        else if (this.state.request === "approved")
          this.set({ request: "unknown" });
        this.syncMedia();
        void this.syncSnapshot();
      }
    });
    const members = () => {
      sync();
      clearTimeout(this.memberTimer);
      this.memberTimer = setTimeout(() => {
        if (active()) void this.loadMembers();
      }, 2000);
    };
    room.on(RoomEvent.ParticipantConnected, (participant) => {
      if (!active()) return;
      this.departed.delete(participant.identity);
      members();
    });
    room.on(RoomEvent.ParticipantDisconnected, (participant) => {
      if (!active()) return;
      this.departed.add(participant.identity);
      members();
    });
    room.on(RoomEvent.ParticipantMetadataChanged, sync);
    room.on(RoomEvent.ParticipantNameChanged, sync);
    room.on(RoomEvent.AudioPlaybackStatusChanged, () => {
      if (active()) this.set({ canPlayAudio: room.canPlaybackAudio });
    });
    room.on(RoomEvent.Reconnecting, () => {
      if (!active()) return;
      this.uploadAbort?.abort();
      this.stopMic();
      this.set({
        phase: "reconnecting",
        canMic: false,
        notice: "连接中断，正在重连。期间的文字不会补发。",
      });
    });
    room.on(RoomEvent.Reconnected, () => {
      if (!active()) return;
      this.stopMic();
      this.set({ phase: "online", notice: "已恢复连接，麦克风保持关闭。" });
      this.syncMedia();
      void this.syncSnapshot();
      void this.loadMembers();
      void this.checkChannel();
    });
    room.on(RoomEvent.Disconnected, () => {
      if (active())
        void this.leave("会议连接已断开。请确认邀请仍有效后重新进入。");
    });
    room.on(RoomEvent.DataReceived, (bytes, participant) => {
      if (active()) this.onData(bytes, participant);
    });
  }
  private syncMedia() {
    const room = this.state.room;
    if (!room) return;
    const canMic =
      room.state === ConnectionState.Connected &&
      microphoneAllowed(room) &&
      !this.state.muted;
    if (!canMic && room.localParticipant.isMicrophoneEnabled) this.stopMic();
    this.set({
      mediaRevision: this.state.mediaRevision + 1,
      canMic,
      mic: canMic && room.localParticipant.isMicrophoneEnabled,
      members: this.roster(),
    });
  }
  private stopMic() {
    const room = this.state.room;
    // Stop the actual capture synchronously before async signaling/reconnect.
    room?.localParticipant
      .getTrackPublication(Track.Source.Microphone)
      ?.track?.stop();
    void room?.localParticipant.setMicrophoneEnabled(false).catch(() => {});
    this.set({ mic: false });
  }
  async toggleMic() {
    const room = this.state.room;
    if (!room || this.state.actionBusy || this.state.phase !== "online") return;
    const gen = this.generation;
    this.set({ actionBusy: true, error: "" });
    try {
      if (room.localParticipant.isMicrophoneEnabled)
        await room.localParticipant.setMicrophoneEnabled(false);
      else {
        if (!this.state.canMic || !microphoneAllowed(room) || this.state.muted)
          throw new UserError("当前暂不能开麦，请等待管理员允许。");
        await room.localParticipant.setMicrophoneEnabled(true);
        if (
          gen !== this.generation ||
          !microphoneAllowed(room) ||
          this.state.muted ||
          this.state.phase !== "online"
        ) {
          this.stopMic();
          await room.localParticipant.setMicrophoneEnabled(false);
        }
      }
    } catch (e) {
      if (gen === this.generation) this.set({ error: friendlyError(e) });
    } finally {
      if (gen === this.generation) {
        this.set({ actionBusy: false });
        this.syncMedia();
      }
    }
  }
  async speak(cancel = false) {
    const id = this.state.preview?.channelId;
    if (
      !id ||
      this.state.phase !== "online" ||
      this.state.actionBusy ||
      (!cancel &&
        (this.state.channel?.voiceModel !== 1 ||
          this.state.canMic ||
          this.state.request === "pending" ||
          this.state.snapshot?.canRequestSpeak === false)) ||
      (!cancel && Date.now() < this.state.cooldownUntil)
    )
      return;
    const gen = this.generation;
    const eventTime = this.eventTime;
    this.set({ actionBusy: true, error: "" });
    try {
      if (cancel) {
        await this.api.cancelSpeak(id);
        if (
          gen === this.generation &&
          eventTime === this.eventTime &&
          !this.state.canMic
        )
          this.set({
            request: "cancelled",
            requestId: undefined,
            requestExpires: undefined,
            notice: "",
          });
      } else {
        const req = await this.api.requestSpeak(id);
        if (
          !req?.requestId ||
          !["pending", "approved", "rejected", "cancelled", "expired"].includes(
            req.status,
          )
        )
          throw new UserError("申请结果暂未同步，请稍后查看。");
        if (
          gen === this.generation &&
          eventTime === this.eventTime &&
          !this.state.canMic
        )
          this.set({
            request: req.status,
            requestId: req.requestId,
            requestExpires: req.expiresAt,
            cooldownUntil: Date.now() + 10000,
            notice: "",
          });
      }
    } catch (e) {
      if (gen === this.generation) {
        if (this.stopOnAccessError(e)) return;
        if (
          e instanceof ApiError &&
          e.reason === "speak_request_already_pending"
        )
          this.set({
            request: "pending",
            notice: "已有待审核的发言申请。",
            cooldownUntil: Date.now() + 10000,
          });
        else if (
          e instanceof ApiError &&
          e.reason === "speak_request_not_pending"
        )
          this.set({
            request: "unknown",
            notice: "申请已不在待审核状态，请等待通知或重新申请。",
          });
        else if (e instanceof ApiError && e.reason === "speak_request_cooldown")
          this.set({
            error: friendlyError(e),
            cooldownUntil: Date.now() + 10000,
          });
        else this.set({ error: friendlyError(e) });
      }
    } finally {
      if (gen === this.generation) {
        this.set({ actionBusy: false });
        void this.syncSnapshot();
      }
    }
  }
  private onEvent(e: MeetingEvent) {
    if (
      ![
        "channel.participant.kicked",
        "channel.participant.muted",
        "channel.speak.approved",
        "channel.microphone.allowed",
        "channel.speak.rejected",
      ].includes(e.eventType) ||
      e.targetUserId !== this.state.guest?.userId
    )
      return;
    const at = Date.parse(e.occurredAt);
    if (at < this.eventTime) return;
    this.eventTime = at;
    if (e.eventType === "channel.participant.kicked") {
      void this.leave("你已被管理员移出会议。", true);
      return;
    }
    if (e.eventType === "channel.participant.muted") {
      this.stopMic();
      this.set({
        muted: true,
        canMic: false,
        request: "unknown",
        notice: "管理员已关闭你的麦克风，文字聊天仍可使用。",
      });
    }
    if (
      ["channel.speak.approved", "channel.microphone.allowed"].includes(
        e.eventType,
      ) &&
      (e.eventType === "channel.microphone.allowed" ||
        !this.state.requestId ||
        e.payload?.requestId === this.state.requestId)
    ) {
      this.set({
        muted: false,
        request: "approved",
        requestExpires: undefined,
        notice: "管理员已允许发言，请手动开启麦克风。",
      });
      this.syncMedia();
    }
    if (
      e.eventType === "channel.speak.rejected" &&
      (!this.state.requestId || e.payload?.requestId === this.state.requestId)
    )
      this.set({
        request: "rejected",
        notice: "发言申请未通过，可以稍后重新申请。",
      });
    void this.syncSnapshot();
  }
  private onData(bytes: Uint8Array, participant?: RemoteParticipant) {
    const id = this.state.preview!.channelId;
    const message = decodeChat(bytes, participant?.identity, id);
    if (message) {
      if (this.seen.has(`${message.senderId}:${message.id}`)) return;
      this.seen.add(`${message.senderId}:${message.id}`);
      if (this.seen.size > 2000)
        this.seen.delete(this.seen.values().next().value!);
      message.senderName =
        this.state.members.find((m) => m.userId === participant?.identity)
          ?.userName ||
        participant?.name ||
        "参会者";
      this.set({ messages: [...this.state.messages, message].slice(-300) });
      this.releaseOldImages();
      return;
    }
    if (
      participant?.identity !== this.state.channel?.creatorId ||
      bytes.byteLength > 16384
    )
      return;
    try {
      const e = JSON.parse(new TextDecoder().decode(bytes));
      if (
        [
          "channelModeChanged",
          "participantMuteChanged",
          "channelClosed",
        ].includes(e.type)
      ) {
        void this.checkChannel();
        void this.syncSnapshot();
      }
    } catch {
      /* ignore non-chat packets */
    }
  }
  async send(content: string, retry?: ChatMessage) {
    if (retry?.type === "image") return this.sendImage(undefined, retry);
    const { room, guest, preview } = this.state;
    content = content.trim();
    if (
      !room ||
      !guest ||
      !preview ||
      this.state.phase !== "online" ||
      !content ||
      content.length > 500
    )
      return false;
    const m: ChatMessage = retry
      ? { ...retry, status: "sending" }
      : {
          id: crypto.randomUUID(),
          channelId: preview.channelId,
          senderId: guest.userId,
          senderName: guest.nickname,
          content,
          timestamp: Date.now(),
          type: "text",
          status: "sending",
        };
    const gen = this.generation;
    this.set({
      messages: retry
        ? this.state.messages.map((x) => (x.id === m.id ? m : x))
        : [...this.state.messages, m].slice(-300),
    });
    this.releaseOldImages();
    try {
      await room.localParticipant.publishData(encodeChat(m), {
        reliable: true,
      });
      if (gen === this.generation)
        this.set({
          messages: this.state.messages.map((x) =>
            x.id === m.id ? { ...x, status: "sent" } : x,
          ),
        });
      return true;
    } catch {
      if (gen === this.generation)
        this.set({
          messages: this.state.messages.map((x) =>
            x.id === m.id ? { ...x, status: "failed" } : x,
          ),
        });
      return false;
    }
  }
  async sendImage(file?: File, retry?: ChatMessage) {
    const { room, guest, preview } = this.state;
    if (
      !room ||
      !guest ||
      !preview ||
      this.state.phase !== "online" ||
      this.state.imageBusy
    )
      return false;
    file ??= retry ? this.imageFiles.get(retry.id) : undefined;
    if (!file && !retry?.originalUrl) return false;
    try {
      if (file) validateImage(file);
    } catch (error) {
      this.set({ error: friendlyError(error) });
      return false;
    }
    let message: ChatMessage = retry
      ? { ...retry, status: "uploading" }
      : {
          id: crypto.randomUUID(),
          channelId: preview.channelId,
          senderId: guest.userId,
          senderName: guest.nickname,
          content: "[图片]",
          timestamp: Date.now(),
          type: "image",
          status: "uploading",
          mimeType: file!.type,
          fileSize: file!.size,
          localUrl: URL.createObjectURL(file!),
          progress: 0,
        };
    const gen = this.generation;
    const abort = new AbortController();
    this.uploadAbort = abort;
    const timer = setTimeout(() => abort.abort(), 120000);
    if (file) this.imageFiles.set(message.id, file);
    if (message.localUrl) this.imageUrls.set(message.id, message.localUrl);
    this.set({
      imageBusy: true,
      error: "",
      messages: retry
        ? this.state.messages.map((m) => (m.id === message.id ? message : m))
        : [...this.state.messages, message].slice(-300),
    });
    this.releaseOldImages();
    const update = (patch: Partial<ChatMessage>) => {
      message = { ...message, ...patch };
      if (gen === this.generation)
        this.set({
          messages: this.state.messages.map((m) =>
            m.id === message.id ? message : m,
          ),
        });
    };
    try {
      if (!message.originalUrl || !message.thumbnailUrl) {
        const prepared = await prepareImage(file!);
        abort.signal.throwIfAborted();
        update({ width: prepared.width, height: prepared.height });
        if (!message.originalUrl)
          update({
            originalUrl: await uploadImageFile(
              file!,
              guest,
              abort.signal,
              (value) => update({ progress: Math.round(value * 0.85) }),
            ),
          });
        update({
          thumbnailUrl: await uploadImageFile(
            prepared.thumbnail,
            guest,
            abort.signal,
            (value) => update({ progress: 85 + Math.round(value * 0.15) }),
          ),
        });
      }
      abort.signal.throwIfAborted();
      if (gen !== this.generation || this.state.phase !== "online")
        throw new Error("Meeting closed");
      update({ status: "sending", progress: 100 });
      await room.localParticipant.publishData(encodeChat(message), {
        reliable: true,
      });
      update({ status: "sent", localUrl: undefined });
      const localUrl = this.imageUrls.get(message.id);
      if (localUrl) URL.revokeObjectURL(localUrl);
      this.imageUrls.delete(message.id);
      this.imageFiles.delete(message.id);
      return true;
    } catch (error) {
      if (gen === this.generation) {
        update({ status: "failed" });
        this.set({
          error: abort.signal.aborted
            ? "图片发送已中断，请重试"
            : friendlyError(error),
        });
      }
      return false;
    } finally {
      clearTimeout(timer);
      if (this.uploadAbort === abort) this.uploadAbort = undefined;
      if (gen === this.generation) this.set({ imageBusy: false });
    }
  }
  private releaseOldImages() {
    const ids = new Set(this.state.messages.map((m) => m.id));
    for (const [id, url] of this.imageUrls)
      if (!ids.has(id)) {
        URL.revokeObjectURL(url);
        this.imageUrls.delete(id);
        this.imageFiles.delete(id);
      }
  }
  private roster(): Member[] {
    const rows = new Map(
      this.apiMembers
        .filter((m) => !this.departed.has(m.userId))
        .map((m) => [m.userId, m]),
    );
    const { room, guest } = this.state;
    if (!room || !guest) return [];
    for (const p of room.remoteParticipants.values()) {
      let profile: { nickname?: string; faceURL?: string } = {};
      try {
        profile = JSON.parse(p.metadata || "{}").userInfo || {};
      } catch {
        /* display-only metadata */
      }
      const old = rows.get(p.identity);
      rows.set(p.identity, {
        userId: p.identity,
        userName:
          old?.userName ||
          p.name ||
          (typeof profile.nickname === "string" ? profile.nickname : "") ||
          "参会者",
        userAvatar:
          old?.userAvatar ||
          (typeof profile.faceURL === "string" ? profile.faceURL : undefined),
        participantType: old?.participantType || "",
        role: old?.role || "",
        audioEnabled: p.isMicrophoneEnabled,
      });
    }
    rows.set(guest.userId, {
      ...rows.get(guest.userId),
      userId: guest.userId,
      userName: guest.nickname,
      participantType: "guest",
      role: "participant",
      audioEnabled: room.localParticipant.isMicrophoneEnabled,
    });
    return [...rows.values()];
  }
  async loadMembers() {
    const gen = this.generation;
    const request = ++this.memberRequest;
    const id = this.state.preview?.channelId;
    if (!id || !this.state.room) return;
    try {
      const members = await this.api.members(id);
      if (gen === this.generation && request === this.memberRequest) {
        this.apiMembers = Array.isArray(members) ? members : [];
        this.set({ members: this.roster() });
      }
    } catch (e) {
      if (gen === this.generation) this.stopOnAccessError(e);
    }
  }
  private async syncSnapshot() {
    if (!this.state.snapshotAvailable || !this.state.preview) return;
    const gen = this.generation;
    const eventTime = this.eventTime;
    try {
      const s = await this.api.snapshot(this.state.preview.channelId);
      if (
        gen !== this.generation ||
        eventTime !== this.eventTime ||
        s?.userId !== this.state.guest?.userId ||
        s?.channelId !== this.state.preview.channelId
      )
        return;
      if (s.meetingState === "ended") {
        void this.leave("会议已结束。", true);
        return;
      }
      this.set({
        snapshot: s,
        muted: s.microphoneState === "muted",
        request: s.speakRequest?.status || "unknown",
        requestId: s.speakRequest?.requestId,
        requestExpires: s.speakRequest?.expiresAt,
        channel: this.state.channel
          ? { ...this.state.channel, voiceModel: s.voiceModel }
          : undefined,
      });
      this.syncMedia();
    } catch (e) {
      if (gen !== this.generation) return;
      if (this.stopOnAccessError(e)) return;
      if (
        e instanceof ApiError &&
        ([403, 404, 501].includes(e.status) ||
          (e.status === 400 && e.reason === "channel permission denied"))
      )
        this.set({ snapshotAvailable: false });
    }
  }
  private async checkChannel() {
    const gen = this.generation;
    if (!this.state.preview) return;
    try {
      const channel = await this.api.channel(this.state.preview.channelId);
      if (gen !== this.generation) return;
      if (
        channel.roomId !== this.state.roomId ||
        channel.channelId !== this.state.preview.channelId
      ) {
        void this.leave("会议信息不一致，已停止连接。", true);
        return;
      }
      if (channel.actualEndTime) {
        void this.leave("会议已结束。", true);
        return;
      }
      if (channel.guestEnabled === false) {
        this.stopOnAccessError(new ApiError(400, "guest_disabled"));
        return;
      }
      this.set({ channel });
    } catch (e) {
      if (gen === this.generation) this.stopOnAccessError(e);
    }
  }
  private lastChannelCheck = 0;
  private async maintain(gen: number) {
    if (gen !== this.generation || this.polling) return;
    this.polling = true;
    try {
      const guest = this.state.guest;
      if (!guest) return;
      if (
        Math.min(
          Date.parse(guest.guestExpiresAt),
          Date.parse(guest.tokenExpiresAt),
        ) <= Date.now()
      ) {
        clearGuest(guest.roomId);
        await this.leave("游客身份已到期，请重新打开邀请链接。", true);
        return;
      }
      if (
        Date.parse(guest.tokenExpiresAt) - Date.now() < 120000 &&
        !this.refreshBusy
      ) {
        this.refreshBusy = true;
        try {
          const g = { ...(await this.api.refresh()), nickname: guest.nickname };
          if (gen !== this.generation) return;
          if (!validGuest(g, guest.roomId) || g.userId !== guest.userId)
            throw new UserError("续签身份不一致。");
          saveGuest(g);
          this.api.token = g.token;
          this.set({ guest: g });
          await this.stopEvents?.();
          this.stopEvents = undefined;
          if (gen === this.generation && config.imEvents)
            this.eventTask = this.connectEvents(gen);
        } catch (e) {
          if (gen === this.generation) this.stopOnAccessError(e);
        } finally {
          this.refreshBusy = false;
        }
      }
      if (gen !== this.generation) return;
      if (
        this.state.request === "pending" &&
        this.state.requestExpires &&
        Date.parse(this.state.requestExpires) <= Date.now()
      )
        this.set({ request: "expired" });
      if (document.visibilityState === "hidden") return;
      if (this.state.request === "pending") await this.syncSnapshot();
      if (Date.now() - this.lastChannelCheck > 30000) {
        this.lastChannelCheck = Date.now();
        await this.checkChannel();
        if (this.state.request !== "pending") await this.syncSnapshot();
      }
    } finally {
      this.polling = false;
    }
  }
  resume = () => {
    if (this.state.phase === "online") {
      void this.checkChannel();
      void this.syncSnapshot();
      void this.maintain(this.generation);
    }
  };
  private async cleanup() {
    this.uploadAbort?.abort();
    this.apiMembers = [];
    this.departed.clear();
    for (const url of this.imageUrls.values()) URL.revokeObjectURL(url);
    this.imageUrls.clear();
    this.imageFiles.clear();
    clearInterval(this.tick);
    clearTimeout(this.memberTimer);
    this.stopMic();
    const room = this.state.room;
    room?.removeAllListeners();
    await room?.disconnect().catch(() => {});
    await this.eventTask;
    this.eventTask = undefined;
    await this.stopEvents?.();
    this.stopEvents = undefined;
    if (this.accepted && this.state.preview) {
      this.accepted = false;
      try {
        await this.api.leave(this.state.preview.channelId);
      } catch {
        this.set({ notice: "连接已关闭，离会状态将由服务器连接清理确认。" });
      }
    }
    this.release?.();
    this.release = undefined;
  }
  async leave(message = "", ended = false) {
    if (["leaving", "left", "ended"].includes(this.state.phase)) return;
    ++this.generation;
    this.set({
      phase: "leaving",
      actionBusy: false,
      imageBusy: false,
      error: message,
      notice: "",
      messages: [],
      canMic: false,
      mic: false,
    });
    await this.cleanup();
    this.set({
      phase: ended ? "ended" : "left",
      room: undefined,
      messages: [],
      members: [],
      request: "unknown",
    });
  }
  pageExit = () => {
    if (this.accepted && this.state.preview) {
      this.accepted = false;
      void this.api.leave(this.state.preview.channelId).catch(() => {});
    }
    void this.leave("页面已离开，重新加入后继续参会。");
  };
}
