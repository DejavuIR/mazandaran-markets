// Neshan Search API — https://platform.neshan.org
const { isRelevant } = require("../util");

module.exports = {
  id: "neshan",
  label: "نشان",
  envKey: "NESHAN_API_KEY",
  terms: [
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
  ],

  // یک درخواست؛ خروجی: { items, next } — نشان صفحه‌بندی ندارد
  async fetchPage({ key, term, point }) {
    const url = `https://api.neshan.org/v1/search?term=${encodeURIComponent(term)}&lat=${point.lat}&lng=${point.lng}`;
    const res = await fetch(url, { headers: { "Api-Key": key } });
    if (!res.ok) return { error: res.status, body: await res.text() };
    return { data: await res.json() };
  },

  parse(data) {
    return (data.items || [])
      .filter((it) => typeof it.location?.y === "number" && typeof it.location?.x === "number")
      .filter((it) => !(it.region && it.region.includes("،") && !it.region.includes("مازندران")))
      .filter(isRelevant)
      .map((it) => ({
        name: (it.title || "").trim(),
        address: it.address || "",
        neighbourhood: it.neighbourhood || "",
        lat: it.location.y,
        lng: it.location.x,
        category: [it.type, it.category].filter(Boolean).join(" / "),
      }));
  },

  nextPage() {
    return null;
  },
};
