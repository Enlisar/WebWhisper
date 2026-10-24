import "dotenv/config";
import express from "express";
import { geminiConfigured } from "./gemini.js";
import { tinyfishConfigured } from "./tinyfish.js";
import { handleCommand, handleNarrate } from "./command.js";

const app = express();
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";

app.disable("x-powered-by");
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin) {
    const id = process.env.ALLOWED_EXTENSION_ID;
    const ok = id
      ? origin === `chrome-extension://${id}`
      : origin.startsWith("chrome-extension://");
    if (!ok)
      return res.status(403).json({ ok: false, error: "Origin not allowed" });
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type, X-WW-Token");
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  }
  if (req.method === "OPTIONS") return res.sendStatus(204);
  if (
    process.env.WW_TOKEN &&
    req.headers["x-ww-token"] !== process.env.WW_TOKEN
  )
    return res.status(401).json({ ok: false, error: "Bad token" });
  next();
});
const hits = new Map();
app.use((req, res, next) => {
  const now = Date.now();
  const h = hits.get(req.ip) || { n: 0, reset: now + 60000 };
  if (now > h.reset) {
    h.n = 0;
    h.reset = now + 60000;
  }
  h.n++;
  hits.set(req.ip, h);
  if (h.n > 120)
    return res.status(429).json({ ok: false, error: "Too many requests" });
  next();
});
app.use(express.json({ limit: "400kb" }));

// ---------- routes ----------
app.get("/api/health", (req, res) =>
  res.json({
    ok: true,
    gemini: geminiConfigured(),
    tinyfish: tinyfishConfigured(),
  }),
);
app.post("/api/command", async (req, res) => {
  try {
    const { status, body } = await handleCommand(req.body, {
      log: (...a) => console.warn(...a),
    });
    res.status(status).json(body);
  } catch (e) {
    console.error("[command]", e.message);
    res.status(500).json({ ok: false, error: "Unexpected server error" });
  }
});
app.post("/api/narrate", async (req, res) => {
  try {
    res.json(await handleNarrate(req.body));
  } catch {
    res.json({ ok: false });
  }
});

app.use((err, req, res, next) =>
  res.status(400).json({ ok: false, error: "Bad request" }),
);

app.listen(PORT, HOST, () => {
  console.log(`WebWhisper server on http://${HOST}:${PORT}`);
  console.log(
    `  TinyFish: ${tinyfishConfigured() ? "key set" : "MISSING TINYFISH_API_KEY"}   Gemini: ${geminiConfigured() ? "key set" : "not set (TinyFish-only fallback mode)"}`,
  );
});
