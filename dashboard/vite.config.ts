import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

export default defineConfig({
  plugins: [react()],
  base: "./",
  resolve: {
    dedupe: ["@mysten/sui", "@mysten/bcs"],
  },
  build: {
    outDir: "dist",
  },
})
