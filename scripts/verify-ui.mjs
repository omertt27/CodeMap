import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";

// Headless smoke test for the WebGL UI: builds nothing (run `npm run build`
// first), starts the server, loads the map in a real Chrome, and fails if the
// graph doesn't render or the console logs any error. Uses puppeteer-core with a
// system Chrome — no bundled browser download.
//
//   npm run build && npm run verify:ui
//
// Set PUPPETEER_EXECUTABLE_PATH to override Chrome detection.

const PORT = Number(process.env.PORT || 4399);
const URL = `http://127.0.0.1:${PORT}`;

function findChrome() {
  if (process.env.PUPPETEER_EXECUTABLE_PATH) return process.env.PUPPETEER_EXECUTABLE_PATH;
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ];
  for (const c of candidates) if (fs.existsSync(c)) return c;
  try {
    return execFileSync("which", ["google-chrome"], { encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

async function waitForServer(retries = 40) {
  for (let i = 0; i < retries; i++) {
    try {
      const r = await fetch(URL);
      if (r.ok) return;
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("server did not start in time");
}

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exitCode = 1;
}

const chrome = findChrome();
if (!chrome) {
  console.error("No Chrome/Chromium found — set PUPPETEER_EXECUTABLE_PATH. Skipping UI verification.");
  process.exit(0); // don't fail CI on missing browser
}

const server = spawn("node", ["dist/cli.js", "serve", ".", "--port", String(PORT), "--no-open"], { stdio: "ignore" });
let browser;
try {
  const puppeteer = (await import("puppeteer-core")).default;
  await waitForServer();
  browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: ["--no-sandbox", "--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--window-size=1600,1000"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1000 });
  const errors = [];
  page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));

  await page.goto(URL, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 4000));

  const info = await page.evaluate(() => {
    const canvas = document.querySelector("#stage canvas");
    return {
      nodes: Number(document.getElementById("stat-nodes")?.textContent || 0),
      hasCanvas: !!canvas && canvas.width > 0,
      tabs: document.querySelectorAll(".tab").length,
    };
  });

  console.log(`nodes=${info.nodes} canvas=${info.hasCanvas} tabs=${info.tabs} console-errors=${errors.length}`);
  if (!info.hasCanvas) fail("WebGL canvas did not render");
  if (info.nodes <= 0) fail("graph has no nodes");
  if (info.tabs < 3) fail("expected Filters/Insights/History tabs");
  if (errors.length) { fail(`${errors.length} console error(s):`); errors.forEach((e) => console.error("   " + e)); }
  if (!process.exitCode) console.log("✓ UI verified: map renders, data loaded, no console errors");
} catch (err) {
  fail(String(err));
} finally {
  if (browser) await browser.close();
  server.kill();
}
