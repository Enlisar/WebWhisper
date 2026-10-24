import 'dotenv/config';
import { generateJSON, geminiConfigured } from '../src/gemini.js';
import * as tf from '../src/tinyfish.js';

const ok = (m) => console.log('  ✔', m);
const bad = (m) => console.log('  ✘', m);

console.log('TinyFish');
if (!tf.tinyfishConfigured()) bad('TINYFISH_API_KEY missing');
else {
  try { const r = await tf.search('web accessibility'); ok(`Search works (${r.length} results)`); } catch (e) { bad('Search: ' + e.message); }
  try { const r = await tf.fetchPage('https://example.com'); ok(`Fetch works (${r.text.length} chars)`); } catch (e) { bad('Fetch: ' + e.message); }
  if (process.argv.includes('--agent')) {
    try { const r = await tf.runAgent({ url: 'https://example.com', goal: 'What is the page title? Reply in one sentence.', timeoutMs: 60000 }); ok('Agent works: ' + tf.resultToText(r, 120)); } catch (e) { bad('Agent: ' + e.message); }
  } else console.log('  - Agent not tested (uses credits). Run: npm run check -- --agent');
}
console.log('Gemini');
if (!geminiConfigured()) console.log('  - not configured (optional). TinyFish-only fallback mode will be used.');
else {
  try { const r = await generateJSON({ system: 'Reply with JSON only.', user: '{"say":"hi"} -> return {"ok":true}', timeoutMs: 15000 }); ok('Gemini works: ' + JSON.stringify(r)); } catch (e) { bad('Gemini: ' + e.message); }
}
