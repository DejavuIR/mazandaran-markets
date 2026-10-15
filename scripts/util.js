// یکسان‌سازی متن فارسی برای مقایسه (ی/ک عربی، نیم‌فاصله، فاصله‌ها)
function normalize(s = "") {
  return s
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[‌‏‎\s\-_.،,()]/g, "")
    .toLowerCase();
}

const HYPER = /هایپر|هايپر|hyper|جانبو/i;
const CHAIN = /افق\s*کوروش|افق کوروش|شهروند|رفاه|اتکا|هایپراستار|جانبو|کوروش|ماف|سپه|پروما|دیلی\s*مارکت|اکالا/i;
const RELEVANT = /سوپر|مارکت|market|هایپر|هايپر|فروشگاه|خواربار|شهروند|رفاه|اتکا|کوروش|جانبو|هایپراستار/i;
// چیزهایی که اسمشان شبیه است ولی سوپرمارکت نیستند
const EXCLUDE = /پوشاک|لباس|کفش|موبایل|لوازم\s*خانگی|مبل|آهن|ساختمانی|خودرو|یدکی|کتاب|لوازم\s*التحریر|طلا|عینک|ابزار|کامپیوتر|دارو|آرایشی|بهداشتی\s*آرایشی|فرش|پرده|کابینت|چینی|بلور|اسباب\s*بازی|موتور|دوچرخه|گل\s*فروشی|پت\s*شاپ/;

// typeMatched: منبع (مثلاً گوگل) خودش نوع مکان را سوپرمارکت/خواربار گفته
function isRelevant(item, { typeMatched = false } = {}) {
  if (EXCLUDE.test(item.title || "")) return false;
  if (typeMatched) return true;
  return RELEVANT.test(`${item.title || ""} ${item.type || ""} ${item.category || ""}`);
}

function classify(item) {
  const title = item.title || "";
  if (HYPER.test(title)) return "هایپرمارکت";
  if (CHAIN.test(title)) return "فروشگاه زنجیره‌ای";
  return "سوپرمارکت";
}

function distanceKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const toRad = (d) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

function nearestCity(lat, lng, cities) {
  let best = cities[0];
  let bestD = Infinity;
  for (const c of cities) {
    const d = distanceKm(lat, lng, c.lat, c.lng);
    if (d < bestD) {
      bestD = d;
      best = c;
    }
  }
  return best;
}

module.exports = { normalize, classify, isRelevant, distanceKm, nearestCity };
