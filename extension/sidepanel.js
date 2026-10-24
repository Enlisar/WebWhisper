import { CONFIG } from './config.js';
import { maskUtterance, resolveValues, stripTokens } from './lib/mask.js';
import { Speaker } from './lib/speech.js';
import { Mic } from './lib/mic.js';
import { composeLocal } from './lib/describe.js';
import { tone } from './lib/tones.js';

const $ = (s) => document.querySelector(s);
const els = {
  app: $('#app'), log: $('#log'), empty: $('#empty'), input: $('#input'), form: $('#composer'), mic: $('#mic'), micLabel: $('#micLabel'),
  stop: $('#stop'), status: $('#status'), interim: $('#interim'), site: $('#site'), plus: $('#fsPlus'), minus: $('#fsMinus'), banner: $('#banner'),
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------- state (typed values live ONLY here, in memory, never stored or sent) ----------
const state = {
  messages: [],        // {role:'user'|'assistant'|'action', text, sent?, fail?}
  values: {},          // {V1: 'real text'}  <- never persisted
  nextIndex: 1,
  busy: false,
  abort: false,
  controller: null,
  queue: [],
  pending: null,       // risky click awaiting "yes"
  byId: {},
  ignoreVoiceUntil: 0,
  fsIndex: CONFIG.DEFAULT_FONT_INDEX,
  ctrlToken: 0,
};

const RISKY = /\b(pay(?:ment)?|purchase|buy(?: now)?|place (?:your |my )?order|checkout|confirm (?:order|payment|purchase)|delete|remove account|close account|transfer|send money|donate|unsubscribe|cancel (?:subscription|order))\b/i;
const YES = /^(yes|yeah|yep|yup|sure|ok|okay|go ahead|do it|confirm|proceed|please do|absolutely)\b/i;
const NO = /^(no|nope|nah|cancel|don'?t|do not|never ?mind)\b/i;
const STOP = /^(stop|stop (it|that|talking|speaking)|be quiet|quiet|shut up|enough|pause|cancel that)[.!]?$/i;

// ---------- UI ----------
function setStatus(kind) {
  const k = kind || (mic.on ? 'listening' : 'idle');
  els.status.dataset.state = k;
  els.status.textContent = { idle: 'Ready', listening: 'Listening', thinking: 'Thinking', acting: 'Working on the page', speaking: 'Speaking' }[k] || 'Ready';
}

function render(m) {
  els.empty?.remove();
  const wrap = document.createElement(m.role === 'action' ? 'div' : 'article');
  if (m.role === 'action') {
    wrap.className = 'act' + (m.fail ? ' fail' : '');
    wrap.textContent = m.text;
  } else {
    wrap.className = 'msg ' + m.role;
    const who = document.createElement('div');
    who.className = 'who';
    who.textContent = m.role === 'user' ? 'You' : m.label || 'WebWhisper';
    const p = document.createElement('p');
    p.className = 'txt';
    p.textContent = m.text; // textContent only: page-derived text can never inject markup
    wrap.append(who, p);
  }
  els.log.append(wrap);
  els.log.scrollTop = els.log.scrollHeight;
}

function addMessage(m) {
  if (m.label === 'Under your pointer' && state.messages.length > 0) {
    const last = state.messages[state.messages.length - 1];
    if (last.label === 'Under your pointer') {
      last.text = m.text;
      const lastEl = els.log.querySelector('.msg.assistant:last-child .txt');
      if (lastEl) {
        lastEl.textContent = m.text;
        els.log.scrollTop = els.log.scrollHeight;
        chrome.storage.session.set({ ww_messages: state.messages }).catch(() => {});
        return;
      }
    }
  }
  state.messages.push(m);
  if (state.messages.length > 80) state.messages.shift();
  render(m);
  chrome.storage.session.set({ ww_messages: state.messages }).catch(() => {});
}

function banner(text) {
  els.banner.hidden = !text;
  els.banner.textContent = text || '';
}

function applyFont(i) {
  state.fsIndex = Math.max(0, Math.min(CONFIG.FONT_SIZES.length - 1, i));
  document.documentElement.style.setProperty('--fs', CONFIG.FONT_SIZES[state.fsIndex] + 'px');
  els.minus.disabled = state.fsIndex === 0;
  els.plus.disabled = state.fsIndex === CONFIG.FONT_SIZES.length - 1;
  chrome.storage.local.set({ ww_fs: state.fsIndex }).catch(() => {});
}

// ---------- speech + mic ----------
const speaker = new Speaker({
  onStart: () => setStatus('speaking'),
  onEnd: () => { state.ignoreVoiceUntil = Date.now() + 700; setStatus(state.busy ? 'thinking' : undefined); },
});

const mic = new Mic({
  lang: CONFIG.MIC_LANG,
  onInterim: (t) => { els.interim.textContent = t; },
  onFinal: (t) => {
    els.interim.textContent = '';
    if (Date.now() < state.ignoreVoiceUntil) return;
    if (speaker.speaking) { if (STOP.test(t.trim())) stopAll(); return; } // ignore our own voice; only "stop" gets through
    submit(t, 'voice');
  },
  onState: (on) => {
    els.mic.setAttribute('aria-pressed', String(on));
    els.mic.setAttribute('aria-label', on ? 'Microphone on. Press to turn off.' : 'Microphone off. Press to turn on.');
    els.micLabel.textContent = on ? 'Mic on' : 'Mic off';
    setStatus();
  },
  onError: (msg) => { tone('error'); addMessage({ role: 'assistant', text: msg }); speaker.speak(msg); },
  onNeedPermission: () => {
    const msg = 'I need your permission to use the microphone. I\u2019m opening a tab where you can allow it once for all websites.';
    addMessage({ role: 'assistant', text: msg });
    speaker.speak(msg);
    chrome.tabs.create({ url: chrome.runtime.getURL('permission.html') });
  },
});

async function toggleMic() {
  if (mic.on) { mic.disable(); tone('off'); setStatus(); return; }
  if (await mic.enable()) { tone('on'); setStatus(); }
}

function stopAll() {
  state.abort = true;
  state.controller?.abort();
  speaker.stop();
  state.queue = [];
}

function say(text, opts = {}) {
  const t = stripTokens(text).trim();
  if (!t) return;
  addMessage({ role: 'assistant', text: t, label: opts.label });
  speaker.speak(t, { interrupt: !!opts.interrupt });
}

// ---------- page access ----------
const scriptable = (url) => /^https?:\/\//i.test(url || '');
const hostOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return ''; } };
const safeUrl = (u) => { try { return /^https?:$/.test(new URL(u).protocol); } catch { return false; } };

