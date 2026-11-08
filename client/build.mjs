// Builds the client bundle into ../dist/client.
//
// 1. Compiles theme.css with the Tailwind CLI (expands `@import
//    "tailwindcss"` and the @theme tokens) -> dist/client/theme.css.
// 2. Bundles src/main.tsx with Bun.build -> dist/client/main.js. The hero
//    photograph is emitted as a hashed asset next to it.
// 3. Copies index.html, which references ./main.js and ./theme.css.
//
// Run from the repo root with `bun run build` (or `bun run build:client`).
import { $ } from "bun";
import { cpSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const clientDir = import.meta.dir;
const rootDir = path.resolve(clientDir, "..");
const outDir = path.resolve(rootDir, "dist", "client");

mkdirSync(outDir, { recursive: true });

// 1. Tailwind (local CLI binary — `bunx` is not on PATH inside Bun's shell)
const tailwindBin = path.join(rootDir, "node_modules", ".bin", "tailwindcss");
await $`${tailwindBin} -i ${path.join(clientDir, "src", "theme.css")} -o ${path.join(outDir, "theme.css")} --minify`.cwd(
  clientDir,
);

// 2. JS bundle (TSX + the jpg asset)
const result = await Bun.build({
  entrypoints: [path.join(clientDir, "src", "main.tsx")],
  outdir: outDir,
  target: "browser",
  minify: true,
  naming: { entry: "main.js", asset: "[name]-[hash].[ext]" },
});
if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

// 3. HTML shell
cpSync(path.join(clientDir, "index.html"), path.join(outDir, "index.html"));

console.log(`client build done -> ${path.relative(process.cwd(), outDir)}`);
console.log(
  `  css: ${existsSync(path.join(outDir, "theme.css")) ? "theme.css" : "MISSING"}`,
  `js: ${existsSync(path.join(outDir, "main.js")) ? "main.js" : "MISSING"}`,
);
