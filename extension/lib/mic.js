// Microphone input using Chrome's built-in speech recognition. Toggle on = continuous listening.
export class Mic {
  constructor({ lang = 'en-US', onInterim, onFinal, onState, onError, onNeedPermission }) {
    Object.assign(this, { lang, onInterim, onFinal, onState, onError, onNeedPermission });
    this.want = false;
    this.running = false;
    this.rec = null;
    this.failures = 0;
  }

  get supported() { return 'webkitSpeechRecognition' in window || 'SpeechRecognition' in window; }
  get on() { return this.want; }

  async permissionState() {
    try { return (await navigator.permissions.query({ name: 'microphone' })).state; } catch { return 'prompt'; }
  }

  // True if the microphone can be used from this page right now.
  async ensurePermission() {
    if ((await this.permissionState()) === 'granted') return true;
    try {
      const stream = await Promise.race([
        navigator.mediaDevices.getUserMedia({ audio: true }),
        new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 4000)),
      ]);
      stream.getTracks().forEach((t) => t.stop());
      return true;
    } catch {
      return false; // side panels often can't show the prompt; caller opens the permission tab
    }
  }

  async enable() {
    if (!this.supported) { this.onError('This browser does not support speech recognition. Use Chrome, or type your requests.'); return false; }
    if (!(await this.ensurePermission())) { this.onNeedPermission(); return false; }
    this.want = true;
    this.failures = 0;
    this.onState(true);
    this._start();
    return true;
  }

  disable() {
    this.want = false;
    this.onState(false);
    try { this.rec?.stop(); } catch {}
    this.onInterim('');
  }

  _start() {
    if (this.running || !this.want) return;
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    const rec = new SR();
    rec.lang = this.lang;
    rec.continuous = true;
    rec.interimResults = true;
    rec.maxAlternatives = 1;
    rec.onstart = () => { this.running = true; };
    rec.onresult = (e) => {
      this.failures = 0;
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) { const t = r[0].transcript.trim(); if (t) this.onFinal(t); }
        else interim += r[0].transcript;
      }
      this.onInterim(interim);
    };
    rec.onerror = (e) => {
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        this.want = false; this.onState(false); this.onNeedPermission();
      } else if (e.error === 'audio-capture') {
        this.want = false; this.onState(false); this.onError('I can\u2019t find a microphone. Check that one is plugged in and selected in Chrome.');
      } else if (e.error === 'network') {
        this.failures++;
        if (this.failures === 1) this.onError('Speech recognition needs an internet connection. I\u2019ll keep trying.');
      }
      // 'no-speech' and 'aborted' are normal
    };
    rec.onend = () => {
      this.running = false;
      this.onInterim('');
      if (this.want) setTimeout(() => this._start(), Math.min(400 * (this.failures + 1), 4000));
    };
    this.rec = rec;
    try { rec.start(); } catch { /* already started */ }
  }
}
