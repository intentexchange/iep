import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const here = dirname(fileURLToPath(import.meta.url));
const schemaSrc = resolve(here, "../../packages/spec/schemas");

const extensionDoc = {
  uri: "https://intentexchange.dev/ext/v0",
  iep: "0.2",
  mediaType: "application/intent+json",
  verbs: ["ping", "accept", "reject", "reveal", "propose", "ratify"],
  spec: "https://intentexchange.dev/protocol",
};

const writeSpecAssets = (destRoot: string): void => {
  mkdirSync(resolve(destRoot, "schemas"), { recursive: true });
  mkdirSync(resolve(destRoot, "ext"), { recursive: true });
  cpSync(schemaSrc, resolve(destRoot, "schemas"), { recursive: true });
  writeFileSync(resolve(destRoot, "ext/v0.json"), `${JSON.stringify(extensionDoc, null, 2)}\n`);
};

const copySpecAssets = (): Plugin => ({
  name: "copy-spec-assets",
  configureServer: (server) => {
    writeSpecAssets(resolve(here, "public"));
    server.middlewares.use((req, res, next) => {
      if (req.url === "/ext/v0" || req.url === "/ext/v0/") {
        res.statusCode = 200;
        res.setHeader("Content-Type", "application/json; charset=utf-8");
        res.end(`${JSON.stringify(extensionDoc, null, 2)}\n`);
        return;
      }
      next();
    });
  },
  closeBundle: () => {
    writeSpecAssets(resolve(here, "dist"));
  },
});

export default defineConfig({
  plugins: [react(), tailwindcss(), copySpecAssets()],
});
