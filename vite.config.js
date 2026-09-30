import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  base: "/ghazali-modern-web/",
  plugins: [react()],
  build: {
    outDir: "docs",
  },
  server: {
    host: "127.0.0.1",
    port: 42818,
  },
  preview: {
    host: "127.0.0.1",
    port: 42818,
  },
});