async function activeTab() {
  try {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    if (t && scriptable(t.url)) return t;

    const allActive = await chrome.tabs.query({ active: true });
    const webTab = allActive.find((tab) => tab.url && scriptable(tab.url));
    if (webTab) return webTab;

    const normalTab = allActive.find((tab) => tab.url && !tab.url.startsWith('chrome-extension://'));
    if (normalTab) return normalTab;
    return t;
  } catch {
    const [t] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
    return t;
  }
}
async function ensureContent(tabId) {
  const ping = () => chrome.tabs.sendMessage(tabId, { ww: true, type: 'ping' }, { frameId: 0 }).then((r) => !!r?.ok).catch(() => false);
  if (await ping()) return true;
  try { await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch { return false; }
  await sleep(200);
  return ping();
}
async function getSnapshot(tabId) {
  if (!(await ensureContent(tabId))) return null;
  try {
    const r = await chrome.tabs.sendMessage(tabId, { ww: true, type: 'snapshot' }, { frameId: 0 });
    return r?.ok ? r.snapshot : null;
  } catch { return null; }
}
async function waitForSettle(tabId, ms = 12000) {
  const start = Date.now();
  await sleep(350);
  while (Date.now() - start < ms) {
    const t = await chrome.tabs.get(tabId).catch(() => null);
    if (!t || t.status === 'complete') break;
    await sleep(200);
  }
  await sleep(500);
}
async function refreshSite() {
  const t = await activeTab();
  els.site.textContent = t && scriptable(t.url) ? (t.title ? `${t.title} \u00b7 ${hostOf(t.url)}` : hostOf(t.url)) : 'No readable page (open a website)';
}

// ---------- actions ----------
async function runAction(tab, a) {
  try {
    if (a.type === 'navigate') {
      if (!safeUrl(a.url)) return { ok: false, note: 'I blocked an unsafe address.' };
      await chrome.tabs.update(tab.id, { url: a.url });
      await waitForSettle(tab.id);
      return { ok: true, navigated: true, note: `Opened ${hostOf(a.url)}` };
    }
    if (a.type === 'open_tab') {
      if (!safeUrl(a.url)) return { ok: false, note: 'I blocked an unsafe address.' };
      const t = await chrome.tabs.create({ url: a.url, active: true });
      await waitForSettle(t.id);
      return { ok: true, navigated: true, note: `Opened ${hostOf(a.url)} in a new tab` };
    }
    if (a.type === 'back' || a.type === 'forward') {
      await (a.type === 'back' ? chrome.tabs.goBack(tab.id) : chrome.tabs.goForward(tab.id));
      await waitForSettle(tab.id);
      return { ok: true, navigated: true, note: a.type === 'back' ? 'Went back' : 'Went forward' };
    }
    const action = { ...a };
    if (a.type === 'type') {
      const text = resolveValues(a.text, state.values);
      if (text === null) return { ok: false, note: 'I don\u2019t have the text you wanted typed.' };
      action.text = text;
    }
    let r;
    try {
      r = await chrome.tabs.sendMessage(tab.id, { ww: true, type: 'exec', action }, { frameId: 0 });
    } catch (e) {
      // A click that navigates tears down the page before it can answer.
      if ((a.type === 'click' || a.type === 'press') && /port closed|Receiving end|context invalidated/i.test(String(e.message))) return { ok: true, navigated: true, note: 'Page changed' };
      return { ok: false, note: 'I couldn\u2019t reach the page.' };
    }
    if (r?.openUrl && safeUrl(r.openUrl)) {
      const t = await chrome.tabs.create({ url: r.openUrl, active: true });
      await waitForSettle(t.id);
      return { ok: true, navigated: true, note: r.note };
    }
    return r || { ok: false, note: 'No response from the page.' };
  } catch (e) {
    return { ok: false, note: String(e.message || e).slice(0, 120) };
  }
}

const labelOfId = (id) => state.byId[id]?.label || '';
const historyForServer = () => state.messages.filter((m) => m.role !== 'action').slice(-10).map((m) => ({ role: m.role, text: m.sent || m.text }));

async function api(path, body, { timeout = 60000, track = true } = {}) {
  const ctl = new AbortController();
  if (track) state.controller = ctl; // so Stop can cancel an in-flight plan
  const timer = setTimeout(() => ctl.abort(), timeout);
  try {
    const res = await fetch(CONFIG.SERVER_URL + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(CONFIG.TOKEN ? { 'X-WW-Token': CONFIG.TOKEN } : {}) },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    const j = await res.json().catch(() => null);
    if (!res.ok || !j?.ok) throw Object.assign(new Error(j?.error || `Server error ${res.status}`), { status: res.status });
    return j;
  } finally {
    clearTimeout(timer);
  }
}

function friendlyError(e) {
  if (e.name === 'AbortError') return state.abort ? '' : 'That took too long. Please try again.';
  if (e instanceof TypeError) return 'I can\u2019t reach the WebWhisper server. Make sure it\u2019s running, then try again.';
  return `Something went wrong. ${e.message}`;
}

// ---------- the agent loop: look -> plan -> act -> look again ----------
async function agentLoop(masked, { observation = null } = {}) {
  state.busy = true;
  state.abort = false;
  let failures = 0;
  try {
    for (let step = 0; step < CONFIG.MAX_STEPS && !state.abort; step++) {
      setStatus('thinking');
      const tab = await activeTab();
      const readable = tab && scriptable(tab.url);
      const snap = readable ? await getSnapshot(tab.id) : null;
      state.byId = Object.fromEntries((snap?.elements || []).map((e) => [e.id, e]));
      if (tab) refreshSite();

      let plan;
      try {
        ({ plan } = await api('/api/command', { utterance: masked, step, observation, history: historyForServer(), page: snap || { unreadable: true, title: tab?.title || '' } }));
      } catch (e) {
        const msg = friendlyError(e);
        if (msg) { tone('error'); say(msg); }
        return;
      }
      if (state.abort) return;
      if (plan.say) say(plan.say);

      const done = [];
      let navigated = false;
      if (plan.actions?.length) setStatus('acting');
      for (const a of plan.actions || []) {
        if (state.abort) return;
        if (a.type === 'click' && RISKY.test(labelOfId(a.id))) {
          const label = labelOfId(a.id);
          state.pending = { tabId: tab.id, action: a, label };
          say(`The \u201c${label}\u201d button may be hard to undo. Should I go ahead? Say yes or no.`);
          return;
        }
        const r = await runAction(tab, a);
        const note = r.note;
        done.push({ type: a.type, ok: !!r.ok, note });
        if (note) addMessage({ role: 'action', text: r.ok ? note : `Couldn\u2019t do that: ${note}`, fail: !r.ok });
        if (!r.ok) break;
        if (r.navigated) { navigated = true; break; }
      }

      const failed = done.some((d) => !d.ok);
      if (failed) failures++;
      if (!(plan.continue || failed) || failures > 1) return;
      if (!navigated && done.length) await sleep(700);
      else if (navigated) { const t2 = await activeTab(); if (t2) await waitForSettle(t2.id); }
      observation = { done };
    }
  } finally {
    state.busy = false;
    setStatus();
    const next = state.queue.shift();
    if (next) handleUtterance(next.text, next.source);
  }
}

// ---------- input handling ----------
function localIntent(text) {
  const t = text.trim().toLowerCase().replace(/[.!?]+$/, '');
  if (STOP.test(t)) return () => { stopAll(); };
  if (/^(repeat( that)?|say that again|come again|what did you say)$/.test(t)) {
    const last = [...state.messages].reverse().find((m) => m.role === 'assistant');
    return () => last && speaker.speak(last.text, { interrupt: true });
  }
  if (/^(speak|talk)?\s*(a bit |a little )?(faster|quicker)$|^faster$/.test(t)) return () => { speaker.rate = Math.min(1.6, +(speaker.rate + 0.15).toFixed(2)); chrome.storage.local.set({ ww_rate: speaker.rate }); say('Okay, a bit faster.', { interrupt: true }); };
  if (/^(speak|talk)?\s*(a bit |a little )?slower$|^slower$/.test(t)) return () => { speaker.rate = Math.max(0.7, +(speaker.rate - 0.15).toFixed(2)); chrome.storage.local.set({ ww_rate: speaker.rate }); say('Okay, a bit slower.', { interrupt: true }); };
  if (/^(stop listening|mute( the)? ?(mic|microphone)?|turn off (the )?(mic|microphone))$/.test(t)) return () => { mic.disable(); tone('off'); say('Microphone off.', { interrupt: true }); };
  return null;
}

function submit(text, source) {
  const t = String(text || '').trim();
  if (!t) return;
  if (state.busy && !STOP.test(t.toLowerCase())) {
    state.queue.push({ text: t, source });
    return;
  }
  handleUtterance(t, source);
}

async function handleUtterance(text, source) {
  const intent = localIntent(text);
  if (intent) { addMessage({ role: 'user', text }); intent(); return; }

  speaker.stop(); // a new request always interrupts old speech
  const m = maskUtterance(text, state.nextIndex);
  state.nextIndex = m.nextIndex;
  Object.assign(state.values, m.values);
  addMessage({ role: 'user', text: m.display, sent: m.masked });

  // Answer to "should I go ahead?"
  if (state.pending) {
    const p = state.pending;
    state.pending = null;
    if (YES.test(text.trim())) {
      state.busy = true;
      setStatus('acting');
      const tab = await activeTab();
      const r = await runAction(tab || { id: p.tabId }, p.action);
      addMessage({ role: 'action', text: r.ok ? r.note : `Couldn\u2019t do that: ${r.note}`, fail: !r.ok });
      state.busy = false;
      await sleep(700);
      return agentLoop(`The user confirmed and I just pressed \u201c${p.label}\u201d. Tell them what happened on the page.`, { observation: { done: [{ type: 'click', ok: !!r.ok, note: r.note }] } });
    }
    if (NO.test(text.trim())) { say('Okay, I won\u2019t do that.'); return; }
  }
  return agentLoop(m.masked);
}

// ---------- Ctrl + hover descriptions ----------
async function onCtrl(info) {
  const token = ++state.ctrlToken;
  setStatus('thinking');
  let text = composeLocal(info);

  // If the element has vague labels, is an image/file/diagram link, or a section container, let Gemini explain it naturally in simple terms!
  const needsGemini = !info.label || info.isImageLink || info.vague || (info.kind === 'section' && (!info.text || info.text.length > 250));
  if (needsGemini) {
    try {
      const r = await api('/api/narrate', { info }, { timeout: 2200, track: false });
      if (r?.say) text = r.say;
    } catch { /* local description is ready fallback */ }
  }

  if (token !== state.ctrlToken) return;
  setStatus();
  say(text, { interrupt: true, label: 'Under your pointer' });
}

chrome.runtime.onMessage.addListener((msg, sender) => {
  if (!msg?.ww) return;
  if (msg.type === 'ctrl' && sender.tab?.active) onCtrl(msg.info);
  if (msg.type === 'command') runCommand(msg.command);
  if (msg.type === 'mic-granted') toggleMicIfOff();
});
async function toggleMicIfOff() { if (!mic.on && (await mic.enable())) { tone('on'); setStatus(); } }
function runCommand(c) {
  if (c === 'toggle-mic') toggleMic();
  if (c === 'stop-speech') stopAll();
}

// ---------- wiring ----------
els.form.addEventListener('submit', (e) => {
  e.preventDefault();
  const t = els.input.value;
  els.input.value = '';
  submit(t, 'typed');
});
els.mic.addEventListener('click', toggleMic);
els.stop.addEventListener('click', stopAll);
els.plus.addEventListener('click', () => applyFont(state.fsIndex + 1));
els.minus.addEventListener('click', () => applyFont(state.fsIndex - 1));
document.querySelectorAll('.chip').forEach((c) => c.addEventListener('click', () => submit(c.dataset.say, 'typed')));
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') stopAll();
  if (e.altKey && (e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey) {
    e.preventDefault();
    toggleMic();
  }
});
chrome.tabs.onActivated.addListener(refreshSite);
chrome.tabs.onUpdated.addListener((id, ch, tab) => { if (tab.active && (ch.status === 'complete' || ch.title)) refreshSite(); });
chrome.windows?.onFocusChanged?.addListener(() => { refreshSite(); });

