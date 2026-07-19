import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    // baut bei jedem "npm run build" automatisch einen service worker,
    // der die app-hülle (html/js/css) offline verfügbar macht — inkl.
    // registrierung, du musst dafür nichts in index.html/main.jsx ändern.
    VitePWA({
      registerType: "autoUpdate",
      injectRegister: "auto",
      manifest: {
        name: "Stricklisel",
        short_name: "Stricklisel",
        description: "private operator console",
        start_url: "/",
        display: "standalone",
        background_color: "#040705",
        theme_color: "#040705",
      },
    }),
  ],
  // Der Piper-Worker lädt onnxruntime-web dynamisch nach -> mehrere Bündel.
  // Das kann nur das ES-Format, nicht das voreingestellte iife.
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@diffusionstudio/vits-web"] },
});
