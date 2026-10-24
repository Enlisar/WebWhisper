import { scrub, redactText } from "./redact.js";
import { generateJSON } from "./gemini.js";
import * as tf from "./tinyfish.js";
import { PLAN_SYSTEM, COMPOSE_SYSTEM, NARRATE_SYSTEM } from "./prompts.js";

const PLACEHOLDER = /\{\{V\d+\}\}/;
export const cap = (s, n) => String(s ?? "").slice(0, n);
export const isHttp = (u) => {
  try {
    return /^https?:$/.test(new URL(u).protocol);
  } catch {
    return false;
  }
};

export function cleanPage(p) {
  if (!p || typeof p !== "object") return { unreadable: true };
  const page = scrub(p);
  if (Array.isArray(page.elements)) page.elements = page.elements.slice(0, 200);
  if (Array.isArray(page.sections)) page.sections = page.sections.slice(0, 40);
  if (Array.isArray(page.headings)) page.headings = page.headings.slice(0, 60);
  if (typeof page.text === "string") page.text = page.text.slice(0, 4500);
  return page;
}
export const cleanHistory = (h) =>
  Array.isArray(h)
    ? h.slice(-10).map((m) => ({
        role: m.role === "assistant" ? "assistant" : "user",
        text: redactText(cap(m.text, 400)),
      }))
    : [];
export const cleanObservation = (o) =>
  o && Array.isArray(o.done)
    ? {
        done: o.done.slice(0, 10).map((d) => ({
          type: cap(d.type, 20),
          ok: !!d.ok,
          note: redactText(cap(d.note, 160)),
        })),
      }
    : null;

const ACTIONS = new Set([
  "click",
  "type",
  "select",
  "focus",
  "press",
  "scroll",
  "navigate",
  "open_tab",
  "back",
  "forward",
]);
export function validatePlan(raw) {
  if (!raw || typeof raw !== "object") throw new Error("Plan is not an object");
  const actions = [];
  for (const a of Array.isArray(raw.actions) ? raw.actions.slice(0, 8) : []) {
    if (!a || !ACTIONS.has(a.type)) continue;
    if ((a.type === "navigate" || a.type === "open_tab") && !isHttp(a.url))
      continue;
    const clean = { type: a.type };
    if (a.id) clean.id = cap(a.id, 12);
    if (a.text != null) clean.text = cap(a.text, 300);
    if (a.value != null) clean.value = cap(a.value, 200);
    if (a.key)
      clean.key = ["Enter", "Tab", "Escape"].includes(a.key) ? a.key : "Enter";
    if (a.direction)
      clean.direction = ["down", "up", "top", "bottom"].includes(a.direction)
        ? a.direction
        : "down";
    if (a.url) clean.url = cap(a.url, 2000);
    actions.push(clean);
  }
  let remote = null;
  const r = raw.remote;
  if (r && r.kind === "search" && r.query)
    remote = { kind: "search", query: cap(r.query, 200) };
  else if (r && r.kind === "fetch" && isHttp(r.url))
    remote = { kind: "fetch", url: r.url };
  else if (r && r.kind === "agent" && isHttp(r.url) && r.goal)
    remote = { kind: "agent", url: r.url, goal: cap(r.goal, 600) };
  return {
    say: cap(raw.say, 900),
    actions,
    continue: raw.continue === true,
    remote,
  };
}

async function runRemote(remote) {
  if (!tf.tinyfishConfigured()) throw new Error("TINYFISH_API_KEY not set");
  if (remote.kind === "search")
    return { kind: "search", data: await tf.search(remote.query) };
  if (remote.kind === "fetch")
    return { kind: "fetch", data: await tf.fetchPage(remote.url) };
  return {
    kind: "agent",
    data: await tf.runAgent({ url: remote.url, goal: remote.goal }),
  };
}

