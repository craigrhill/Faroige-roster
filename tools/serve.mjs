#!/usr/bin/env node
// Local preview. Serves the repo and runs the real rota function from its
// source against an in-memory store that lasts for the life of the process,
// so the pages can be exercised end to end without Netlify. The coordinator
// signs in on the roster page with any name and the password "local", unless
// ADMIN_PASSWORD is set.
//
//   node tools/serve.mjs [port]
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, normalize, join } from "node:path";
import { createHandler, memoryStore } from "../netlify/src/foroige.mjs";

process.env.ADMIN_PASSWORD ||= "local";
const rota = createHandler((() => { const s = memoryStore(); return () => s; })());

const port = Number(process.argv[2]) || 8899;
// A stylesheet served without text/css is silently ignored by the browser,
// which looks exactly like a broken page. Keep this table honest.
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
  ".css": "text/css", ".json": "application/json", ".png": "image/png", ".svg": "image/svg+xml",
  ".ico": "image/x-icon", ".txt": "text/plain", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.includes("/.netlify/functions/foroige")) {
    const chunks = []; for await (const c of req) chunks.push(c);
    const init = { method: req.method, headers: req.headers };
    if (chunks.length) init.body = Buffer.concat(chunks);
    const out = await rota(new Request(url, init));
    res.writeHead(out.status, Object.fromEntries(out.headers));
    return res.end(Buffer.from(await out.arrayBuffer()));
  }
  // Keep the path inside the repo: strip leading slashes after normalising.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "").replace(/^[/\\]+/, "");
  const file = join(process.cwd(), rel || "events.html");
  try {
    const buf = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] || "application/octet-stream" });
    res.end(buf);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain" });
    res.end("Not found");
  }
}).listen(port, () => console.log(`http://127.0.0.1:${port}/events.html`));
