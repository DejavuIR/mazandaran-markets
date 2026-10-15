const PAGE = 200;
const $ = (id) => document.getElementById(id);
const fa = (n) => n.toLocaleString("fa-IR");
const norm = (s = "") => s.replace(/[يى]/g, "ی").replace(/ك/g, "ک").replace(/‌/g, " ").toLowerCase();
const esc = (s = "") => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

let all = [];
let filtered = [];
let shown = 0;
const markers = new Map();

const map = L.map("map").setView([36.55, 52.4], 8);
L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: "&copy; OpenStreetMap | داده: نشان و گوگل",
}).addTo(map);
const cluster = L.markerClusterGroup({ showCoverageOnHover: false });
map.addLayer(cluster);

const SOURCE_LABELS = { neshan: "نشان", google: "گوگل" };
const sourceTags = (s) => (s.sources || []).map((x) => `<span class="src">${SOURCE_LABELS[x] || x}</span>`).join("");
const ratingText = (s) => (s.rating != null ? `★ ${fa(s.rating)} (${fa(s.ratingCount || 0)})` : "");

const COLORS = { سوپرمارکت: "#1f7a4d", هایپرمارکت: "#b5531c", "فروشگاه زنجیره‌ای": "#2c5fa8" };

function popup(s) {
  return `<b>${esc(s.name)}</b><br>${esc(s.type)} — ${esc(s.city)}<br>
    <small>${esc(s.address || s.neighbourhood || "")}</small><br>
    ${s.phone ? `<a href="tel:${esc(s.phone.replace(/\s/g, ""))}" dir="ltr">${esc(s.phone)}</a><br>` : ""}
    ${s.rating != null ? `<small>${ratingText(s)}</small><br>` : ""}
    <small>منبع: ${sourceTags(s)}</small><br>
    <a href="${s.googleId ? `https://www.google.com/maps/place/?q=place_id:${encodeURIComponent(s.googleId)}` : `https://www.google.com/maps?q=${s.lat},${s.lng}`}" target="_blank" rel="noopener">گوگل مپ</a>
    <a href="https://neshan.org/maps/@${s.lat},${s.lng},17z" target="_blank" rel="noopener">نشان</a>
    <a href="https://balad.ir/location?latitude=${s.lat}&longitude=${s.lng}&zoom=17" target="_blank" rel="noopener">بلد</a>`;
}

function buildMarkers() {
  for (const s of all) {
    const m = L.circleMarker([s.lat, s.lng], {
      radius: s.type === "هایپرمارکت" ? 8 : 6,
      color: "#fff",
      weight: 1.5,
      fillColor: COLORS[s.type] || COLORS["سوپرمارکت"],
      fillOpacity: 0.9,
    }).bindPopup(popup(s));
    markers.set(s.id, m);
  }
}

function applyFilters() {
  const q = norm($("q").value.trim());
  const city = $("city").value;
  const type = $("type").value;
  const source = $("source").value;
  const srcOk = (s) =>
    !source || (source === "both" ? (s.sources || []).length > 1 : (s.sources || []).includes(source));
  filtered = all.filter(
    (s) =>
      (!city || s.city === city) &&
      (!type || s.type === type) &&
      srcOk(s) &&
      (!q || norm(`${s.name} ${s.address} ${s.neighbourhood} ${s.city}`).includes(q))
  );

  cluster.clearLayers();
  cluster.addLayers(filtered.map((s) => markers.get(s.id)));
  if (filtered.length && (city || q)) {
    map.fitBounds(L.latLngBounds(filtered.map((s) => [s.lat, s.lng])).pad(0.1), { maxZoom: 15 });
  }

  $("count").textContent = `${fa(filtered.length)} فروشگاه`;
  $("list").innerHTML = "";
  shown = 0;
  renderMore();
}

function renderMore() {
  const frag = document.createDocumentFragment();
  for (const s of filtered.slice(shown, shown + PAGE)) {
    const li = document.createElement("li");
    li.innerHTML = `<div class="name">${esc(s.name)}<span class="tag ${s.type.replace(/\s/g, "-")}">${esc(s.type)}</span></div>
      <div class="addr">${esc(s.city)}${s.address ? " — " + esc(s.address) : ""}</div>
      <div class="meta">${sourceTags(s)}${s.phone ? `<span dir="ltr">${esc(s.phone)}</span>` : ""}${s.rating != null ? `<span>${ratingText(s)}</span>` : ""}</div>`;
    li.onclick = () => {
      document.querySelectorAll("#list li.active").forEach((x) => x.classList.remove("active"));
      li.classList.add("active");
      const m = markers.get(s.id);
      // روی گوشی نقشه بالای لیست است؛ اول به آن برگرد
      if (window.matchMedia("(max-width: 760px)").matches) $("map").scrollIntoView({ behavior: "smooth" });
      cluster.zoomToShowLayer(m, () => m.openPopup());
    };
    frag.appendChild(li);
  }
  $("list").appendChild(frag);
  shown += PAGE;
  $("more").hidden = shown >= filtered.length;
}

function renderStats() {
  const by = (t) => all.filter((s) => s.type === t).length;
  const cities = new Set(all.map((s) => s.city)).size;
  $("stats").innerHTML = [
    [all.length, "فروشگاه"],
    [by("هایپرمارکت"), "هایپرمارکت"],
    [by("فروشگاه زنجیره‌ای"), "زنجیره‌ای"],
    [all.filter((s) => (s.sources || []).length > 1).length, "در هر دو منبع"],
    [cities, "شهر"],
  ]
    .map(([n, l]) => `<span class="stat"><b>${fa(n)}</b>${l}</span>`)
    .join("");
}

function exportCsv() {
  const cols = [
    ["name", "نام"],
    ["type", "نوع"],
    ["city", "شهر"],
    ["address", "آدرس"],
    ["neighbourhood", "محله"],
    ["phone", "تلفن"],
    ["rating", "امتیاز گوگل"],
    ["ratingCount", "تعداد نظر"],
    ["sourcesText", "منبع"],
    ["lat", "عرض جغرافیایی"],
    ["lng", "طول جغرافیایی"],
  ];
  const cell = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const rows = [cols.map((c) => cell(c[1])).join(",")].concat(filtered.map((s) => ({ ...s, sourcesText: (s.sources || []).map((x) => SOURCE_LABELS[x] || x).join(" + ") })).map((s) => cols.map((c) => cell(s[c[0]])).join(",")));
  // BOM برای اینکه Excel متن فارسی را درست نشان دهد
  const blob = new Blob(["﻿" + rows.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "mazandaran-supermarkets.csv";
  a.click();
  URL.revokeObjectURL(a.href);
}

async function init() {
  let res;
  try {
    res = await fetch("data/stores.json", { cache: "no-cache" });
  } catch {
    res = { ok: false };
  }
  if (!res.ok) {
    $("empty").hidden = false;
    return;
  }
  const data = await res.json();
  all = data.stores || [];
  if (!all.length) {
    $("empty").hidden = false;
    return;
  }

  const date = new Date(data.generatedAt).toLocaleDateString("fa-IR");
  const src = Object.values(data.sources || {})
    .map((x) => x.label + (x.complete ? "" : " (ناقص)"))
    .join(" + ");
  $("meta").textContent = `منبع: ${src} — به‌روزرسانی ${date}`;

  const cities = [...new Set(all.map((s) => s.city))].sort((a, b) => a.localeCompare(b, "fa"));
  for (const c of cities) {
    const n = all.filter((s) => s.city === c).length;
    $("city").insertAdjacentHTML("beforeend", `<option value="${esc(c)}">${esc(c)} (${fa(n)})</option>`);
  }

  buildMarkers();
  renderStats();
  applyFilters();
}

let t;
$("q").addEventListener("input", () => {
  clearTimeout(t);
  t = setTimeout(applyFilters, 200);
});
$("city").addEventListener("change", applyFilters);
$("type").addEventListener("change", applyFilters);
$("source").addEventListener("change", applyFilters);
$("more").addEventListener("click", renderMore);
$("export").addEventListener("click", exportCsv);

init();

// نصب روی گوشی (PWA)
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("sw.js").catch(() => {}));
}

let installPrompt;
window.addEventListener("beforeinstallprompt", (e) => {
  e.preventDefault();
  installPrompt = e;
  $("install").hidden = false;
});
$("install").addEventListener("click", async () => {
  if (!installPrompt) return;
  installPrompt.prompt();
  await installPrompt.userChoice;
  installPrompt = null;
  $("install").hidden = true;
});

// آیفون دکمهٔ نصب خودکار ندارد؛ راهنما را یک بار نشان بده
const isIos = /iphone|ipad|ipod/i.test(navigator.userAgent);
const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone;
let hintSeen = false;
try {
  hintSeen = localStorage.getItem("ios-hint") === "1";
} catch {}
if (isIos && !standalone && !hintSeen) $("ios-hint").hidden = false;
$("ios-hint-close").addEventListener("click", () => {
  $("ios-hint").hidden = true;
  try {
    localStorage.setItem("ios-hint", "1");
  } catch {}
});
