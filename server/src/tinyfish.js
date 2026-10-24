const KEY = () => process.env.TINYFISH_API_KEY;
const H = () => ({ "X-API-Key": KEY(), "Content-Type": "application/json" });
export const tinyfishConfigured = () => Boolean(KEY());
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function http(url, opts = {}, timeoutMs = 30000) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { ...opts, signal: ctl.signal });
    const body = await res.json().catch(() => null);
    if (!res.ok)
      throw new Error(
        `TinyFish HTTP ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`,
      );
    return body;
  } finally {
    clearTimeout(t);
  }
}

export async function search(query) {
  const u = new URL("https://api.search.tinyfish.ai");
  u.searchParams.set("query", query);
  const data = await http(u, { headers: H() }, 15000);
  return (data?.results || []).slice(0, 6).map((r) => ({
    title: r.title,
    snippet: r.snippet,
    url: r.url,
    site: r.site_name,
  }));
}

export async function fetchPage(url, format = "markdown") {
  const data = await http(
    "https://api.fetch.tinyfish.ai",
    {
      method: "POST",
      headers: H(),
      body: JSON.stringify({ urls: [url], format }),
    },
    30000,
  );
  const r = data?.results?.[0];
  if (!r)
    throw new Error(data?.errors?.[0]?.message || "Could not fetch that page");
  return {
    url: r.final_url || r.url,
    text: String(r.text || "").slice(0, 8000),
  };
}

export async function runAgent({ url, goal, timeoutMs = 90000 }) {
  const started = await http(
    "https://agent.tinyfish.ai/v1/automation/run-async",
    { method: "POST", headers: H(), body: JSON.stringify({ url, goal }) },
    20000,
  );
  const runId = started?.run_id || started?.id;
  if (!runId)
    throw new Error(
      started?.error?.message || "TinyFish did not return a run id",
    );
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await sleep(2000);
    const run = await http(
      `https://agent.tinyfish.ai/v1/runs/${runId}`,
      { headers: H() },
      15000,
    );
    const status = String(run?.status || "").toUpperCase();
    if (status === "COMPLETED") return run.result ?? run;
    if (status === "FAILED" || status === "CANCELLED")
      throw new Error(
        run?.error?.message || `TinyFish run ${status.toLowerCase()}`,
      );
  }
  fetch(`https://agent.tinyfish.ai/v1/runs/${runId}/cancel`, {
    method: "POST",
    headers: H(),
  }).catch(() => {});
  throw new Error("TinyFish took too long");
}

export function resultToText(r, max = 700) {
  if (r == null) return "";
  if (typeof r === "string") return r.slice(0, max);
  for (const k of ["answer", "summary", "result", "text", "message"])
    if (typeof r[k] === "string") return r[k].slice(0, max);
  const lines = [];
  const walk = (v, key = "") => {
    if (lines.join(" ").length > max) return;
    if (Array.isArray(v)) v.slice(0, 8).forEach((x) => walk(x, key));
    else if (v && typeof v === "object")
      Object.entries(v).forEach(([k, x]) => walk(x, k));
    else if (v != null && v !== "")
      lines.push(key ? `${key.replace(/_/g, " ")}: ${v}` : String(v));
  };
  walk(r);
  return lines.join(". ").slice(0, max);
}
