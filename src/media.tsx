import { useEffect, useRef, useState } from "react";
import { Track, type Room, type RemoteTrack } from "livekit-client";
import type { Member } from "./types";
export function MediaTrack({
  track,
  audioMuted = false,
}: {
  track: RemoteTrack;
  audioMuted?: boolean;
}) {
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const element = track.attach();
    element.autoplay = true;
    if (element instanceof HTMLVideoElement) {
      element.playsInline = true;
      element.muted = true;
    } else element.muted = audioMuted;
    host.current?.appendChild(element);
    return () => {
      track.detach(element);
      element.remove();
    };
  }, [track, audioMuted]);
  return (
    <div
      className={track.kind === Track.Kind.Video ? "track" : "audio-track"}
      ref={host}
    />
  );
}
export function MediaStage({
  room,
  revision,
  muted,
  members,
}: {
  room: Room;
  revision: number;
  muted: boolean;
  members: Member[];
}) {
  void revision;
  const [expanded, setExpanded] = useState<string>();
  const names = new Map(members.map((m) => [m.userId, m.userName]));
  const tracks = [...room.remoteParticipants.values()].flatMap((p) =>
    [...p.trackPublications.values()]
      .filter((t) => t.track && !t.isMuted)
      .map((t) => ({
        track: t.track!,
        name: names.get(p.identity) || p.name || "参会者",
        id: t.trackSid,
        source: t.source,
      })),
  );
  const videos = tracks
    .filter((t) => t.track.kind === Track.Kind.Video)
    .sort(
      (a, b) =>
        Number(b.source === Track.Source.ScreenShare) -
        Number(a.source === Track.Source.ScreenShare),
    );
  return (
    <>
      {tracks
        .filter((t) => t.track.kind === Track.Kind.Audio)
        .map((t) => (
          <MediaTrack key={t.id} track={t.track} audioMuted={muted} />
        ))}
      {videos.length ? (
        <div className={`media-grid count-${Math.min(videos.length, 3)}`}>
          {videos.map((t, i) => (
            <section
              key={t.id}
              className={`video-tile ${i === 0 ? "main-video" : ""} ${expanded === t.id ? "expanded" : ""}`}
            >
              <MediaTrack track={t.track} />
              <div className="video-caption">
                <span>
                  {t.source === Track.Source.ScreenShare ? "屏幕共享 · " : ""}
                  {t.name}
                </span>
                <button
                  onClick={() =>
                    setExpanded(expanded === t.id ? undefined : t.id)
                  }
                  aria-label={expanded === t.id ? "收起画面" : "放大画面"}
                >
                  {expanded === t.id ? "收起" : "放大"}
                </button>
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className="voice-stage">
          <div className="voice-symbol" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
            <i />
          </div>
          <p>当前暂无视频或屏幕共享</p>
        </div>
      )}
    </>
  );
}
