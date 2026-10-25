import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  build: {
    // Windows 7 can only run Chrome 109 / Firefox 115 ESR, and the accountants
    // use it to open this page. safari15 covers iPads on iOS 15 and later;
    // below that, flex `gap` is missing and no transpiler can add it.
    target: ["chrome109", "firefox115", "safari15"],
  },
  server: {
    port: 5173,
    proxy: { "/api": { target: "http://127.0.0.1:5174", changeOrigin: true } },
  },
});
