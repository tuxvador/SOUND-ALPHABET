#!/usr/bin/env node
// Static server for Tonescript. No dependencies.
//
//   node server.js                 http on localhost:8080
//   node server.js --port 3000     pick the port
//   node server.js --host 0.0.0.0  expose on the LAN (see the mic note below)
//   node server.js --https         self-signed TLS, needed for mic over LAN
//
// Microphone note: getUserMedia only works in a secure context — HTTPS, or
// localhost. Plain http on a LAN address will load the page but the receiver
// will not be able to listen. Use --https for that case.

"use strict";

const http = require("http");
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execFileSync } = require("child_process");

// ---- args ------------------------------------------------------------------

const argv = process.argv.slice(2);
const flag = (name, fallback) => {
  const i = argv.indexOf("--" + name);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith("--") ? argv[i + 1] : fallback;
};
const has = name => argv.includes("--" + name);

if (has("help")) {
  console.log(fs.readFileSync(__filename, "utf8").split("\n").slice(1, 12).join("\n").replace(/^\/\/ ?/gm, ""));
  process.exit(0);
}

const PORT = Number(flag("port", process.env.PORT || 8080));
const USE_TLS = has("https");
// Exposing on the LAN without TLS gives a page whose mic cannot work, so
// --https implies binding beyond loopback unless the user says otherwise.
const HOST = flag("host", USE_TLS ? "0.0.0.0" : "127.0.0.1");
const ROOT = path.join(__dirname, "public");

// ---- mime ------------------------------------------------------------------

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js":   "text/javascript; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".png":  "image/png",
  ".wav":  "audio/wav",
  ".map":  "application/json; charset=utf-8"
};

// ---- request handling ------------------------------------------------------

function send(res, code, body, headers = {}) {
  res.writeHead(code, {
    "Cache-Control": "no-store",       // always serve the file on disk
    "Content-Length": Buffer.byteLength(body),
    ...headers
  });
  res.end(body);
}

function handler(req, res) {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, "http://x").pathname);
  } catch {
    return send(res, 400, "Bad request", { "Content-Type": "text/plain" });
  }

  if (pathname === "/") pathname = "/index.html";

  // Resolve inside ROOT and verify — blocks ../ traversal and absolute paths.
  const target = path.resolve(ROOT, "." + pathname);
  if (target !== ROOT && !target.startsWith(ROOT + path.sep)) {
    return send(res, 403, "Forbidden", { "Content-Type": "text/plain" });
  }

  fs.stat(target, (err, st) => {
    if (err || !st.isFile()) {
      return send(res, 404, "Not found: " + pathname, { "Content-Type": "text/plain" });
    }
    const type = MIME[path.extname(target).toLowerCase()] || "application/octet-stream";
    const headers = { "Content-Type": type };

    // The page uses the microphone; make that explicit rather than relying on
    // the browser default, which varies.
    if (type.startsWith("text/html")) headers["Permissions-Policy"] = "microphone=(self)";

    if (req.method === "HEAD") return send(res, 200, "", headers);

    res.writeHead(200, { ...headers, "Cache-Control": "no-store", "Content-Length": st.size });
    fs.createReadStream(target).pipe(res).on("error", () => res.destroy());
  });
}

// ---- self-signed cert for --https -----------------------------------------

function ensureCert() {
  const dir = path.join(__dirname, ".cert");
  const key = path.join(dir, "key.pem");
  const crt = path.join(dir, "cert.pem");
  if (fs.existsSync(key) && fs.existsSync(crt)) return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };

  fs.mkdirSync(dir, { recursive: true });
  const ips = Object.values(os.networkInterfaces()).flat()
    .filter(n => n && n.family === "IPv4").map(n => n.address);
  const alt = ["DNS:localhost", "IP:127.0.0.1", ...ips.map(i => "IP:" + i)].join(",");

  console.log("Generating a self-signed certificate in .cert/ …");
  try {
    execFileSync("openssl", [
      "req", "-x509", "-newkey", "rsa:2048", "-nodes",
      "-keyout", key, "-out", crt, "-days", "365",
      "-subj", "/CN=tonescript.local",
      "-addext", "subjectAltName=" + alt
    ], { stdio: "ignore" });
  } catch (e) {
    console.error("\nCould not generate a certificate — is openssl installed?");
    console.error("Run without --https, or install openssl and retry.\n");
    process.exit(1);
  }
  return { key: fs.readFileSync(key), cert: fs.readFileSync(crt) };
}

// ---- start -----------------------------------------------------------------

if (!fs.existsSync(path.join(ROOT, "index.html"))) {
  console.error("public/index.html is missing — nothing to serve.");
  process.exit(1);
}

const server = USE_TLS
  ? https.createServer(ensureCert(), handler)
  : http.createServer(handler);

server.on("error", err => {
  if (err.code === "EADDRINUSE") {
    console.error(`\nPort ${PORT} is already in use. Try:  node server.js --port ${PORT + 1}\n`);
  } else {
    console.error(err.message);
  }
  process.exit(1);
});

server.listen(PORT, HOST, () => {
  const scheme = USE_TLS ? "https" : "http";
  const shown = HOST === "0.0.0.0" ? "localhost" : HOST;

  console.log(`\n  Tonescript — ${scheme}://${shown}:${PORT}\n`);

  if (HOST === "0.0.0.0") {
    const ips = Object.values(os.networkInterfaces()).flat()
      .filter(n => n && n.family === "IPv4" && !n.internal)
      .map(n => n.address);
    if (ips.length) {
      console.log("  On your network:");
      ips.forEach(ip => console.log(`    ${scheme}://${ip}:${PORT}`));
      console.log("");
    }
    if (USE_TLS) {
      console.log("  The certificate is self-signed, so the browser will warn once.");
      console.log("  Accept it, or the microphone will not be available.\n");
    } else {
      console.log("  Note: over http the mic works only via localhost.");
      console.log("  For another device, restart with --https\n");
    }
  }

  console.log("  Ctrl-C to stop\n");
});

for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => { console.log("\nStopped."); server.close(() => process.exit(0)); });
}
