// Google Places API (New) — Text Search
// https://developers.google.com/maps/documentation/places/web-service/text-search
const { isRelevant } = require("../util");

const STORE_TYPES = new Set(["supermarket", "grocery_store", "hypermarket", "convenience_store", "food_store", "discount_store"]);
const OTHER_PROVINCE = /گیلان|گلستان|تهران|سمنان|Gilan|Guilan|Golestan|Tehran|Semnan/i;
const MAZANDARAN = /مازندران|Mazandaran/i;

// فیلدهای پایه (SKU: Text Search Pro).
// با --phone شماره تلفن و امتیاز هم گرفته می‌شود (SKU: Text Search Enterprise — گران‌تر).
const BASE_FIELDS = ["id", "displayName", "formattedAddress", "location", "types", "primaryType", "businessStatus"];
const EXTRA_FIELDS = ["nationalPhoneNumber", "rating", "userRatingCount"];

module.exports = {
  id: "google",
  label: "گوگل",
  envKey: "GOOGLE_MAPS_API_KEY",
  terms: ["سوپرمارکت", "هایپرمارکت", "فروشگاه زنجیره ای", "supermarket"],

  async fetchPage({ key, term, point, pageToken, options }) {
    const fields = options.phone ? BASE_FIELDS.concat(EXTRA_FIELDS) : BASE_FIELDS;
    const h = point.half; // نیم‌عرض مستطیل جستجو بر حسب درجه
    const body = {
      textQuery: term,
      languageCode: "fa",
      regionCode: "IR",
      pageSize: 20,
      locationRestriction: {
        rectangle: {
          low: { latitude: point.lat - h, longitude: point.lng - h },
          high: { latitude: point.lat + h, longitude: point.lng + h },
        },
      },
    };
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": fields.map((f) => `places.${f}`).concat("nextPageToken").join(","),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) return { error: res.status, body: await res.text() };
    return { data: await res.json() };
  },

  parse(data) {
    return (data.places || [])
      .filter((p) => typeof p.location?.latitude === "number")
      .filter((p) => p.businessStatus !== "CLOSED_PERMANENTLY")
      .filter((p) => !(OTHER_PROVINCE.test(p.formattedAddress || "") && !MAZANDARAN.test(p.formattedAddress || "")))
      .filter((p) => {
        const types = p.types || [];
        const item = { title: p.displayName?.text, type: p.primaryType };
        return types.some((t) => STORE_TYPES.has(t)) ? isRelevant(item, { typeMatched: true }) : isRelevant(item);
      })
      .map((p) => ({
        name: (p.displayName?.text || "").trim(),
        address: p.formattedAddress || "",
        lat: p.location.latitude,
        lng: p.location.longitude,
        category: p.primaryType || "",
        phone: p.nationalPhoneNumber || "",
        rating: p.rating ?? null,
        ratingCount: p.userRatingCount ?? null,
        googleId: p.id,
      }));
  },

  nextPage(data) {
    return data.nextPageToken || null;
  },
};
