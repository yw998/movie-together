import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  define: {
    __VERCEL_PREVIEW__: JSON.stringify(process.env.VERCEL_ENV === "preview"),
  },
  plugins: [react()],
  test: {
    environment: "node",
  },
});
