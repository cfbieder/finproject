import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import fs from "node:fs";

// https://vite.dev/config/
export default defineConfig(() => {
  const certKeyPath = path.resolve(__dirname, "../certs/localhost-key.pem");
  const certPath = path.resolve(__dirname, "../certs/localhost.pem");
  const certsExist = fs.existsSync(certKeyPath) && fs.existsSync(certPath);

  return {
    plugins: [react()],
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
      ...(certsExist && {
        https: {
          key: fs.readFileSync(certKeyPath),
          cert: fs.readFileSync(certPath),
        },
      }),
      proxy: {
        "/api": {
          target: "https://localhost:3005",
          changeOrigin: true,
        },
      },
    },
  };
});
