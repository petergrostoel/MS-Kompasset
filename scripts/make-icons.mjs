// Laver app-ikoner (PNG) ud fra branding/logo.png eller branding/logo-placeholder.svg.
// Kør: node scripts/make-icons.mjs   (kræver Playwright: npm i -D playwright)
import { chromium } from "playwright";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = process.argv[2] || join(root, "branding/logo-placeholder.svg");
const mime = src.endsWith(".svg") ? "image/svg+xml" : "image/png";
const url = `data:${mime};base64,${readFileSync(src).toString("base64")}`;
const browser = await chromium.launch();
const page = await browser.newPage();
for (const [name, size] of [["logo.png", 512], ["icon-512.png", 512], ["icon-192.png", 192], ["icon-180.png", 180]]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<style>html,body{margin:0;background:#4E5736}img{width:${size}px;height:${size}px;object-fit:cover;display:block}</style><img src="${url}">`);
  await page.waitForFunction(() => document.images[0].complete);
  await page.screenshot({ path: join(root, "branding", name), omitBackground: false });
  console.log("Lavet", name);
}
await browser.close();
