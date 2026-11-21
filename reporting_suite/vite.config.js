import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";
export default defineConfig({
  plugins: [react(), tailwind()],
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  server: { proxy: { "/api": "http://127.0.0.1:8765" } },
  build: {
    outDir: "build",
    rollupOptions: {
      output: { entryFileNames: "app.js", assetFileNames: "[name][extname]" },
    },
  },
});
