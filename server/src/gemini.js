const BASE = "https://generativelanguage.googleapis.com/v1beta/models";
let preferred = 0;

export const geminiConfigured = () => Boolean(process.env.GEMINI_API_KEY);
const models = () =>
  (
    process.env.GEMINI_MODELS ||
    "gemini-flash-latest,gemini-flash-lite-latest,gemini-2.5-flash"
  )
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

function parseJSON(text) {
  const t = String(text || "")
    .trim()
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/, "")
    .trim();
  return JSON.parse(t);
}

export async function generateJSON({
  system,
  user,
  temperature = 0.3,
  timeoutMs = 15000,
  singleModel = false,
}) {
  if (!geminiConfigured()) throw new Error("GEMINI_API_KEY not set");
  const list = models();
  const order = singleModel
    ? [list[preferred] || list[0]]
    : [...list.slice(preferred), ...list.slice(0, preferred)];
  let lastErr;
  for (const model of order) {
    for (let attempt = 0; attempt < 2; attempt++) {
      const ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(), timeoutMs);
      try {
        const res = await fetch(`${BASE}/${model}:generateContent`, {
          method: "POST",
          signal: ctl.signal,
          headers: {
            "Content-Type": "application/json",
            "x-goog-api-key": process.env.GEMINI_API_KEY,
          },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: "user", parts: [{ text: user }] }],
            generationConfig: {
              temperature,
              responseMimeType: "application/json",
            },
          }),
        });
        if (res.status === 404 || res.status === 400) {
          lastErr = new Error(`${model}: HTTP ${res.status}`);
          break;
        } // next model
        if (res.status === 429 || res.status >= 500) {
          lastErr = new Error(`${model}: HTTP ${res.status}`);
          continue;
        } // retry once
        if (!res.ok) throw new Error(`${model}: HTTP ${res.status}`);
        const data = await res.json();
        const text = (data.candidates?.[0]?.content?.parts || [])
          .map((p) => p.text || "")
          .join("");
        const json = parseJSON(text);
        preferred = list.indexOf(model);
        return json;
      } catch (e) {
        lastErr = e;
        if (e.name === "AbortError") break;
      } finally {
        clearTimeout(timer);
      }
    }
  }
  throw lastErr || new Error("Gemini failed");
}
