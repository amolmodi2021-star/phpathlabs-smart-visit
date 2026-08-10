import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import fs from "fs";

/** Cloudflare Pages serves this for unknown paths so refresh keeps /lims etc. */
function spaFallback404() {
  return {
    name: "spa-fallback-404",
    closeBundle() {
      const index = path.resolve(__dirname, "dist/index.html");
      const dest = path.resolve(__dirname, "dist/404.html");
      if (fs.existsSync(index)) fs.copyFileSync(index, dest);
    },
  };
}

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 8080,
    hmr: {
      overlay: false,
    },
  },
  build: {
    target: "esnext",
  },
  plugins: [react(), spaFallback404()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "@tanstack/react-query"],
  },
  optimizeDeps: {
    include: ["@tanstack/react-query", "react", "react-dom"],
    esbuildOptions: {
      target: "esnext",
    },
  },
}));
