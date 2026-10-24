// Speech output. Uses the best installed voice (free, instant, works offline for local voices),
// speaks sentence by sentence so the first words start immediately and Chrome's
// "long utterance cuts out" bug never triggers.
import { CONFIG } from '../config.js';

const synth = window.speechSynthesis;

export function prepareForSpeech(text) {
  return String(text || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[*_`#>~|]+/g, ' ')
    .replace(/https?:\/\/(?:www\.)?([^\s/]+)[^\s]*/gi, (m, host) => host.replace(/\./g, ' dot '))
    .replace(/\be\.g\./gi, 'for example')
    .replace(/\bi\.e\./gi, 'that is')
    .replace(/\s[\u2013\u2014-]\s/g, ', ')
    .replace(/\u2022/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

export function splitSentences(text) {
  const parts = text.match(/[^.!?\u2026]+[.!?\u2026]+["')\]]*|[^.!?\u2026]+$/g) || [text];
  const out = [];
  for (let p of parts.map((x) => x.trim()).filter(Boolean)) {
    while (p.length > 200) { // very long sentence: break at a comma/semicolon
      let cut = Math.max(p.lastIndexOf(',', 200), p.lastIndexOf(';', 200), p.lastIndexOf(' ', 200));
      if (cut < 60) cut = 200;
      out.push(p.slice(0, cut + 1).trim());
      p = p.slice(cut + 1).trim();
    }
    if (p) out.push(p);
  }
  // merge tiny fragments into the next sentence so speech doesn't stutter
  const merged = [];
  for (const s of out) {
    if (merged.length && merged[merged.length - 1].length < 18) merged[merged.length - 1] += ' ' + s;
    else merged.push(s);
  }
  return merged;
}

function scoreVoice(v) {
  const n = v.name.toLowerCase();
  if (!/^en([-_]|$)/i.test(v.lang)) return -1000;
  let s = 0;
  if (/natural|neural/.test(n)) s += 60;
  if (/premium|enhanced/.test(n)) s += 45;
  if (/online/.test(n)) s += 30;
  if (/google/.test(n)) s += 28;
  if (/samantha|ava|aria|jenny|zoe|serena|daniel|libby|sonia|ryan/.test(n)) s += 15;
  if (/espeak|compact/.test(n)) s -= 40;
  if (v.lang.replace('_', '-').toLowerCase() === CONFIG.MIC_LANG.toLowerCase()) s += 8;
  else if (/^en-(us|gb|in)/i.test(v.lang)) s += 4;
  return s;
}

export class Speaker {
  constructor({ onStart = () => {}, onEnd = () => {} } = {}) {
    this.onStart = onStart;
    this.onEnd = onEnd;
    this.rate = CONFIG.DEFAULT_SPEECH_RATE;
    this.queue = [];
    this.active = false;
    this.token = 0;
    this.voice = null;
    const pick = () => {
      const vs = synth.getVoices();
      if (vs.length) this.voice = [...vs].sort((a, b) => scoreVoice(b) - scoreVoice(a))[0];
    };
    pick();
    synth.addEventListener?.('voiceschanged', pick);
  }

  get speaking() { return this.active; }

  speak(text, { interrupt = false } = {}) {
    const clean = prepareForSpeech(text);
    if (!clean) return;
    if (interrupt) this._cancel();
    this.queue.push(...splitSentences(clean));
    if (!this.active) {
      this.active = true;
      this.onStart();
      this._next();
    } else if (interrupt) {
      setTimeout(() => this._next(), 40);
    }
  }

  _next() {
    const tok = this.token;
    const s = this.queue.shift();
    if (!s) { this.active = false; this.onEnd(); return; }
    const u = new SpeechSynthesisUtterance(s);
    if (this.voice) { u.voice = this.voice; u.lang = this.voice.lang; }
    u.rate = this.rate;
    u.pitch = /\?\s*$/.test(s) ? 1.07 : 1;
    u.onend = () => { if (tok === this.token) this._next(); };
    u.onerror = (e) => { if (tok === this.token && e.error !== 'interrupted' && e.error !== 'canceled') this._next(); };
    synth.speak(u);
  }

  _cancel() { this.token++; this.queue = []; synth.cancel(); }

  stop() {
    const was = this.active;
    this._cancel();
    if (was) { this.active = false; this.onEnd(); }
  }
}