function remoteFallbackText(res) {
  if (res.kind === "search") {
    const top = res.data
      .slice(0, 3)
      .map((r) => `${r.site || "a site"} says: ${r.snippet || r.title}`)
      .join(" ");
    return top || "I couldn't find anything useful.";
  }
  if (res.kind === "fetch")
    return cap(
      res.data.text.replace(/[#*_`>\[\]]/g, " ").replace(/\s+/g, " "),
      500,
    );
  return (
    tf.resultToText(res.data) ||
    "The task finished, but there was nothing to report."
  );
}

// Returns { status, body }
export async function handleCommand(b = {}, { log = () => {} } = {}) {
  const utterance = redactText(cap(b.utterance, 1000)).trim();
  if (!utterance)
    return { status: 400, body: { ok: false, error: "Empty request" } };
  const page = cleanPage(b.page);
  const history = cleanHistory(b.history);
  const observation = cleanObservation(b.observation);
  const step = Math.min(Number(b.step) || 0, 9);

  try {
    const raw = await generateJSON({
      system: PLAN_SYSTEM,
      user: JSON.stringify({ utterance, step, observation, history, page }),
    });
    const plan = validatePlan(raw);
    if (plan.remote) {
      let say;
      try {
        const out = await runRemote(plan.remote);
        try {
          const c = await generateJSON({
            system: COMPOSE_SYSTEM,
            user: JSON.stringify({
              question: utterance,
              kind: out.kind,
              data:
                out.kind === "agent"
                  ? tf.resultToText(out.data, 3000)
                  : out.data,
            }),
            temperature: 0.4,
          });
          say = cap(c.say, 900);
        } catch {
          say = remoteFallbackText(out);
        }
      } catch (e) {
        say = `I tried to look that up but it didn't work. ${cap(e.message, 120)}`;
      }
      return {
        status: 200,
        body: {
          ok: true,
          via: "gemini+tinyfish",
          plan: { say, actions: [], continue: false, remote: null },
        },
      };
    }
    return { status: 200, body: { ok: true, via: "gemini", plan } };
  } catch (e) {
    log("[plan] Gemini unavailable:", e.message);
  }

  if (PLACEHOLDER.test(utterance)) {
    return {
      status: 200,
      body: {
        ok: true,
        via: "local",
        plan: {
          say: "I can't reach my planner right now, and I won't pass your typed details to an outside browser. Please try again in a moment.",
          actions: [],
          continue: false,
          remote: null,
        },
      },
    };
  }
  if (!tf.tinyfishConfigured())
    return {
      status: 503,
      body: { ok: false, error: "No AI service is configured on the server" },
    };
  try {
    const startUrl = isHttp(page.url) ? page.url : "https://www.google.com";
    const result = await tf.runAgent({
      url: startUrl,
      goal: `${utterance}\n\nReply with a short plain-English answer.`,
    });
    const text =
      tf.resultToText(result) ||
      "The task finished, but there was nothing to report.";
    return {
      status: 200,
      body: {
        ok: true,
        via: "tinyfish-fallback",
        plan: {
          say: `My planner is unavailable, so I asked a cloud browser to do that. Your own tab didn't change. ${text}`,
          actions: [],
          continue: false,
          remote: null,
        },
      },
    };
  } catch (e) {
    log("[fallback] TinyFish failed:", e.message);
    return {
      status: 502,
      body: {
        ok: false,
        error: `Both AI services failed. ${cap(e.message, 120)}`,
      },
    };
  }
}

export async function handleNarrate(b = {}) {
  if (process.env.NARRATE_WITH_GEMINI === "false") return { ok: false };
  try {
    const info = cleanPage(b.info);
    const out = await generateJSON({
      system: NARRATE_SYSTEM,
      user: JSON.stringify(info),
      temperature: 0.4,
      timeoutMs: 2800,
      singleModel: true,
    });
    if (!out?.say) throw new Error("empty");
    return { ok: true, say: cap(out.say, 700) };
  } catch {
    return { ok: false };
  }
}
