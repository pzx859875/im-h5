import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    alias: {
      "@openim/protocol/lib/pb/sdkws/sdkws": new URL(
        "./src/openim-protocol-compat.ts",
        import.meta.url,
      ).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
    },
  },
  server: { port: 5173 },
  build: { target: "es2022" },
});
