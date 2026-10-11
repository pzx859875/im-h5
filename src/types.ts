export interface Guest {
  userId: string;
  roomId: string;
  token: string;
  tokenExpiresAt: string;
  guestExpiresAt: string;
  identityType: "guest";
  nickname: string;
}
export interface Invitation {
  channelInvite: string;
  roomInvite?: string;
  roomId?: string;
}
export interface Preview {
  channelId: string;
  meetingTopic: string;
  creatorName: string;
  expiresAt: string;
  audienceType: string;
  roomId?: string;
  voiceModel?: number;
  meetingState?: string;
  guestEntryEnabled?: boolean;
}
export interface Channel {
  channelId: string;
  roomId: string;
  name: string;
  creatorId: string;
  voiceModel: number;
  endTime?: string;
  actualEndTime?: string;
  guestEnabled: boolean;
}
export interface Member {
  userId: string;
  userName: string;
  userAvatar?: string;
  participantType: string;
  role: string;
  audioEnabled: boolean;
}
export type RequestStatus =
  "unknown" | "pending" | "approved" | "rejected" | "cancelled" | "expired";
export interface SpeakRequest {
  requestId: string;
  status: RequestStatus;
  expiresAt?: string;
}
export interface Snapshot {
  userId: string;
  channelId: string;
  voiceModel: number;
  meetingState: string;
  microphoneState: string;
  canRequestSpeak: boolean;
  speakRequest: SpeakRequest | null;
  recordingState?: string;
}
export interface ChatMessage {
  id: string;
  channelId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  type: string;
  originalUrl?: string;
  thumbnailUrl?: string;
  width?: number;
  height?: number;
  fileSize?: number;
  mimeType?: string;
  localUrl?: string;
  progress?: number;
  status: "uploading" | "sending" | "sent" | "failed";
}
export interface MeetingEvent {
  eventId: string;
  eventType: string;
  channelId: string;
  roomId?: string;
  targetUserId?: string;
  occurredAt: string;
  payload?: { requestId?: string };
}
