import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Der Piper-Worker lädt onnxruntime-web dynamisch nach -> mehrere Bündel.
  // Das kann nur das ES-Format, nicht das voreingestellte iife.
  worker: { format: "es" },
  optimizeDeps: { exclude: ["@diffusionstudio/vits-web"] },
});
