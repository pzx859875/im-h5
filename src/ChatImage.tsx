import { useState } from "react";
import type { ChatMessage } from "./types";

export function ChatImage({
  message,
  open,
}: {
  message: ChatMessage;
  open: (url: string) => void;
}) {
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const source =
    message.localUrl || message.thumbnailUrl || message.originalUrl;
  if (failed)
    return (
      <button
        className="image-error"
        onClick={() => {
          setAttempt((value) => value + 1);
          setFailed(false);
        }}
      >
        图片加载失败 · 重试
      </button>
    );
  return (
    <button
      className="image-message"
      aria-label="查看图片"
      disabled={!message.originalUrl}
      onClick={() => {
        const url = message.originalUrl || message.localUrl;
        if (url) open(url);
      }}
    >
      <img
        key={`${source}:${attempt}`}
        src={source}
        alt="图片消息"
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setFailed(true)}
      />
    </button>
  );
}
