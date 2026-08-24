import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    server: {
      deps: {
        inline: ["next-intl"],
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      // Same experimental Next.js build as zynreach-website — see that
      // project's vitest.config.ts for the full explanation. Extensionless
      // deep imports like `next/navigation` fail under Vitest's stricter
      // ESM resolver without this alias.
      "next/navigation": path.resolve(__dirname, "./node_modules/next/navigation.js"),
      "next/link": path.resolve(__dirname, "./node_modules/next/link.js"),
      "next/headers": path.resolve(__dirname, "./node_modules/next/headers.js"),
      "next/server": path.resolve(__dirname, "./node_modules/next/server.js"),
    },
  },
});
