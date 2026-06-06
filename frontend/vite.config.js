import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import path from "path";
import fs from "node:fs";

// https://vite.dev/config/
export default defineConfig(() => {
  const certKeyPath = path.resolve(__dirname, "../certs/localhost-key.pem");
  const certPath = path.resolve(__dirname, "../certs/localhost.pem");
  const certsExist = fs.existsSync(certKeyPath) && fs.existsSync(certPath);
  const useHttps =
    certsExist &&
    (process.env.VITE_ENABLE_HTTPS === "true" ||
      process.env.DEV_HTTPS === "true");

  return {
    plugins: [
      react(),
      VitePWA({
        registerType: "prompt",
        includeAssets: [
          "favicon.ico",
          "apple-touch-icon-180x180.png",
          "pwa-192x192.png",
          "pwa-512x512.png",
          "pwa-512x512-maskable.png",
        ],
        manifest: {
          name: "Fin - Personal Finance Manager",
          short_name: "Fin",
          description: "Personal finance management and forecasting",
          theme_color: "#FDFCF8",
          background_color: "#FDFCF8",
          display: "standalone",
          orientation: "any",
          start_url: "/",
          scope: "/",
          icons: [
            {
              src: "pwa-192x192.png",
              sizes: "192x192",
              type: "image/png",
            },
            {
              src: "pwa-512x512.png",
              sizes: "512x512",
              type: "image/png",
            },
            {
              src: "pwa-512x512-maskable.png",
              sizes: "512x512",
              type: "image/png",
              purpose: "maskable",
            },
          ],
        },
        workbox: {
          // Cache-first for hashed assets (JS/CSS/images from Vite build)
          runtimeCaching: [
            {
              urlPattern: /\/assets\/.*\.(js|css|woff2?|png|jpg|svg)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "assets-cache",
                expiration: {
                  maxEntries: 100,
                  maxAgeSeconds: 60 * 60 * 24 * 365, // 1 year — hashed filenames bust cache
                },
              },
            },
            {
              urlPattern: /\/api\//,
              handler: "NetworkOnly",
            },
            {
              urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com/,
              handler: "CacheFirst",
              options: {
                cacheName: "google-fonts",
                expiration: {
                  maxEntries: 20,
                  maxAgeSeconds: 60 * 60 * 24 * 365,
                },
              },
            },
          ],
          // Precache the app shell — new builds generate new hashes,
          // so the SW detects changes and prompts an update
          globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
          // Skip waiting is handled by the prompt UI (user clicks "Update")
          skipWaiting: false,
          clientsClaim: true,
        },
        devOptions: {
          enabled: false, // disable SW in dev to avoid caching issues
        },
      }),
    ],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
        "@components": path.resolve(__dirname, "./src/components"),
        "@features": path.resolve(__dirname, "./src/features"),
        "@pages": path.resolve(__dirname, "./src/pages"),
        "@utils": path.resolve(__dirname, "./src/utils"),
        "@lib": path.resolve(__dirname, "./src/js"),
        "@assets": path.resolve(__dirname, "./src/assets"),
        "@data": path.resolve(__dirname, "./components/data"),
      },
    },
    server: {
      host: "0.0.0.0",
      port: 5174,
      proxy: {
        "/api": {
          target: "http://localhost:3105",
          changeOrigin: true,
        },
      },
      https: useHttps
        ? {
            key: fs.readFileSync(certKeyPath),
            cert: fs.readFileSync(certPath),
          }
        : false,
    },
  };
});
