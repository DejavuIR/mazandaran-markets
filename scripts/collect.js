#!/usr/bin/env node
// جمع‌آوری سوپرمارکت‌ها و هایپرمارکت‌های مازندران از نشان و گوگل مپ.
//
// اجرا (هر منبعی که کلیدش تنظیم شده باشد استفاده می‌شود):
//   NESHAN_API_KEY=service.xxxx GOOGLE_MAPS_API_KEY=AIza... node scripts/collect.js
// گزینه‌ها:
//   --plan          فقط تعداد درخواست‌ها را نشان می‌دهد و چیزی نمی‌فرستد
//   --quick         فقط مرکز هر شهر را جستجو می‌کند (درخواست کمتر)
//   --only=google   فقط یک منبع (neshan یا google)
//   --phone         از گوگل تلفن و امتیاز هم می‌گیرد (هزینهٔ هر درخواست بیشتر است)
//   --delay=300     فاصلهٔ بین درخواست‌ها بر حسب میلی‌ثانیه
//   --no-cache      پاسخ‌های ذخیره‌شده را نادیده می‌گیرد
//
// پاسخ هر درخواست در data/cache ذخیره می‌شود؛ اگر اجرا وسط کار قطع شد
// (مثلاً به‌خاطر سقف روزانهٔ API)، اجرای دوباره از همان‌جا ادامه می‌دهد.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const cities = require("./cities");
const { normalize, classify, distanceKm, nearestCity } = require("./util");

const PROVIDERS = [require("./providers/neshan"), require("./providers/google")];

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, v] = a.replace(/^--/, "").split("=");
    return [k, v === undefined ? true : v];
  })
);

const DELAY = Number(args.delay || 300);
const USE_CACHE = !args["no-cache"];
const MAX_PAGES = 3; // گوگل حداکثر ۶۰ نتیجه (۳ صفحه) برمی‌گرداند
const ROOT = path.join(__dirname, "..");
const CACHE_DIR = path.join(ROOT, "data", "cache");
const OUT_FILE = path.join(ROOT, "data", "stores.json");

// محدودهٔ تقریبی استان مازندران
const BBOX = { minLat: 35.7, maxLat: 37.0, minLng: 50.3, maxLng: 54.3 };

