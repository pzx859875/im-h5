import type { ChatMessage, MeetingEvent } from "./types";
export function imageUrl(value: unknown): string | undefined {
  if (typeof value !== "string" || value.length > 4096) return;
  try {
    const url = new URL(value);
    if (
      ["https:", "http:"].includes(url.protocol) &&
      !url.username &&
      !url.password
    )
      return url.href;
  } catch {
    /* invalid remote image */
  }
}
export function decodeChat(
  bytes: Uint8Array,
  sender: string | undefined,
  channelId: string,
): ChatMessage | null {
  if (!sender || bytes.byteLength > 16384) return null;
  try {
    const envelope = JSON.parse(new TextDecoder().decode(bytes));
    const m = envelope.message;
    if (
      envelope.type !== "voiceRoomTextMessage" ||
      !m ||
      m.senderId !== sender ||
      m.channelId !== channelId ||
      typeof m.id !== "string" ||
      !m.id ||
      m.id.length > 128 ||
      typeof m.timestamp !== "number" ||
      !Number.isFinite(m.timestamp)
    )
      return null;
    const type = m.messageType || m.type;
    if (type !== "text" && type !== "image") return null;
    if (
      type === "text" &&
      (typeof m.content !== "string" ||
        !m.content.trim() ||
        m.content.length > 500)
    )
      return null;
    const originalUrl = imageUrl(m.originalUrl ?? m.original_url);
    if (type === "image" && !originalUrl) return null;
    const positive = (value: unknown) =>
      typeof value === "number" && Number.isFinite(value) && value > 0
        ? value
        : undefined;
    return {
      id: m.id,
      channelId,
      senderId: sender,
      senderName: "",
      content: type === "image" ? "[图片]" : m.content,
      ...(type === "image"
        ? {
            originalUrl,
            thumbnailUrl:
              imageUrl(m.thumbnailUrl ?? m.thumbnail_url) || originalUrl,
            width: positive(m.width),
            height: positive(m.height),
            fileSize: positive(m.fileSize ?? m.file_size),
            mimeType: typeof m.mimeType === "string" ? m.mimeType : undefined,
          }
        : {}),
      type,
      timestamp: m.timestamp,
      status: "sent",
    };
  } catch {
    return null;
  }
}
export function encodeChat(m: ChatMessage) {
  return new TextEncoder().encode(
    JSON.stringify({
      type: "voiceRoomTextMessage",
      timestamp: m.timestamp,
      message: {
        id: m.id,
        channelId: m.channelId,
        senderId: m.senderId,
        senderName: m.senderName,
        content: m.content,
        timestamp: m.timestamp,
        ...(m.type === "image"
          ? {
              originalUrl: m.originalUrl,
              thumbnailUrl: m.thumbnailUrl,
              width: m.width,
              height: m.height,
              fileSize: m.fileSize,
              mimeType: m.mimeType,
            }
          : {}),
        senderAvatar: null,
        messageType: m.type,
        type: m.type,
        status: "sent",
      },
    }),
  );
}
export function decodeMeetingEvent(
  message: unknown,
  admin: string,
  guest: string,
  channel: string,
  since: number,
): MeetingEvent | null {
  try {
    const m = message as {
      sendID: string;
      recvID: string;
      customElem: { data: string };
    };
    if (
      m.sendID !== admin ||
      m.recvID !== guest ||
      typeof m.customElem?.data !== "string"
    )
      return null;
    const e = JSON.parse(m.customElem.data) as MeetingEvent;
    if (
      e.channelId !== channel ||
      (e.targetUserId && e.targetUserId !== guest) ||
      !e.eventId ||
      typeof e.eventType !== "string" ||
      !Number.isFinite(Date.parse(e.occurredAt)) ||
      Date.parse(e.occurredAt) < since
    )
      return null;
    return e;
  } catch {
    return null;
  }
}
export function nicknameValid(name: string) {
  const length = [...name.trim()].length;
  return length > 0 && length <= 40;
}
