#!/usr/bin/env node
// جمع‌آوری سوپرمارکت‌ها و هایپرمارکت‌های مازندران از Neshan Search API.
//
// اجرا:
//   NESHAN_API_KEY=service.xxxx node scripts/collect.js
// گزینه‌ها:
//   --plan        فقط تعداد درخواست‌ها را نشان می‌دهد و چیزی نمی‌فرستد
//   --quick       فقط مرکز هر شهر را جستجو می‌کند (درخواست کمتر)
//   --delay=300   فاصلهٔ بین درخواست‌ها بر حسب میلی‌ثانیه
//   --no-cache    پاسخ‌های ذخیره‌شده را نادیده می‌گیرد
//
// پاسخ هر درخواست در data/cache ذخیره می‌شود؛ اگر اجرا وسط کار قطع شد
// (مثلاً به‌خاطر سقف روزانهٔ API)، اجرای دوباره از همان‌جا ادامه می‌دهد.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cities = require("./cities");
const { normalize, classify, isRelevant, distanceKm, nearestCity } = require("./util");

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);

const API_KEY = process.env.NESHAN_API_KEY;
const DELAY = Number(args.delay || 300);
const USE_CACHE = !args["no-cache"];
const ROOT = path.join(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "cache");
const OUT_FILE = path.join(ROOT, "data", "stores.json");

const TERMS = [
  "سوپرمارکت",
  "سوپر مارکت",
  "هایپرمارکت",
  "هایپر مارکت",
  "فروشگاه زنجیره ای",
  "افق کوروش",
  "شهروند",
  "فروشگاه رفاه",
  "اتکا",
  "هایپراستار",
  "جانبو",
];

// محدودهٔ تقریبی استان مازندران
const BBOX = { minLat: 35.7, maxLat: 37.0, minLng: 50.3, maxLng: 54.3 };

function searchPoints() {
  const points = [];
  const grid = { large: 2, medium: 1, small: 0 }; // شعاع شبکه (تعداد گام در هر جهت)
  const step = 0.015; // حدود ۱.۵ کیلومتر
  for (const city of cities) {
    const r = args.quick ? 0 : grid[city.size] ?? 0;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        points.push({ city: city.name, lat: +(city.lat + i * step).toFixed(5), lng: +(city.lng + j * step).toFixed(5) });
      }
    }
  }
  return points;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function search(term, lat, lng) {
  const key = crypto.createHash("md5").update(`${term}|${lat}|${lng}`).digest("hex");
  const cacheFile = path.join(CACHE_DIR, `${key}.json`);
  if (USE_CACHE && fs.existsSync(cacheFile)) {
    return { data: JSON.parse(fs.readFileSync(cacheFile, "utf8")), cached: true };
  }

  const url = `https://api.neshan.org/v1/search?term=${encodeURIComponent(term)}&lat=${lat}&lng=${lng}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers: { "Api-Key": API_KEY } });
    if (res.ok) {
      const data = await res.json();
      fs.writeFileSync(cacheFile, JSON.stringify(data));
      return { data, cached: false };
    }
    const body = await res.text();
    if (res.status === 429 || res.status >= 500) {
      const wait = 2000 * 2 ** attempt;
      console.warn(`  ⚠ ${res.status} — ${wait / 1000} ثانیه صبر و تلاش دوباره`);
      await sleep(wait);
      continue;
    }
    const err = new Error(`Neshan API ${res.status}: ${body}`);
    err.status = res.status;
    throw err;
  }
  throw new Error("Neshan API: تلاش‌های مکرر ناموفق بود");
}

function merge(stores, item, term) {
  const lat = item.location?.y;
  const lng = item.location?.x;
  if (typeof lat !== "number" || typeof lng !== "number") return;
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng) return;
  // اگر نشان استان را گفته و مازندران نیست، کنار بگذار
  if (item.region && /استان|،/.test(item.region) && !item.region.includes("مازندران")) return;
  if (!isRelevant(item)) return;

  const norm = normalize(item.title);
  const dup = stores.find((s) => s._norm === norm && distanceKm(s.lat, s.lng, lat, lng) < 0.15);
  if (dup) {
    if (!dup.terms.includes(term)) dup.terms.push(term);
    if (!dup.address && item.address) dup.address = item.address;
    return;
  }

  stores.push({
    _norm: norm,
    name: item.title.trim(),
    type: classify(item),
    city: nearestCity(lat, lng, cities).name,
    address: item.address || "",
    neighbourhood: item.neighbourhood || "",
    region: item.region || "",
    category: [item.type, item.category].filter(Boolean).join(" / "),
    lat,
    lng,
    terms: [term],
  });
}

async function main() {
  const points = searchPoints();
  const total = points.length * TERMS.length;
  console.log(`نقاط جستجو: ${points.length} × عبارت‌ها: ${TERMS.length} = ${total} درخواست`);
  if (args.plan) return;

  if (!API_KEY) {
    console.error("خطا: متغیر NESHAN_API_KEY تنظیم نشده. کلید را از https://platform.neshan.org بگیرید.");
    process.exit(1);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const stores = [];
  let done = 0;
  let fresh = 0;
  try {
    for (const p of points) {
      for (const term of TERMS) {
        const { data, cached } = await search(term, p.lat, p.lng);
        for (const item of data.items || []) merge(stores, item, term);
        done++;
        if (!cached) {
          fresh++;
          await sleep(DELAY);
        }
        if (done % 25 === 0 || done === total) {
          process.stdout.write(`\r${done}/${total} درخواست — ${stores.length} فروشگاه یکتا   `);
        }
      }
    }
  } catch (e) {
    console.error(`\n\nخطا: ${e.message}`);
    if (e.status === 401 || e.status === 403) {
      console.error("کلید API نامعتبر است یا سرویس جستجو برایش فعال نشده.");
    } else {
      console.error("نتایج تا این لحظه ذخیره می‌شود. بعداً دوباره اجرا کنید تا از همین‌جا ادامه دهد.");
    }
    process.exitCode = 1;
  }

  stores.sort((a, b) => a.city.localeCompare(b.city, "fa") || a.name.localeCompare(b.name, "fa"));
  const out = {
    source: "Neshan Search API",
    generatedAt: new Date().toISOString(),
    complete: done === total,
    count: stores.length,
    stores: stores.map(({ _norm, ...s }, i) => ({ id: i + 1, ...s })),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));
  console.log(`\n\n${stores.length} فروشگاه در ${path.relative(ROOT, OUT_FILE)} ذخیره شد (${fresh} درخواست جدید).`);
}

main();
