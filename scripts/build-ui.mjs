import esbuild from "esbuild";

// Bundles the modular ESM UI (Sigma + graphology + our components) into a single
// self-contained IIFE served by the local server — fully offline, no CDN.

const options = {
  entryPoints: ["ui/src/main.ts"],
  bundle: true,
  format: "iife",
  outfile: "ui/dist/app.js",
  target: ["es2020"],
  minify: true,
  sourcemap: false,
  logLevel: "info",
};

const watch = process.argv.includes("--watch");
if (watch) {
  const ctx = await esbuild.context(options);
  await ctx.watch();
  console.log("watching ui/src …");
} else {
  await esbuild.build(options);
}