function searchPoints() {
  const points = [];
  const grid = { large: 2, medium: 1, small: 0 }; // شعاع شبکه (تعداد گام در هر جهت)
  const step = 0.015; // حدود ۱.۵ کیلومتر
  for (const city of cities) {
    const r = args.quick ? 0 : grid[city.size] ?? 0;
    // نیم‌عرض مستطیل جستجوی گوگل: در شبکه، هر خانه یک گام؛ برای یک نقطهٔ تنها، کل شهر (~۴ کیلومتر)
    const half = r === 0 ? (city.size === "small" ? 0.04 : 0.06) : step / 2 + 0.002;
    for (let i = -r; i <= r; i++) {
      for (let j = -r; j <= r; j++) {
        points.push({ city: city.name, lat: +(city.lat + i * step).toFixed(5), lng: +(city.lng + j * step).toFixed(5), half });
      }
    }
  }
  return points;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// کدهای خطای اختصاصی نشان — https://platform.neshan.org
const NESHAN_ERRORS = {
  480: "کلید API نشان پیدا نشد؛ کلید را درست کپی کنید.",
  481: "سهمیهٔ کلید نشان تمام شده؛ بعداً دوباره اجرا کنید تا از همین‌جا ادامه دهد.",
  483: "نوع کلید اشتباه است؛ کلید باید از نوع «سرویس» (service.) باشد، نه «وب».",
  484: "این آدرس/IP در لیست مجاز کلید نیست؛ محدودیت IP یا دامنه را در پنل نشان بردارید.",
  485: "سرویس «جستجو» برای این کلید فعال نیست؛ در پنل نشان، کلید را ویرایش و تیک «جستجو» (Search) را بزنید.",
};

async function request(provider, key, term, point, pageToken) {
  const id = [provider.id, term, point.lat, point.lng, point.half, pageToken || "", args.phone ? "phone" : ""].join("|");
  const cacheFile = path.join(CACHE_DIR, `${provider.id}-${crypto.createHash("md5").update(id).digest("hex")}.json`);
  if (USE_CACHE && fs.existsSync(cacheFile)) {
    return { data: JSON.parse(fs.readFileSync(cacheFile, "utf8")), cached: true };
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const r = await provider.fetchPage({ key, term, point, pageToken, options: args });
    if (r.data) {
      fs.writeFileSync(cacheFile, JSON.stringify(r.data));
      return { data: r.data, cached: false };
    }
    // ۴۸۲ نشان یعنی سرعت درخواست‌ها زیاد است
    if (r.error === 429 || r.error === 482 || r.error >= 500) {
      const wait = 2000 * 2 ** attempt;
      console.warn(`\n  ⚠ ${provider.label}: خطای ${r.error} — ${wait / 1000} ثانیه صبر و تلاش دوباره`);
      await sleep(wait);
      continue;
    }
    const err = new Error(`${provider.label} API ${r.error}: ${r.body}`);
    err.status = r.error;
    throw err;
  }
  throw new Error(`${provider.label} API: تلاش‌های مکرر ناموفق بود`);
}

function merge(stores, item, provider, term) {
  const { lat, lng } = item;
  if (lat < BBOX.minLat || lat > BBOX.maxLat || lng < BBOX.minLng || lng > BBOX.maxLng) return;
  if (!item.name) return;

  // تکراری: نام یکسان در فاصلهٔ ۱۵۰ متر، یا نام‌هایی که یکی شامل دیگری است در فاصلهٔ ۶۰ متر
  // (مثلاً «افق کوروش» در نشان و «فروشگاه افق کوروش» در گوگل)
  const norm = normalize(item.name);
  const dup = stores.find((s) => {
    const d = distanceKm(s.lat, s.lng, lat, lng);
    if (s._norm === norm) return d < 0.15;
    return d < 0.06 && norm.length >= 3 && s._norm.length >= 3 && (s._norm.includes(norm) || norm.includes(s._norm));
  });

  if (dup) {
    if (!dup.sources.includes(provider.id)) dup.sources.push(provider.id);
    if (!dup.terms.includes(term)) dup.terms.push(term);
    for (const k of ["address", "neighbourhood", "phone", "googleId"]) if (!dup[k] && item[k]) dup[k] = item[k];
    if (dup.rating == null && item.rating != null) {
      dup.rating = item.rating;
      dup.ratingCount = item.ratingCount;
    }
    return;
  }

  stores.push({
    _norm: norm,
    name: item.name,
    type: classify({ title: item.name }),
    city: nearestCity(lat, lng, cities).name,
    address: item.address || "",
    neighbourhood: item.neighbourhood || "",
    phone: item.phone || "",
    rating: item.rating ?? null,
    ratingCount: item.ratingCount ?? null,
    category: item.category || "",
    lat,
    lng,
    googleId: item.googleId || "",
    sources: [provider.id],
    terms: [term],
  });
}

async function main() {
  const points = searchPoints();
  const active = PROVIDERS.filter((p) => !args.only || args.only === p.id);

  let total = 0;
  for (const p of active) {
    const n = points.length * p.terms.length;
    total += n;
    const pages = p.id === "google" ? ` (تا ${MAX_PAGES} صفحه برای هر کدام، یعنی حداکثر ${n * MAX_PAGES})` : "";
    console.log(`${p.label}: ${points.length} نقطه × ${p.terms.length} عبارت = ${n} جستجو${pages}`);
  }
  if (args.plan) return;

  const runnable = active.filter((p) => process.env[p.envKey]);
  for (const p of active) {
    if (!process.env[p.envKey]) console.log(`— ${p.label}: کلید ${p.envKey} تنظیم نشده، این منبع رد شد.`);
  }
  if (!runnable.length) {
    console.error("\nخطا: هیچ کلید API تنظیم نشده. راهنما در README.md");
    process.exit(1);
  }
  fs.mkdirSync(CACHE_DIR, { recursive: true });

  const stores = [];
  const status = {};
  for (const provider of runnable) {
    const key = process.env[provider.envKey];
    const n = points.length * provider.terms.length;
    let done = 0;
    let requests = 0;
    console.log(`\n▶ ${provider.label}`);
    try {
      for (const point of points) {
        for (const term of provider.terms) {
          let pageToken = null;
          for (let page = 0; page < MAX_PAGES; page++) {
            const { data, cached } = await request(provider, key, term, point, pageToken);
            for (const item of provider.parse(data)) merge(stores, item, provider, term);
            if (!cached) {
              requests++;
              await sleep(DELAY);
            }
            pageToken = provider.nextPage(data);
            if (!pageToken) break;
          }
          done++;
          if (done % 10 === 0 || done === n) {
            process.stdout.write(`\r  ${done}/${n} جستجو — ${stores.length} فروشگاه یکتا تا اینجا   `);
          }
        }
      }
      status[provider.id] = { complete: true, requests };
    } catch (e) {
      status[provider.id] = { complete: false, requests, error: e.message };
      console.error(`\n  ✖ ${e.message}`);
      if (provider.id === "neshan" && NESHAN_ERRORS[e.status]) {
        console.error(`  ${NESHAN_ERRORS[e.status]}`);
      } else if (e.status === 401 || e.status === 403) {
        console.error("  کلید API نامعتبر است یا سرویس جستجو برایش فعال نشده (برای گوگل: Places API (New) و حساب پرداخت).");
      } else {
        console.error("  نتایج تا این لحظه ذخیره می‌شود. بعداً دوباره اجرا کنید تا از همین‌جا ادامه دهد.");
      }
      process.exitCode = 1;
    }
    console.log(`\n  ${requests} درخواست جدید فرستاده شد.`);
  }

  stores.sort((a, b) => a.city.localeCompare(b.city, "fa") || a.name.localeCompare(b.name, "fa"));
  const out = {
    sources: Object.fromEntries(runnable.map((p) => [p.id, { label: p.label, ...status[p.id] }])),
    generatedAt: new Date().toISOString(),
    complete: runnable.every((p) => status[p.id]?.complete),
    count: stores.length,
    stores: stores.map(({ _norm, ...s }, i) => ({ id: i + 1, ...s })),
  };
  fs.writeFileSync(OUT_FILE, JSON.stringify(out, null, 2));

  const by = (id) => stores.filter((s) => s.sources.includes(id)).length;
  const both = stores.filter((s) => s.sources.length > 1).length;
  console.log(`\n${stores.length} فروشگاه یکتا در ${path.relative(ROOT, OUT_FILE)} ذخیره شد.`);
  for (const p of runnable) console.log(`  از ${p.label}: ${by(p.id)}`);
  if (runnable.length > 1) console.log(`  در هر دو منبع: ${both}`);
}

main();
