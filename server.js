#!/usr/bin/env node
// سرور سادهٔ بدون وابستگی برای نمایش اپلیکیشن
const http = require("http");
const fs = require("fs");
const path = require("path");

const PORT = Number(process.env.PORT || 3000);
const PUBLIC = path.join(__dirname, "public");
const DATA = path.join(__dirname, "data", "stores.json");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

http
  .createServer((req, res) => {
    const url = decodeURIComponent(new URL(req.url, "http://x").pathname);

    if (url === "/data/stores.json") {
      if (!fs.existsSync(DATA)) {
        res.writeHead(404, { "Content-Type": TYPES[".json"] });
        return res.end(JSON.stringify({ error: "no-data" }));
      }
      res.writeHead(200, { "Content-Type": TYPES[".json"], "Cache-Control": "no-store" });
      return fs.createReadStream(DATA).pipe(res);
    }

    const file = path.join(PUBLIC, url === "/" ? "index.html" : url);
    if (!file.startsWith(PUBLIC + path.sep) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      res.writeHead(404);
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
    fs.createReadStream(file).pipe(res);
  })
  .listen(PORT, () => console.log(`اپلیکیشن آماده است: http://localhost:${PORT}`));
