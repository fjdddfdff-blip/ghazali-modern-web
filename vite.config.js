import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";
import { getBuildVersion } from "./buildVersion.js";

const projectRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  base: "/ghazali-modern-web/",
  plugins: [
    react(),
    {
      name: "ghazali-build-version",
      transformIndexHtml() {
        return [{
          tag: "script",
          children: `window.GHAZALI_APP_VERSION = ${JSON.stringify(getBuildVersion(projectRoot))};`,
          injectTo: "head-prepend",
        }];
      },
    },
  ],
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
