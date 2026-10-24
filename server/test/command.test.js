import test from 'node:test';
import assert from 'node:assert/strict';

process.env.GEMINI_API_KEY = 'g-test';
process.env.TINYFISH_API_KEY = 'tf-test';
const { handleCommand, validatePlan } = await import('../src/command.js');

const realFetch = globalThis.fetch;
const json = (status, body) => ({ status, ok: status < 400, json: async () => body });
const gem = (obj) => json(200, { candidates: [{ content: { parts: [{ text: JSON.stringify(obj) }] } }] });
let calls;
function mock(handler) { calls = []; globalThis.fetch = async (url, opts) => { const body = opts?.body ? JSON.parse(opts.body) : null; calls.push({ url: String(url), body, headers: opts?.headers }); return handler(String(url), body); }; }
test.afterEach(() => { globalThis.fetch = realFetch; });

const page = {
  url: 'https://school.example/login', title: 'Sign in', sensitive: true, counts: { sections: 2 },
  elements: [{ id: 'e1', kind: 'input', label: 'Username' }, { id: 'e2', kind: 'input', label: 'Password', sensitive: true }],
  text: 'Call us on +91 98765 43210 or mail office@school.example. Your card 4111 1111 1111 1111. OTP is 482913.',
};

test('happy path: Gemini plan is validated and returned; secrets never reach Gemini', async () => {
  mock(() => gem({ say: 'Filling those in.', actions: [{ type: 'type', id: 'e1', text: '{{V1}}' }, { type: 'evil', id: 'x' }, { type: 'navigate', url: 'javascript:alert(1)' }], continue: false }));
  const r = await handleCommand({ utterance: 'type {{V1}} in username. my card is 4111 1111 1111 1111', page, history: [{ role: 'user', text: 'mail me at a@b.co' }] });
  assert.equal(r.status, 200);
  assert.equal(r.body.via, 'gemini');
  assert.deepEqual(r.body.plan.actions.map((a) => a.type), ['type']); // unknown + unsafe actions dropped
  const sent = JSON.stringify(calls[0].body);
  for (const secret of ['98765', 'office@school', '4111', '482913', 'a@b.co']) assert.ok(!sent.includes(secret), `leaked ${secret}`);
  assert.ok(sent.includes('{{V1}}'));
  assert.equal(calls[0].headers['x-goog-api-key'], 'g-test');
});

test('model fallback: 404 on first model tries the next', async () => {
  let n = 0;
  mock((url) => (n++ === 0 ? json(404, {}) : gem({ say: 'ok', actions: [] })));
  const r = await handleCommand({ utterance: 'hello', page });
  assert.equal(r.body.via, 'gemini');
  assert.equal(calls.length, 2);
  assert.notEqual(calls[0].url, calls[1].url);
});

test('Gemini down -> raw statement goes to TinyFish Agent and result is spoken', async () => {
  mock((url) => {
    if (url.includes('generativelanguage')) return json(500, {});
    if (url.endsWith('/run-async')) return json(200, { run_id: 'r1' });
    if (url.includes('/v1/runs/r1')) return json(200, { status: 'COMPLETED', result: { answer: 'The fee is 5000 rupees.' } });
    throw new Error('unexpected ' + url);
  });
  const r = await handleCommand({ utterance: 'what is the admission fee', page });
  assert.equal(r.body.via, 'tinyfish-fallback');
  assert.match(r.body.plan.say, /5000 rupees/);
  const start = calls.find((c) => c.url.endsWith('/run-async'));
  assert.equal(start.body.url, 'https://school.example/login');
  assert.match(start.body.goal, /admission fee/);
  assert.equal(start.headers['X-API-Key'], 'tf-test');
});

test('Gemini down + typed values -> never forwarded to TinyFish', async () => {
  mock((url) => { if (url.includes('generativelanguage')) return json(500, {}); throw new Error('TinyFish must not be called'); });
  const r = await handleCommand({ utterance: 'type {{V1}} in the password field', page });
  assert.equal(r.body.via, 'local');
  assert.ok(!calls.some((c) => c.url.includes('tinyfish')));
});

test('remote search: Gemini asks, TinyFish Search runs, Gemini phrases the result', async () => {
  let g = 0;
  mock((url) => {
    if (url.includes('generativelanguage')) return g++ === 0 ? gem({ say: '', actions: [], remote: { kind: 'search', query: 'ABC school fees' } }) : gem({ say: 'Fees start at five thousand.' });
    if (url.startsWith('https://api.search.tinyfish.ai')) return json(200, { results: [{ title: 'Fees', snippet: 'From 5000', url: 'https://x.y', site_name: 'x.y' }] });
    throw new Error('unexpected ' + url);
  });
  const r = await handleCommand({ utterance: 'search the web for abc school fees', page: { unreadable: true } });
  assert.equal(r.body.via, 'gemini+tinyfish');
  assert.equal(r.body.plan.say, 'Fees start at five thousand.');
  assert.ok(calls.some((c) => c.url.includes('query=ABC')));
});

test('both services fail -> 502 with a clear message', async () => {
  mock(() => json(500, {}));
  const r = await handleCommand({ utterance: 'anything', page });
  assert.equal(r.status, 502);
});

test('validatePlan caps and sanitises', () => {
  const p = validatePlan({ say: 'x'.repeat(5000), actions: Array.from({ length: 20 }, () => ({ type: 'click', id: 'e1' })), continue: 'yes', remote: { kind: 'fetch', url: 'file:///etc/passwd' } });
  assert.equal(p.say.length, 900);
  assert.equal(p.actions.length, 8);
  assert.equal(p.continue, false);
  assert.equal(p.remote, null);
});
