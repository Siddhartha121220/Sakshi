import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // GitHub Pages serves a project site under /<repo>/, so assets (and the hashing Web Worker) must be
  // requested from there. Set by .github/workflows/deploy-web.yml; "/" for local dev and other hosts.
  base: process.env.VITE_BASE ?? "/",
});
