import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
export default defineConfig({
  root: "frontend",
  plugins: [react(), tailwind()],
  build: { outDir: "../dist", emptyOutDir: true },
  server: {
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8788",
        changeOrigin: true,
        configure(proxy) {
          proxy.on("proxyReq", (proxyReq, req) => {
            if (
              req.headers.origin === "http://localhost:5173" ||
              req.headers.origin === "http://127.0.0.1:5173"
            )
              proxyReq.setHeader("origin", "http://127.0.0.1:8788");
          });
        },
      },
    },
  },
});