// ---------- startup ----------
(async function init() {
  const local = await chrome.storage.local.get(['ww_fs', 'ww_rate']);
  applyFont(typeof local.ww_fs === 'number' ? local.ww_fs : CONFIG.DEFAULT_FONT_INDEX);
  if (local.ww_rate) speaker.rate = local.ww_rate;

  const sess = await chrome.storage.session.get(['ww_messages', 'ww_pending_command']);
  const welcome = 'Welcome to WebWhisper! I\u2019m your voice-first web companion. You can press Alt + J on your keyboard anytime to unmute or mute your microphone, or use the mic button below. Ask me anything about this page, or tell me what to click or fill in.';

  if (Array.isArray(sess.ww_messages) && sess.ww_messages.length && sess.ww_messages.some((m) => m.role === 'user')) {
    state.messages = sess.ww_messages;
    state.messages.forEach(render);
  } else {
    state.messages = [];
    addMessage({ role: 'assistant', text: welcome });
    speaker.speak(welcome);
  }
  setStatus();
  refreshSite();

  if (sess.ww_pending_command) {
    await chrome.storage.session.remove('ww_pending_command');
    runCommand(sess.ww_pending_command);
  }

  try {
    const res = await fetch(CONFIG.SERVER_URL + '/api/health', { headers: CONFIG.TOKEN ? { 'X-WW-Token': CONFIG.TOKEN } : {} });
    const h = await res.json();
    if (!h.tinyfish) banner('The server is running, but TINYFISH_API_KEY is missing in server/.env.');
    else if (!h.gemini) banner('Gemini isn\u2019t configured, so I\u2019ll use TinyFish alone. It works for web tasks, but not for acting on your own tab.');
  } catch {
    banner('I can\u2019t reach the WebWhisper server at ' + CONFIG.SERVER_URL + '. Start it with: cd server && npm start');
  }
  if (!mic.supported) banner('This browser has no speech recognition. Use Chrome, or type your requests.');
})();
