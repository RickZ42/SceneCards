import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { rmSync } from "node:fs";
import { resolve } from "node:path";

export default defineConfig({
  base: "./",
  plugins: [react(), {
    name: "private-card-deployment",
    closeBundle() {
      rmSync(resolve("dist/data/cards.json"), { force: true });
    },
  }],
});
