import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { Room } from "livekit-client";
import { MeetingController } from "./meeting";
import { captureInvitation, safeStorage } from "./session";
import { imageUrl, nicknameValid } from "./protocol";
import { friendlyError } from "./api";
import { MediaStage } from "./media";
import { ChatImage } from "./ChatImage";
function Avatar({ name, url }: { name: string; url?: string }) {
  const [failedUrl, setFailedUrl] = useState("");
  const source = imageUrl(url);
  return (
    <div className="avatar">
      {source && source !== failedUrl ? (
        <img
          src={source}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(source)}
        />
      ) : (
        [...(name || "会")][0]
      )}
    </div>
  );
}
const controller = new MeetingController(captureInvitation());
function Icon({ name }: { name: string }) {
  const paths: Record<string, ReactNode> = {
    mic: (
      <>
        <rect x="9" y="2" width="6" height="13" rx="3" />
        <path d="M5 10v2a7 7 0 0014 0v-2M12 19v3m-4 0h8" />
      </>
    ),
    off: (
      <>
        <path d="M9 9v3a3 3 0 005 2M9 5a3 3 0 016 0v5M5 10v2a7 7 0 0012 5m2-5v-2M12 19v3m-4 0h8M3 3l18 18" />
      </>
    ),
    phone: <path d="M3 16v-5c5-5 13-5 18 0v5l-5-1v-4H8v4z" />,
    users: (
      <>
        <circle cx="9" cy="8" r="3" />
        <path d="M2 21v-3a7 7 0 0114 0v3M17 4a4 4 0 010 8m2 3a5 5 0 013 5" />
      </>
    ),
    sound: (
      <>
        <path d="M3 9h4l5-4v14l-5-4H3zM16 8a6 6 0 010 8m3-11a10 10 0 010 14" />
      </>
    ),
    settings: (
      <>
        <circle cx="12" cy="12" r="4" />
        <path d="M10 2h4l1 3 3 1 3 3-1 3 1 3-3 3-3 1-1 3h-4l-1-3-3-1-3-3 1-3-1-3 3-3 3-1z" />
      </>
    ),
    arrow: <path d="M5 12h14m-6-6l6 6-6 6" />,
    close: <path d="M5 5l14 14M19 5L5 19" />,
    image: (
      <>
        <rect x="3" y="3" width="18" height="18" rx="3" />
        <circle cx="8" cy="8" r="1" />
        <path d="m3 17 5-5 4 4 4-6 5 7" />
      </>
    ),
    hand: (
      <>
        <path d="M8 12V6a2 2 0 014 0v5-7a2 2 0 014 0v7-4a2 2 0 014 0v9c0 4-3 6-7 6-3 0-5-2-7-5l-3-4c-1-2 1-4 3-2l2 2z" />
      </>
    ),
  };
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24">
      {paths[name] || paths.mic}
    </svg>
  );
}
function Dialog({
  title,
  close,
  children,
}: {
  title: string;
  close: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    ref.current?.showModal();
  }, []);
  return (
    <dialog
      ref={ref}
      onCancel={close}
      onClick={(e) => {
        if (e.target === e.currentTarget) close();
      }}
      aria-label={title}
    >
      <header>
        <h2>{title}</h2>
        <button className="icon-button" onClick={close} aria-label="关闭">
          <Icon name="close" />
        </button>
      </header>
      {children}
    </dialog>
  );
}
function Settings({
  close,
  theme,
  setTheme,
  onError,
}: {
  close: () => void;
  theme: string;
  setTheme: (v: string) => void;
  onError: (s: string) => void;
}) {
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selected, setSelected] = useState("default");
  useEffect(() => {
    void Room.getLocalDevices("audioinput", false)
      .then(setDevices)
      .catch(() => {});
  }, []);
  return (
    <Dialog title="会议设置" close={close}>
      <label className="setting">
        显示主题
        <select value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="dark">深色</option>
          <option value="light">浅色</option>
        </select>
      </label>
      <label className="setting">
        麦克风
        <select
          value={selected}
          onChange={async (e) => {
            const id = e.target.value;
            try {
              await controller.state.room?.switchActiveDevice("audioinput", id);
              setSelected(id);
            } catch (err) {
              onError(friendlyError(err));
            }
          }}
        >
          <option value="default">系统默认设备</option>
          {devices
            .filter((d) => d.deviceId && d.deviceId !== "default")
            .map((d, i) => (
              <option key={d.deviceId} value={d.deviceId}>
                {d.label || `麦克风 ${i + 1}`}
              </option>
            ))}
        </select>
      </label>
    </Dialog>
  );
}
export default function App() {
  const s = useSyncExternalStore(controller.subscribe, controller.getSnapshot);
  const [nickname, setNickname] = useState("");
  const [draft, setDraft] = useState("");
  const [modal, setModal] = useState("");
  const [audioMuted, setAudioMuted] = useState(false);
  const [theme, setTheme] = useState(
    () => safeStorage.get(localStorage, "theme") || "dark",
  );
  const [uiError, setUiError] = useState("");
  const [previewImage, setPreviewImage] = useState("");
  const imageInput = useRef<HTMLInputElement>(null);
  const [memberSearch, setMemberSearch] = useState("");
  const [memberPage, setMemberPage] = useState(0);
  const [now, setNow] = useState(Date.now());
  const messages = useRef<HTMLDivElement>(null);
  const nearBottom = useRef(true);
  useEffect(() => {
    void controller.preview();
    const interval = setInterval(() => setNow(Date.now()), 1000);
    const visibility = () => {
      if (document.visibilityState === "visible") controller.resume();
    };
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("pagehide", controller.pageExit);
    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("pagehide", controller.pageExit);
    };
  }, []);
  useEffect(() => {
    if (s.guest) setNickname(s.guest.nickname);
  }, [s.guest]);
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    safeStorage.set(localStorage, "theme", theme);
  }, [theme]);
  useEffect(() => {
    if (nearBottom.current && messages.current)
      messages.current.scrollTop = messages.current.scrollHeight;
  }, [s.messages]);
  useEffect(() => {
    if (["left", "ended", "entry"].includes(s.phase)) {
      setDraft("");
      setModal("");
      setPreviewImage("");
    }
  }, [s.phase]);
  const online = ["online", "reconnecting"].includes(s.phase);
  const mode = s.channel?.voiceModel;
  const canRequest =
    s.phase === "online" &&
    mode === 1 &&
    !s.canMic &&
    (s.request === "pending" || (s.snapshot?.canRequestSpeak ?? true));
  const cooldownSeconds = Math.max(
    0,
    Math.ceil((s.cooldownUntil - Date.now()) / 1000),
  );
  const remaining = s.channel?.endTime
    ? Math.max(0, Math.ceil((Date.parse(s.channel.endTime) - now) / 60000))
    : undefined;
  const selfStatus = s.muted
    ? "管理员已禁麦"
    : s.canMic
      ? ""
      : s.request === "pending"
        ? "等待发言审批"
        : s.request === "approved"
          ? "发言权限同步中"
          : s.request === "rejected"
            ? "发言申请未通过"
            : mode === 0
              ? "麦克风暂不可用"
              : s.request === "expired"
                ? "发言申请已过期"
                : "";
  const send = () => {
    if (!draft.trim() || draft.trim().length > 500 || s.phase !== "online")
      return;
    const content = draft;
    setDraft("");
    nearBottom.current = true;
    void controller.send(content);
  };
  const filtered = s.members.filter((m) =>
    m.userName.toLowerCase().includes(memberSearch.toLowerCase()),
  );
  return (
    <main className="app">
      <header className="topbar">
        {online && (
          <div className="brand-icon">
            <Icon name="mic" />
          </div>
        )}
        <div className="title-block">
          <h1>{s.preview?.meetingTopic || "频道会议"}</h1>
          {online && (
            <p>
              <>
                <span
                  className={`status-dot ${s.phase === "reconnecting" ? "waiting" : ""}`}
                />
                {s.phase === "online" ? "已连接" : "正在重连"}
              </>
            </p>
          )}
        </div>
        <div className="top-actions">
          <span className="guest-badge">游客</span>
          {online && (
            <button
              className="member-button"
              onClick={() => {
                setModal("members");
                void controller.loadMembers();
              }}
            >
              <Icon name="users" />
              <span>{s.room ? s.members.length : "—"}</span>
            </button>
          )}
          <button
            className="icon-button"
            onClick={() => setModal("settings")}
            aria-label="会议设置"
          >
            <Icon name="settings" />
          </button>
        </div>
      </header>
      {(s.error || uiError) && (
        <div className="banner error" role="alert">
          <span>{uiError || s.error}</span>
          <button
            aria-label="关闭提示"
            onClick={() => {
              setUiError("");
              controller.dismiss();
            }}
          >
            ×
          </button>
        </div>
      )}
      {s.notice && (
        <div className="banner" role="status">
          <span>{s.notice}</span>
          <button aria-label="关闭提醒" onClick={() => controller.dismiss()}>
            ×
          </button>
        </div>
      )}
      {!online && !["left", "ended"].includes(s.phase) && (
        <>
          <div className="join-body">
            <section className="join-card" aria-label="加入会议">
              <img
                className="app-logo"
                src="/cloudchat-logo.webp"
                alt="CLOUDCHAT"
                width="240"
                height="43"
              />
              {s.preview && (
                <div className="host-summary">
                  <div className="avatar gold">
                    {[...(s.preview.creatorName || "会")][0]}
                  </div>
                  <div>
                    <strong>{s.preview.creatorName || "会议主持人"}</strong>
                    <span>邀请你参加会议</span>
                  </div>
                </div>
              )}
              {!controller.invitation ? (
                <div className="empty-invite">
                  请从 APP 分享的会议邀请链接打开此页面。
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    void controller.join(nickname);
                  }}
                >
                  <label htmlFor="nickname">
                    你的昵称 <small>{[...nickname.trim()].length}/40</small>
                  </label>
                  <input
                    id="nickname"
                    autoComplete="nickname"
                    placeholder="请输入昵称"
                    value={nickname}
                    readOnly={!!s.guest}
                    onChange={(e) => setNickname(e.target.value)}
                    aria-describedby="nickname-note"
                  />
                  <p id="nickname-note" className="field-note">
                    {s.guest
                      ? "已恢复此浏览器的有效游客身份"
                      : "1–40 个字符，进入会议后展示"}
                  </p>
                  {s.phase !== "loading" && s.preview && !s.roomId && (
                    <p className="inline-warning">
                      邀请缺少聊天室信息，请联系分享人补全链接。
                    </p>
                  )}
                  <button
                    className="primary join-button"
                    disabled={
                      ["loading", "joining", "leaving"].includes(s.phase) ||
                      !s.roomId ||
                      !nicknameValid(nickname) ||
                      s.preview?.guestEntryEnabled === false
                    }
                    type="submit"
                  >
                    <span>
                      {s.phase === "loading"
                        ? "正在读取会议…"
                        : s.phase === "joining"
                          ? "正在加入…"
                          : s.phase === "leaving"
                            ? "正在离开…"
                            : s.preview?.guestEntryEnabled === false
                              ? "暂未开放游客"
                              : "加入会议"}
                    </span>
                    <Icon name="arrow" />
                  </button>
                  {!s.preview && s.phase === "entry" && (
                    <button
                      type="button"
                      className="text-button"
                      onClick={() => void controller.preview()}
                    >
                      重新读取邀请
                    </button>
                  )}
                </form>
              )}
            </section>
          </div>
          <footer className="entry-footer">
            进入时麦克风关闭 · 聊天仅在本次会议页面保留
          </footer>
        </>
      )}
      {online && (
        <>
          <div className="meeting-body">
            <section className="stage">
              <div className="stage-top">
                <span>
                  {remaining !== undefined && Number.isFinite(remaining)
                    ? `预计剩余 ${remaining} 分钟`
                    : "会议进行中"}
                </span>
                <span className="mode-pill">
                  {mode === 0
                    ? "自由发言"
                    : mode === 1
                      ? "主持人模式"
                      : "模式同步中"}
                </span>
              </div>
              {s.snapshot?.recordingState === "recording" && (
                <div className="recording">● 会议正在录制</div>
              )}
              <MediaStage
                members={s.members}
                room={s.room!}
                revision={s.mediaRevision}
                muted={audioMuted}
              />
              <div className="people-strip">
                <ul className="participant-strip" aria-label="参会成员">
                  {s.members.map((member) => (
                    <li key={member.userId}>
                      <Avatar name={member.userName} url={member.userAvatar} />
                      <span title={member.userName}>
                        {member.userName}
                        {member.userId === s.guest?.userId ? "（我）" : ""}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
              {selfStatus && (
                <div className="personal-state" role="status">
                  <Icon name="off" />
                  <span>{selfStatus}</span>
                </div>
              )}
              {s.imStatus !== "connected" && (
                <p className="sync-note">管理通知暂未连接</p>
              )}
              {!s.snapshotAvailable &&
                mode === 1 &&
                s.request === "unknown" &&
                !s.canMic && (
                  <p className="sync-note">
                    申请状态暂不可用 ·
                    <button
                      className="text-button"
                      disabled={s.actionBusy}
                      onClick={() => void controller.speak(true)}
                    >
                      撤回申请
                    </button>
                  </p>
                )}
              {!s.canPlayAudio && !audioMuted && (
                <button
                  className="primary"
                  onClick={() =>
                    void s.room
                      ?.startAudio()
                      .catch(() =>
                        setUiError("浏览器暂未允许播放声音，请再次点击。"),
                      )
                  }
                >
                  点击开启会议声音
                </button>
              )}
            </section>
            <aside className="chat">
              <header>
                <h2>会议聊天</h2>
              </header>
              <div
                className="messages"
                ref={messages}
                role="log"
                aria-live="polite"
                aria-label="会议聊天消息"
                onScroll={(e) => {
                  const el = e.currentTarget;
                  nearBottom.current =
                    el.scrollHeight - el.scrollTop - el.clientHeight < 70;
                }}
              >
                {s.messages.length === 0 && (
                  <div className="chat-empty">暂无消息</div>
                )}
                {s.messages.map((m) => (
                  <article
                    key={`${m.senderId}:${m.id}`}
                    className={`message ${m.senderId === s.guest?.userId ? "mine" : ""}`}
                  >
                    <div className="message-name">
                      {m.senderName}{" "}
                      <time>
                        {new Date(m.timestamp).toLocaleTimeString("zh-CN", {
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </time>
                    </div>
                    {m.type === "image" ? (
                      <ChatImage message={m} open={setPreviewImage} />
                    ) : (
                      <div className="message-content">{m.content}</div>
                    )}
                    {m.status === "uploading" && (
                      <small>上传中 {m.progress || 0}%</small>
                    )}
                    {m.status === "sending" && <small>发送中…</small>}
                    {m.status === "failed" && (
                      <button
                        className="retry-message"
                        disabled={
                          s.phase !== "online" ||
                          (m.type === "image" && s.imageBusy)
                        }
                        onClick={() => void controller.send(m.content, m)}
                      >
                        发送失败 · 点击重试
                      </button>
                    )}
                  </article>
                ))}
              </div>
              <form
                className="composer"
                onSubmit={(e) => {
                  e.preventDefault();
                  send();
                }}
              >
                <div className="composer-box">
                  <textarea
                    aria-label="发送文字消息"
                    placeholder={
                      s.phase === "online" ? "输入消息" : "连接恢复后可发送"
                    }
                    value={draft}
                    disabled={s.phase !== "online"}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (
                        e.key === "Enter" &&
                        !e.shiftKey &&
                        !e.nativeEvent.isComposing
                      ) {
                        e.preventDefault();
                        send();
                      }
                    }}
                  />
                  <div className="composer-actions">
                    <input
                      ref={imageInput}
                      type="file"
                      hidden
                      accept="image/jpeg,image/png,image/webp,image/gif"
                      aria-label="选择图片"
                      onChange={(e) => {
                        const file = e.currentTarget.files?.[0];
                        e.currentTarget.value = "";
                        if (file) {
                          nearBottom.current = true;
                          void controller.sendImage(file);
                        }
                      }}
                    />
                    <button
                      className="icon-button image-picker"
                      type="button"
                      aria-label="发送图片"
                      title="发送图片"
                      disabled={s.phase !== "online" || s.imageBusy}
                      onClick={() => imageInput.current?.click()}
                    >
                      <Icon name="image" />
                    </button>
                    <small
                      className={draft.trim().length > 500 ? "invalid" : ""}
                    >
                      {draft.trim().length}/500
                    </small>
                    <button
                      className="send-button"
                      type="submit"
                      disabled={
                        s.phase !== "online" ||
                        !draft.trim() ||
                        draft.trim().length > 500
                      }
                    >
                      发送 <Icon name="arrow" />
                    </button>
                  </div>
                </div>
              </form>
            </aside>
          </div>
          <nav className="toolbar" aria-label="会议控制">
            <button className="tool" onClick={() => setModal("settings")}>
              <span>
                <Icon name="settings" />
              </span>
              设置
            </button>
            <button className="tool leave" onClick={() => setModal("leave")}>
              <span>
                <Icon name="phone" />
              </span>
              挂断
            </button>
            <button
              className={`tool ${audioMuted ? "" : "selected"}`}
              onClick={() => {
                setAudioMuted(!audioMuted);
                if (audioMuted) void s.room?.startAudio().catch(() => {});
              }}
            >
              <span>
                <Icon name="sound" />
              </span>
              {audioMuted ? "开启声音" : "关闭声音"}
            </button>
            <button
              className={`tool ${s.mic ? "selected" : ""}`}
              disabled={
                s.phase !== "online" ||
                s.actionBusy ||
                (!s.canMic && !canRequest) ||
                (!s.canMic && s.request !== "pending" && now < s.cooldownUntil)
              }
              onClick={() =>
                void (s.canMic
                  ? controller.toggleMic()
                  : controller.speak(s.request === "pending"))
              }
            >
              <span>
                <Icon name={s.canMic ? (s.mic ? "mic" : "off") : "hand"} />
              </span>
              {s.canMic
                ? s.mic
                  ? "关闭麦克风"
                  : "开启麦克风"
                : s.request === "pending"
                  ? "取消申请"
                  : canRequest
                    ? cooldownSeconds > 0
                      ? `${cooldownSeconds}s 后申请`
                      : "申请发言"
                    : "暂不可发言"}
            </button>
          </nav>
        </>
      )}
      {["left", "ended"].includes(s.phase) && (
        <section className="terminal">
          <div className="join-mark">
            <Icon name="phone" />
          </div>
          <h2>{s.phase === "ended" ? "本次参会已结束" : "已离开会议"}</h2>
          <p>
            {s.phase === "ended"
              ? "如需再次参加，请向分享人获取有效邀请。"
              : "麦克风已关闭，聊天记录已清空。"}
          </p>
          {s.phase === "left" && (
            <button
              className="primary"
              onClick={() =>
                void controller.join(s.guest?.nickname || nickname)
              }
            >
              重新加入
            </button>
          )}
        </section>
      )}
      {modal === "settings" && (
        <Settings
          close={() => setModal("")}
          theme={theme}
          setTheme={setTheme}
          onError={setUiError}
        />
      )}
      {previewImage && (
        <Dialog title="图片预览" close={() => setPreviewImage("")}>
          <img
            className="image-preview"
            src={previewImage}
            alt="图片原图"
            referrerPolicy="no-referrer"
          />
        </Dialog>
      )}
      {modal === "leave" && (
        <Dialog title="离开会议？" close={() => setModal("")}>
          <p className="muted">离开后将清空本次聊天记录。</p>
          <div className="dialog-actions">
            <button className="secondary" onClick={() => setModal("")}>
              继续参会
            </button>
            <button
              className="danger"
              onClick={() => {
                setModal("");
                void controller.leave();
              }}
            >
              确认离开
            </button>
          </div>
        </Dialog>
      )}
      {modal === "members" && (
        <Dialog
          title={`会议成员 · ${s.room ? s.members.length : "—"}`}
          close={() => setModal("")}
        >
          <input
            aria-label="搜索成员"
            placeholder="搜索昵称"
            value={memberSearch}
            onChange={(e) => {
              setMemberSearch(e.target.value);
              setMemberPage(0);
            }}
          />
          <div className="member-list">
            {filtered.slice(memberPage * 40, memberPage * 40 + 40).map((m) => (
              <div className="member" key={m.userId}>
                <Avatar name={m.userName} url={m.userAvatar} />
                <div>
                  <strong>{m.userName || "参会者"}</strong>
                  <small>
                    {m.participantType === "guest"
                      ? "游客"
                      : m.role === "creator"
                        ? "主持人"
                        : m.role === "admin"
                          ? "管理员"
                          : "成员"}
                    {m.userId === s.guest?.userId ? " · 我" : ""}
                  </small>
                </div>
                <Icon name={m.audioEnabled ? "mic" : "off"} />
              </div>
            ))}
            {!filtered.length && (
              <p className="muted">
                {s.members.length
                  ? "没有匹配的成员"
                  : "成员列表暂不可用，请稍后刷新。"}
              </p>
            )}
          </div>
          <div className="pagination">
            <button
              disabled={memberPage === 0}
              onClick={() => setMemberPage((p) => p - 1)}
            >
              上一页
            </button>
            <span>
              {memberPage + 1} / {Math.max(1, Math.ceil(filtered.length / 40))}
            </span>
            <button
              disabled={(memberPage + 1) * 40 >= filtered.length}
              onClick={() => setMemberPage((p) => p + 1)}
            >
              下一页
            </button>
            <button onClick={() => void controller.loadMembers()}>刷新</button>
          </div>
        </Dialog>
      )}
    </main>
  );
}
