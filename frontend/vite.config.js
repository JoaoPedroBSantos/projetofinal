import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// /admin abre admin.html (dev); em produção o nginx faz o mesmo.
const adminRewrite = {
  name: "admin-rewrite",
  configureServer(s) {
    s.middlewares.use((req, _res, next) => {
      if (req.url === "/admin" || req.url.startsWith("/admin/")) req.url = "/admin.html";
      next();
    });
  },
};

// A API é o FastAPI (backend/). Em dev o dev.sh exporta VITE_API_TARGET.
const target = process.env.VITE_API_TARGET || "http://127.0.0.1:8081";

export default defineConfig({
  plugins: [react(), adminRewrite],
  server: {
    proxy: {
      "/api": target,
      // Fotos de produtos ficam no SeaweedFS e a API as serve em /assets/uploads.
      "/assets/uploads": target,
    },
  },
  build: { rollupOptions: { input: { main: "index.html", admin: "admin.html" } } },
});
