import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The renderer loads from file:// inside Electron, so asset paths stay relative.
export default defineConfig({
  root: "src/renderer",
  base: "./",
  plugins: [react()],
  build: { outDir: "../../dist/renderer", emptyOutDir: true },
});
