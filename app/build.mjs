// Builds the page into dist/: index.html plus one bundled app.js (page script + shared brain core).
import { build } from "esbuild";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";

rmSync("dist", { recursive: true, force: true });
mkdirSync("dist");
copyFileSync("web/index.html", "dist/index.html");
await build({
  entryPoints: ["web/app.ts"],
  bundle: true,
  minify: true,
  format: "esm",
  target: "es2020",
  outfile: "dist/app.js",
  legalComments: "none",
});
console.log("Built dist/");
