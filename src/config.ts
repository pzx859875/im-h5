export type Environment = "production" | "debug" | "test";
// Mirrors openim_common/lib/src/config.dart. Vite mode is not APP environment.
export function endpoints(env: Environment = "production") {
  if (env === "test")
    return {
      community: "http://47.238.94.189:33013/chatRoomApi",
      imApi: "http://47.238.94.189:10002",
      imWs: "ws://47.238.94.189:10001",
    };
  return {
    community: "https://chat.yunxi.group/chatRoomApi",
    imApi: "https://chat.yunxi.group",
    imWs: `${env === "debug" ? "ws" : "wss"}://chat.yunxi.group/msg_gateway`,
  };
}
const defaults = endpoints(import.meta.env.VITE_APP_ENV as Environment);
export const config = {
  community: (import.meta.env.VITE_COMMUNITY_URL || defaults.community).replace(
    /\/$/,
    "",
  ),
  imApi: import.meta.env.VITE_IM_API_URL || defaults.imApi,
  imWs: import.meta.env.VITE_IM_WS_URL || defaults.imWs,
  adminId: import.meta.env.VITE_IM_ADMIN_ID || "imAdmin",
  selfSnapshot: import.meta.env.VITE_SELF_SNAPSHOT === "true",
  imEvents: import.meta.env.VITE_IM_EVENTS !== "false",
};
