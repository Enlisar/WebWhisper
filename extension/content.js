// WebWhisper content script. Runs in every page.
// - snapshot(): a compact, redacted description of the page (never includes typed values)
// - exec(): performs one action the user asked for (click, type, select, scroll, ...)
// - Ctrl (pressed alone) describes whatever is under the mouse pointer.
(() => {
  if (window.__webwhisper) return;
  window.__webwhisper = true;

  const IS_TOP = window === window.top;
  const idMap = new Map();
  let seq = 0;

  // ---------- small helpers ----------
  const clean = (s, n = 0) => {
    const t = String(s ?? '').replace(/\s+/g, ' ').trim();
    return n && t.length > n ? t.slice(0, n - 1).trimEnd() + '\u2026' : t;
  };
  const stripUrl = (u) => {
    try { const x = new URL(u, location.href); return x.origin + x.pathname; } catch { return ''; }
  };
  const isVisible = (el) => {
    if (!el || !el.getClientRects || !el.getClientRects().length) return false;
    const s = getComputedStyle(el);
    return s.visibility !== 'hidden' && s.display !== 'none';
  };
  const inView = (el) => {
    const r = el.getBoundingClientRect();
    return r.bottom > 0 && r.right > 0 && r.top < innerHeight && r.left < innerWidth;
  };
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function deepQueryAll(selector, root = document, out = [], budget = { n: 0 }) {
    out.push(...root.querySelectorAll(selector));
    if (budget.n > 25000) return out;
    for (const el of root.querySelectorAll('*')) {
      budget.n++;
      if (el.shadowRoot) deepQueryAll(selector, el.shadowRoot, out, budget);
    }
    return out;
  }

  const INTERACTIVE =
    'a[href],button,input:not([type=hidden]),select,textarea,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=radio],[role=switch],[role=option],[contenteditable=""],[contenteditable=true],[onclick]';
  const LANDMARKS =
    'section,article,main,header,footer,nav,aside,form,dialog,[role=region],[role=banner],[role=navigation],[role=contentinfo],[role=main],[role=complementary],[role=search]';

  const isSensitiveInput = (el) => {
    if (el.tagName !== 'INPUT') return false;
    const t = (el.type || '').toLowerCase();
    const ac = (el.getAttribute('autocomplete') || '').toLowerCase();
    return t === 'password' || /(^|\s)(cc-|one-time-code|current-password|new-password)/.test(ac);
  };

  function labelOf(el) {
    const g = (a) => clean(el.getAttribute?.(a) || '', 100);
    let l = g('aria-label');
    if (!l) {
      const by = el.getAttribute?.('aria-labelledby');
      if (by) l = clean(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent || '').join(' '), 100);
    }
    if (!l && el.labels && el.labels.length) l = clean([...el.labels].map((x) => x.textContent).join(' '), 100);
    if (!l && el.tagName === 'INPUT' && ['submit', 'button', 'reset'].includes((el.type || '').toLowerCase())) l = clean(el.value, 100);
    if (!l && el.tagName !== 'INPUT' && el.tagName !== 'SELECT' && el.tagName !== 'TEXTAREA') l = clean(el.innerText || el.textContent || '', 100);
    if (!l && el.querySelector) {
      const img = el.querySelector('img[alt]');
      if (img && img.alt) l = clean(img.alt, 100);
      if (!l) { const t = el.querySelector('svg title'); if (t) l = clean(t.textContent, 100); }
    }
    return l || g('title') || g('alt') || g('placeholder') || g('name');
  }

  function kindOf(el) {
    const tag = el.tagName;
    const role = (el.getAttribute('role') || '').toLowerCase();
    if (tag === 'IMG') return 'image';
    if (tag === 'A' || role === 'link') return 'link';
    if (tag === 'SELECT') return 'select';
    if (tag === 'TEXTAREA' || el.isContentEditable) return 'input';
    if (tag === 'INPUT') {
      const t = (el.type || 'text').toLowerCase();
      if (t === 'checkbox') return 'checkbox';
      if (t === 'radio') return 'radio';
      if (['submit', 'button', 'reset', 'image'].includes(t)) return 'button';
      if (t === 'file') return 'file';
      return 'input';
    }
    if (tag === 'BUTTON' || tag === 'SUMMARY' || role === 'button') return 'button';
    if (role === 'checkbox' || role === 'switch') return 'checkbox';
    if (role === 'radio') return 'radio';
    if (role === 'tab') return 'tab';
    if (role === 'menuitem' || role === 'option') return 'menuitem';
    return 'other';
  }

  const sectionLabelCache = new Map();
  function sectionLabel(sec) {
    if (sectionLabelCache.has(sec)) return sectionLabelCache.get(sec);
    let l = clean(sec.getAttribute('aria-label') || '', 60);
    if (!l) {
      const by = sec.getAttribute('aria-labelledby');
      if (by) l = clean(document.getElementById(by)?.textContent || '', 60);
    }
    const role = (sec.getAttribute('role') || sec.tagName).toLowerCase();
    const generic = ['main', 'header', 'banner', 'footer', 'contentinfo', 'nav', 'navigation', 'aside', 'complementary'].includes(role);
    if (!l && !generic) { const h = sec.querySelector('h1,h2,h3,h4,[role=heading]'); if (h) l = clean(h.textContent, 60); }
    if (!l) {
      l = { header: 'header', banner: 'header', nav: 'navigation', navigation: 'navigation', footer: 'footer', contentinfo: 'footer', aside: 'sidebar', complementary: 'sidebar', main: 'main content', form: 'form', search: 'search' }[role] || '';
    }
    sectionLabelCache.set(sec, l);
    return l;
  }

  // ---------- snapshot ----------
  function snapshot() {
    idMap.clear();
    sectionLabelCache.clear();
    seq = 0;
    const sensitive = !!document.querySelector('input[type=password],input[autocomplete^="cc-"],input[autocomplete="one-time-code"]');

    // headings
    const headings = deepQueryAll('h1,h2,h3,[role=heading]').filter(isVisible).slice(0, 60).map((h) => ({
      level: Number(h.tagName[1]) || Number(h.getAttribute('aria-level')) || 2,
      text: clean(h.textContent, 90),
    })).filter((h) => h.text);

    // sections (landmarks); fall back to headings on div-soup pages
    const secEls = deepQueryAll(LANDMARKS).filter((s) => !s.matches('main,[role=main]') && isVisible(s) && clean(s.innerText || '').length > 0);
    const sections = secEls.slice(0, 40).map((s) => ({
      label: sectionLabel(s),
      kind: (s.getAttribute('role') || s.tagName).toLowerCase(),
      summary: sensitive ? '' : clean(s.innerText, 160),
      buttons: s.querySelectorAll('button,[role=button],input[type=submit],input[type=button]').length,
      links: s.querySelectorAll('a[href]').length,
      inputs: s.querySelectorAll('input:not([type=hidden]),select,textarea').length,
    }));

    // interactive elements + images
    const raw = deepQueryAll(INTERACTIVE).filter(isVisible);
    const seen = new Set();
    const elements = [];
    const add = (el, kind, label) => {
      if (seen.has(el) || elements.length >= 200) return;
      seen.add(el);
      const id = 'e' + ++seq;
      idMap.set(id, el);
      const entry = { id, kind, label: label || '', inView: inView(el) };
      const sec = el.closest(LANDMARKS);
      if (sec) { const sl = sectionLabel(sec); if (sl) entry.section = sl; }
      if (kind === 'input' || kind === 'select' || kind === 'checkbox' || kind === 'radio' || kind === 'file') {
        entry.type = (el.type || el.tagName).toLowerCase();
        if (el.required || el.getAttribute('aria-required') === 'true') entry.required = true;
        if (el.placeholder) entry.placeholder = clean(el.placeholder, 60);
        if (isSensitiveInput(el)) entry.sensitive = true;
        // Only whether it is filled, never what it contains.
        entry.filled = kind === 'checkbox' || kind === 'radio' ? !!el.checked : !!(el.value && String(el.value).length);
        if (kind === 'select') entry.options = [...el.options].slice(0, 12).map((o) => clean(o.text, 40));
      }
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') entry.disabled = true;
      const a = el.closest('a[href]');
      if (kind === 'link' && a) entry.href = stripUrl(a.href);
      elements.push(entry);
    };
    for (const el of raw) {
      const kind = kindOf(el);
      if (kind === 'other' && !labelOf(el)) continue;
      add(el, kind, labelOf(el));
    }
    for (const img of deepQueryAll('img').filter(isVisible)) {
      const r = img.getBoundingClientRect();
      if (r.width < 48 || r.height < 48) continue;
      if (img.closest('a[href],button,[role=button],[role=link]')) continue; // already listed through its link/button
      add(img, 'image', clean(img.alt || img.title || img.closest('figure')?.querySelector('figcaption')?.textContent || '', 100) || '(no description)');
    }

    const counts = {
      sections: sections.length || headings.filter((h) => h.level <= 3).length,
      headings: headings.length,
      buttons: elements.filter((e) => e.kind === 'button').length,
      links: elements.filter((e) => e.kind === 'link').length,
      inputs: elements.filter((e) => ['input', 'select', 'checkbox', 'radio', 'file'].includes(e.kind)).length,
      images: deepQueryAll('img').filter((i) => isVisible(i) && i.getBoundingClientRect().width >= 48).length,
    };
    const main = document.querySelector('main') || document.body;
    return {
      url: stripUrl(location.href),
      title: clean(document.title, 120),
      lang: document.documentElement.lang || '',
      sensitive,
      counts,
      headings,
      sections,
      elements,
      text: sensitive ? '' : clean(main.innerText || '', 4000),
    };
  }

  // ---------- visual highlight (low-vision friendly, doesn't touch the page's own styles) ----------
  let hl, hlTimer;
  function highlight(el, ms = 1600) {
    try {
      if (!hl) {
        hl = document.createElement('div');
        hl.setAttribute('aria-hidden', 'true');
        hl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483647;border:3px solid #59D7BC;border-radius:4px;box-shadow:0 0 0 2px #080909;transition:all .12s ease;display:none';
        document.documentElement.appendChild(hl);
      }
      const r = el.getBoundingClientRect();
      Object.assign(hl.style, { display: 'block', left: r.left - 3 + 'px', top: r.top - 3 + 'px', width: r.width + 'px', height: r.height + 'px' });
      clearTimeout(hlTimer);
      hlTimer = setTimeout(() => { hl.style.display = 'none'; }, ms);
    } catch { /* highlight is cosmetic */ }
  }

  // ---------- actions ----------
  function target(id) {
    const el = idMap.get(id);
    if (!el || !el.isConnected) throw new Error('That item is no longer on the page.');
    return el;
  }
  function setValue(el, text) {
    el.focus();
    if (el.isContentEditable) {
      el.textContent = text;
      el.dispatchEvent(new InputEvent('input', { bubbles: true, data: text, inputType: 'insertText' }));
      return;
    }
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
    if (setter) setter.call(el, text); else el.value = text; // native setter keeps React/Vue in sync
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
  }

  async function exec(a) {
    switch (a.type) {
      case 'click': {
        const el = target(a.id);
        const label = labelOf(el) || 'item';
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        highlight(el);
        await sleep(250);
        const link = el.closest('a[href]');
        if (link && link.target === '_blank' && /^https?:/i.test(link.href)) return { ok: true, openUrl: link.href, note: `Opened \u201c${label}\u201d in a new tab` };
        el.click();
        return { ok: true, note: `Clicked \u201c${label}\u201d` };
      }
      case 'type': {
        const el = target(a.id);
        if (kindOf(el) === 'file') return { ok: false, note: "I can't choose files for you." };
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        highlight(el);
        setValue(el, String(a.text ?? ''));
        // Never echo the typed text back.
        return { ok: true, note: `Filled in \u201c${labelOf(el) || 'field'}\u201d` };
      }
      case 'select': {
        const el = target(a.id);
        if (el.tagName !== 'SELECT') return { ok: false, note: 'That is not a drop-down list.' };
        const want = String(a.value || '').toLowerCase();
        const opt = [...el.options].find((o) => o.text.toLowerCase() === want || o.value.toLowerCase() === want) || [...el.options].find((o) => o.text.toLowerCase().includes(want));
        if (!opt) return { ok: false, note: `No option matching \u201c${a.value}\u201d.` };
        highlight(el);
        setValue(el, opt.value);
        return { ok: true, note: `Chose \u201c${clean(opt.text, 40)}\u201d` };
      }
      case 'focus': {
        const el = target(a.id);
        el.scrollIntoView({ block: 'center', behavior: 'smooth' });
        highlight(el);
        el.focus();
        return { ok: true, note: `Focused \u201c${labelOf(el) || 'item'}\u201d` };
      }
      case 'press': {
        const el = a.id ? target(a.id) : document.activeElement || document.body;
        const key = a.key || 'Enter';
        const opts = { key, code: key, bubbles: true, cancelable: true };
        el.dispatchEvent(new KeyboardEvent('keydown', opts));
        el.dispatchEvent(new KeyboardEvent('keyup', opts));
        if (key === 'Enter' && el.form && el.tagName === 'INPUT') el.form.requestSubmit ? el.form.requestSubmit() : el.form.submit();
        return { ok: true, note: `Pressed ${key}` };
      }
      case 'scroll': {
        const d = a.direction || 'down';
        const step = Math.round(innerHeight * 0.8);
        if (d === 'top') scrollTo({ top: 0, behavior: 'smooth' });
        else if (d === 'bottom') scrollTo({ top: document.documentElement.scrollHeight, behavior: 'smooth' });
        else scrollBy({ top: d === 'up' ? -step : step, behavior: 'smooth' });
        return { ok: true, note: `Scrolled ${d}` };
      }
      default:
        return { ok: false, note: 'Unknown action' };
    }
  }

  // ---------- describing what is under the pointer ----------
  function listFrom(root, sel, labelFn, max) {
    return [...root.querySelectorAll(sel)].filter(isVisible).map(labelFn).filter(Boolean).slice(0, max);
  }
  function describe(el) {
    const inter = el.closest(INTERACTIVE);
    if (inter && inter !== document.body) {
      const kind = kindOf(inter);
      const info = { kind: kind === 'other' ? 'button' : kind, label: labelOf(inter) || '' };
      const sec = inter.closest(LANDMARKS);
      if (sec) info.inSection = sectionLabel(sec);
      if (kind === 'link') { const a = inter.closest('a[href]'); if (a) { try { const u = new URL(a.href); info.href = u.hostname + (u.pathname !== '/' ? u.pathname : ''); } catch {} } }
      if (['input', 'select', 'checkbox', 'radio', 'file'].includes(kind)) {
        info.kind = 'input';
        info.fieldType = (inter.type || inter.tagName).toLowerCase();
        info.required = !!inter.required;
        info.placeholder = clean(inter.placeholder || '', 60);
        if (isSensitiveInput(inter)) { info.sensitive = true; info.filled = !!inter.value; }
        else if (kind === 'checkbox' || kind === 'radio') info.checked = !!inter.checked;
        else if (inter.value) info.value = clean(inter.value, 200);
      }
      if (inter.disabled) info.disabled = true;
      return { info, node: inter };
    }
    if (el.tagName === 'IMG') {
      const r = el.getBoundingClientRect();
      return { info: { kind: 'image', alt: clean(el.alt || el.title || '', 120), caption: clean(el.closest('figure')?.querySelector('figcaption')?.textContent || '', 120), width: Math.round(r.width), height: Math.round(r.height) }, node: el };
    }
    // text / section
    let block = el;
    while (block && block !== document.body && block !== document.documentElement && clean(block.innerText || '').length < 25) block = block.parentElement;
    if (!block || block === document.documentElement) block = document.body;
    const sec = block.closest(LANDMARKS) || block;
    const root = block.querySelectorAll('button,a[href],input,select,textarea').length >= sec.querySelectorAll('button,a[href],input,select,textarea').length ? block : sec;
    const heading = (block.matches('h1,h2,h3,h4,h5,h6') ? block : block.querySelector('h1,h2,h3,h4,h5,h6') || sec.querySelector('h1,h2,h3,h4,h5,h6'));
    const info = {
      kind: 'section',
      title: clean(heading?.textContent || sectionLabel(sec) || '', 80),
      text: clean(block.innerText || '', 600),
      buttons: listFrom(root, 'button,[role=button],input[type=submit],input[type=button]', labelOf, 10),
      links: listFrom(root, 'a[href]', labelOf, 10),
      inputs: listFrom(root, 'input:not([type=hidden]),select,textarea', (i) => (labelOf(i) || i.type || 'field') + (isSensitiveInput(i) ? ' (password)' : ''), 10),
      images: root.querySelectorAll('img').length,
    };
    if (block === document.body) info.title = info.title || clean(document.title, 80);
    return { info, node: block === document.body ? el : block };
  }

  // Ctrl pressed on its own (not as part of Ctrl+C etc.) describes what is under the mouse.
  let lastEl = null, ctrlDown = false, otherKey = false;
  addEventListener('mousemove', (e) => { lastEl = e.composedPath ? e.composedPath()[0] : e.target; }, { passive: true, capture: true });
  addEventListener('keydown', (e) => {
    if (e.key === 'Control') { if (!e.repeat) { ctrlDown = true; otherKey = false; } }
    else if (ctrlDown) otherKey = true;
  }, true);
  addEventListener('mousedown', () => { if (ctrlDown) otherKey = true; }, true);
  addEventListener('blur', () => { ctrlDown = false; });
  addEventListener('keyup', (e) => {
    if (e.key !== 'Control' || !ctrlDown) return;
    ctrlDown = false;
    if (otherKey) return;
    if (!lastEl || !(lastEl instanceof Element)) return;
    try {
      const { info, node } = describe(lastEl);
      highlight(node, 1800);
      chrome.runtime.sendMessage({ ww: true, type: 'ctrl', info }).catch(() => {});
    } catch { /* page may be mid-navigation */ }
  }, true);

  // ---------- messages from the side panel ----------
  chrome.runtime.onMessage.addListener((msg, sender, send) => {
    if (!msg || !msg.ww || sender.id !== chrome.runtime.id) return;
    if (!IS_TOP) return;
    if (msg.type === 'ping') { send({ ok: true }); return; }
    if (msg.type === 'snapshot') {
      try { send({ ok: true, snapshot: snapshot() }); } catch (e) { send({ ok: false, error: String(e.message || e) }); }
      return;
    }
    if (msg.type === 'exec') {
      exec(msg.action).then(send).catch((e) => send({ ok: false, note: String(e.message || e) }));
      return true;
    }
  });
})();
