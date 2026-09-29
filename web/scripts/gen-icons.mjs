#!/usr/bin/env node
// Generates the app's favicon/manifest icons and OGP share image from
// HTML/SVG templates via Playwright's chromium (already a devDependency),
// so the binary assets are reproducible from source rather than hand
// exported and committed opaquely.
//
// Usage: node scripts/gen-icons.mjs
//
// Writes into public/ (the default build's publicDir) and copies the same
// icon files into site-public/ (the site build's own publicDir, since Vite
// only supports one publicDir per build). og-image.png is site-only: the
// embedded local server has no public URL to share, so there is no reason
// to bloat the Go binary with a 1200x630 PNG it never serves.

import { chromium } from '@playwright/test';
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const publicDir = `${root}public`;
const sitePublicDir = `${root}site-public`;

// The mark: the 1-pin (イーピン) tile's own concentric-ring bullseye,
// reimagined as an abstract logo instead of a drawn tile — blue/red, the
// same pinzu colors TileFace.tsx uses, on an opaque off-white square. Pure
// geometry reads as a solid dot cluster even at 16px, where a drawn
// character or a shaded tile turns to mush (see the design review this
// replaced: git log this file).
const INK = '#1c1917';
const RING_BLUE = '#1f4fbf';
const RING_RED = '#d1332a';
const BG = '#f7f7f4';
const SANS = `"Hiragino Sans","Yu Gothic","Noto Sans JP",system-ui,sans-serif`;

function iconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="mhj-dojo 麻雀道場">
  <rect width="64" height="64" rx="14" fill="${BG}"/>
  <circle cx="32" cy="32" r="25" fill="${RING_BLUE}"/>
  <circle cx="32" cy="32" r="20.5" fill="${BG}"/>
  <circle cx="32" cy="32" r="16" fill="${RING_BLUE}"/>
  <circle cx="32" cy="32" r="11.5" fill="${BG}"/>
  <circle cx="32" cy="32" r="8" fill="${RING_RED}"/>
</svg>`;
}

// Renders `svg` at exactly `size`x`size` px and returns the PNG buffer.
async function renderSquarePNG(page, svg, size) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<!doctype html><html><head><style>
    html,body{margin:0;padding:0;overflow:hidden;background:transparent}
    svg{display:block;width:${size}px;height:${size}px}
  </style></head><body>${svg}</body></html>`);
  return page.screenshot({ omitBackground: false });
}

// Writes an ICO container holding PNG-compressed images (valid since
// Windows Vista and every current browser) so a proper multi-size
// favicon.ico needs no extra encoder dependency.
function buildIco(entries) {
  const count = entries.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // reserved
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(count, 4);
  const dirEntries = [];
  const images = [];
  let offset = 6 + count * 16;
  for (const { size, png } of entries) {
    const dir = Buffer.alloc(16);
    dir.writeUInt8(size >= 256 ? 0 : size, 0); // width (0 means 256)
    dir.writeUInt8(size >= 256 ? 0 : size, 1); // height
    dir.writeUInt8(0, 2); // color count (0: not a palette image)
    dir.writeUInt8(0, 3); // reserved
    dir.writeUInt16LE(1, 4); // color planes
    dir.writeUInt16LE(32, 6); // bits per pixel
    dir.writeUInt32LE(png.length, 8);
    dir.writeUInt32LE(offset, 12);
    dirEntries.push(dir);
    images.push(png);
    offset += png.length;
  }
  return Buffer.concat([header, ...dirEntries, ...images]);
}

// The same rings mark, scaled up as a standalone block for the OGP image
// (concentric absolutely-positioned circles, rather than the SVG, since
// this is composited straight into the page's flex layout). Insets are the
// icon SVG's own (32 - radius) for each ring, at a 64px canvas, so the
// proportions match exactly.
function ringsMark(size) {
  const scale = size / 64;
  const insets64 = [7, 11.5, 16, 20.5, 24];
  const colors = [RING_BLUE, BG, RING_BLUE, BG, RING_RED];
  const ring = (inset, color) => `<div style="position:absolute;inset:${inset}px;border-radius:50%;background:${color};"></div>`;
  return `<div style="width:${size}px;height:${size}px;position:relative;flex-shrink:0;">
    ${insets64.map((inset, i) => ring(inset * scale, colors[i])).join('')}
  </div>`;
}

function ogImageHTML() {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:1200px;height:630px;overflow:hidden;background:${BG};font-family:${SANS};}
    .wrap{width:1200px;height:630px;box-sizing:border-box;padding:0 100px;display:flex;align-items:center;justify-content:space-between;}
    .text{color:${INK};}
    h1{margin:0;font-size:66px;font-weight:800;letter-spacing:.02em;}
    .sub{margin-top:10px;font-size:26px;color:#6b7280;letter-spacing:.06em;}
    .tag{margin-top:40px;font-size:28px;font-weight:600;line-height:1.6;color:${INK};}
  </style></head><body>
    <div class="wrap">
      <div class="text">
        <h1>麻雀道場</h1>
        <div class="sub">mhj-dojo</div>
        <div class="tag">役ごとの向聴と有効牌を見ながら、<br>一人打ちの練習もCPU対戦も</div>
      </div>
      ${ringsMark(280)}
    </div>
  </body></html>`;
}

async function main() {
  mkdirSync(publicDir, { recursive: true });
  mkdirSync(sitePublicDir, { recursive: true });

  const browser = await chromium.launch();
  const page = await browser.newPage();

  const svg = iconSVG();
  writeFileSync(`${publicDir}/icon.svg`, svg);

  const icoSizes = [16, 32, 48];
  const icoPngs = [];
  for (const size of icoSizes) {
    icoPngs.push({ size, png: await renderSquarePNG(page, svg, size) });
  }
  writeFileSync(`${publicDir}/favicon.ico`, buildIco(icoPngs));

  writeFileSync(`${publicDir}/apple-touch-icon.png`, await renderSquarePNG(page, svg, 180));
  writeFileSync(`${publicDir}/icon-192.png`, await renderSquarePNG(page, svg, 192));
  writeFileSync(`${publicDir}/icon-512.png`, await renderSquarePNG(page, svg, 512));

  const manifest = {
    name: 'mhj-dojo 麻雀道場',
    short_name: '麻雀道場',
    icons: [
      { src: 'icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: 'icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
    theme_color: RING_BLUE,
    background_color: BG,
    display: 'standalone',
    start_url: './',
    lang: 'ja',
  };
  writeFileSync(`${publicDir}/manifest.webmanifest`, `${JSON.stringify(manifest, null, 2)}\n`);

  // The site build has its own publicDir (site-public/); mirror the same
  // icon set there so both builds serve it.
  for (const f of ['icon.svg', 'favicon.ico', 'apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'manifest.webmanifest']) {
    copyFileSync(`${publicDir}/${f}`, `${sitePublicDir}/${f}`);
  }

  await page.setViewportSize({ width: 1200, height: 630 });
  await page.setContent(ogImageHTML());
  writeFileSync(`${sitePublicDir}/og-image.png`, await page.screenshot({ omitBackground: false }));

  await browser.close();
  console.log('Generated favicon.ico, icon.svg, apple-touch-icon.png, icon-192.png, icon-512.png, manifest.webmanifest, og-image.png');
}

main();
