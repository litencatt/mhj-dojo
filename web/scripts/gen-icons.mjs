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

// Colors mirror web/src/style.css (:root) and TileFace.tsx, so the
// generated assets match the app's tile look instead of drifting from it.
const INK = '#1c1917';
const RED = '#c8201f';
const GREEN = '#15803d';
const TILE_BG = '#fffdf5';
const TILE_BORDER = '#c9c2a8';
const TILE_BACK = '#3f7d5c';
const BG = '#f4f5f7';
const SERIF = `'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif`;
const SANS = `"Hiragino Sans","Yu Gothic","Noto Sans JP",system-ui,sans-serif`;

// The app icon: a single mahjong tile (ivory face, green back edge, same
// as the tiles TileFace.tsx draws) bearing 「道」, on an opaque light
// square so it reads on any browser chrome or home-screen background
// regardless of system theme. 道 has too many strokes for TileFace's thin
// Mincho to survive down to a 16px favicon, so the mark uses the bold
// Gothic stack instead (only here; TileFace's in-app tiles are never
// drawn smaller than 18px and keep the Mincho look).
function iconSVG() {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" role="img" aria-label="mhj-dojo 麻雀道場">
  <rect width="64" height="64" fill="${BG}"/>
  <rect x="5" y="9" width="54" height="48" rx="7" fill="${TILE_BACK}"/>
  <rect x="5" y="5" width="54" height="48" rx="7" fill="${TILE_BG}" stroke="${TILE_BORDER}" stroke-width="1.3"/>
  <text x="32" y="39" font-family="${SANS}" font-weight="900" font-size="37" text-anchor="middle" fill="${RED}">道</text>
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

// A tile styled like `.tile` in style.css (ivory face, green back edge),
// for the OGP image's decorative row.
function tileDiv(char, color) {
  return `<div style="width:104px;height:140px;border-radius:8px;box-sizing:border-box;background:linear-gradient(180deg,#fffef8 0%,${TILE_BG} 100%);border:2px solid ${TILE_BORDER};box-shadow:0 4px 0 ${TILE_BACK},0 6px 10px rgba(0,0,0,.18);display:flex;align-items:center;justify-content:center;">
    <span style="font-family:${SERIF};font-weight:700;font-size:56px;color:${color};line-height:1;">${char}</span>
  </div>`;
}

function ogImageHTML() {
  return `<!doctype html><html><head><style>
    html,body{margin:0;padding:0;width:1200px;height:630px;overflow:hidden;background:${BG};font-family:${SANS};}
    .wrap{width:1200px;height:630px;box-sizing:border-box;padding:84px 92px;position:relative;}
    h1{margin:0;font-size:60px;color:${INK};font-weight:800;letter-spacing:.02em;}
    .sub{margin:10px 0 0;font-size:24px;color:#6b7280;}
    .tag{margin:34px 0 0;font-size:29px;line-height:1.5;color:${INK};font-weight:600;}
    .tiles{position:absolute;right:92px;bottom:84px;display:flex;gap:18px;}
  </style></head><body>
    <div class="wrap">
      <h1>麻雀道場</h1>
      <div class="sub">mhj-dojo</div>
      <div class="tag">役ごとの向聴と有効牌がわかる、<br>一人打ちの麻雀練習</div>
      <div class="tiles">
        ${tileDiv('東', INK)}
        ${tileDiv('發', GREEN)}
        ${tileDiv('中', RED)}
      </div>
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
    theme_color: BG,
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
