import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // Dev only: forward API calls to the local FastAPI backend so the
    // default `/api/v1` base URL works without CORS setup.
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
      },
    },
  },
  // `preview` inherits `server.proxy` by default (Vite 8); the e2e server
  // must stay a plain static server so the "API offline" path is a normal
  // failed fetch, not a proxy 502 that logs a browser console error.
  preview: {
    proxy: {},
  },
});
