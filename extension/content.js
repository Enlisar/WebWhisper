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
    if (!l && (el.tagName === 'A' || el.tagName === 'BUTTON' || el.getAttribute('role') === 'button')) {
      const figCap = el.closest('figure')?.querySelector('figcaption')?.textContent || el.closest('.thumb, .thumbinner')?.querySelector('.thumbcaption')?.textContent;
      if (figCap) l = clean(figCap, 100);
      if (!l && el.hasAttribute('href')) {
        const h = el.getAttribute('href') || '';
        const m = h.match(/File:([^/?#]+)/i) || h.match(/\/wiki\/([^/?#]+)/i);
        if (m) {
          const rawName = decodeURIComponent(m[1]).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
          l = clean(rawName, 100);
        }
      }
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

  function inferButtonAction(el, label, info) {
    if (info.disabled) return 'It is currently disabled.';
    if (info.isSummary) return info.expanded ? 'Accordion section is open. Click to collapse.' : 'Accordion section is closed. Click to expand.';
    if (info.expanded !== null && info.expanded !== undefined) return info.expanded ? 'Currently expanded. Click to collapse.' : 'Currently collapsed. Click to expand.';
    if (info.pressed !== null && info.pressed !== undefined) return info.pressed ? 'Toggle button, currently turned on. Click to turn off.' : 'Toggle button, currently turned off. Click to turn on.';
    if (info.hasPopup === 'menu') return 'Opens a dropdown menu.';
    if (info.hasPopup === 'dialog' || info.hasPopup === 'true') return 'Opens a dialog window.';
    if (info.hasPopup === 'listbox') return 'Opens a list of options.';
    if (info.buttonType === 'submit') return info.formInfo ? `Submits the ${info.formInfo} form.` : 'Submits the form.';
    if (info.buttonType === 'reset') return 'Resets all form fields.';

    const desc = clean(el.getAttribute('aria-description') || el.getAttribute('title') || '', 120);
    if (desc) return desc;

    const l = (label || '').toLowerCase();
    if (/\b(search|find)\b/i.test(l)) return 'Searches the website.';
    if (/\b(add to cart|add to bag|buy now)\b/i.test(l)) return 'Adds this item to your cart.';
    if (/\b(checkout|place order)\b/i.test(l)) return 'Proceeds to checkout.';
    if (/\b(close|dismiss|cancel)\b/i.test(l)) return 'Closes this view or dialog.';
    if (/\b(menu|navigation|hamburger)\b/i.test(l)) return 'Opens navigation menu.';
    if (/\b(play)\b/i.test(l)) return 'Starts playback.';
    if (/\b(pause)\b/i.test(l)) return 'Pauses playback.';
    if (/\b(next)\b/i.test(l)) return 'Navigates to the next page or item.';
    if (/\b(prev|previous|back)\b/i.test(l)) return 'Navigates to the previous page or item.';
    if (/\b(sign in|log in)\b/i.test(l)) return 'Signs into your account.';
    if (/\b(sign out|log out)\b/i.test(l)) return 'Signs out of your account.';
    if (/\b(sign up|register|create account)\b/i.test(l)) return 'Creates a new account.';
    if (/\b(delete|remove)\b/i.test(l)) return 'Deletes this item.';
    if (/\b(copy)\b/i.test(l)) return 'Copies content to clipboard.';
    if (/\b(download)\b/i.test(l)) return 'Downloads the file.';
    if (/\b(share)\b/i.test(l)) return 'Opens sharing options.';
    if (/\b(filter|sort)\b/i.test(l)) return 'Filters or sorts items.';
    if (/\b(save|update)\b/i.test(l)) return 'Saves your changes.';
    if (/\b(refresh|reload)\b/i.test(l)) return 'Refreshes the content.';
    return 'Click to activate.';
  }

  function inspectLink(a) {
    const rawHref = a.getAttribute('href') || '';
    const res = { destType: 'unknown' };
    res.targetBlank = a.target === '_blank' || a.getAttribute('target') === '_blank';
    res.description = clean(a.getAttribute('aria-description') || a.getAttribute('title') || '', 120);

    const figCaption = a.closest('figure')?.querySelector('figcaption')?.textContent ||
      a.closest('.thumb, .thumbinner')?.querySelector('.thumbcaption')?.textContent ||
      a.closest('p, li')?.textContent;
    if (figCaption) res.context = clean(figCaption, 160);

    if (!rawHref || rawHref === '#' || rawHref.startsWith('javascript:')) {
      res.destType = 'action';
      return res;
    }
    if (rawHref.startsWith('#')) {
      res.destType = 'anchor';
      const targetId = rawHref.slice(1);
      const targetEl = targetId ? document.getElementById(targetId) : null;
      res.anchorName = targetEl ? (labelOf(targetEl) || clean(targetEl.textContent, 40)) : targetId;
      return res;
    }
    if (rawHref.startsWith('mailto:')) {
      res.destType = 'email';
      res.email = rawHref.replace(/^mailto:/i, '').split('?')[0];
      return res;
    }
    if (rawHref.startsWith('tel:')) {
      res.destType = 'phone';
      res.phone = rawHref.replace(/^tel:/i, '');
      return res;
    }
    if (a.hasAttribute('download') || /\.(pdf|zip|tar|gz|csv|xlsx?|docx?|mp3|mp4|exe|apk)$/i.test(a.pathname || '')) {
      res.destType = 'download';
      res.fileName = a.getAttribute('download') || (a.pathname ? a.pathname.split('/').pop() : 'file');
      return res;
    }
    try {
      const u = new URL(a.href, location.href);
      const isSameHost = u.hostname === location.hostname;
      res.destType = isSameHost ? 'internal' : 'external';
      res.hostname = u.hostname.replace(/^www\./, '');
      res.pathname = u.pathname !== '/' ? u.pathname : '';
      res.href = res.hostname + (res.pathname ? res.pathname : '');

      // Human-readable destination (avoid saying "slash wiki slash File:...")
      const fileMatch = res.pathname.match(/File:([^/?#]+)/i);
      if (fileMatch) {
        const name = decodeURIComponent(fileMatch[1]).replace(/\.[a-z0-9]+$/i, '').replace(/[_-]+/g, ' ').trim();
        res.humanDest = `the ${name} image file`;
        res.isImageLink = true;
      } else if (res.pathname.startsWith('/wiki/')) {
        const article = decodeURIComponent(res.pathname.replace(/^\/wiki\//, '')).replace(/[_-]+/g, ' ').trim();
        res.humanDest = `the ${article} Wikipedia article`;
      }
    } catch {
      res.destType = 'action';
    }
    return res;
  }

  function describe(el) {
    const inter = el.closest(INTERACTIVE);
    if (inter && inter !== document.body) {
      const kind = kindOf(inter);
      const label = labelOf(inter) || '';
      const info = { kind: kind === 'other' ? 'button' : kind, label };
      const sec = inter.closest(LANDMARKS);
      if (sec) info.inSection = sectionLabel(sec);

      if (kind === 'button' || info.kind === 'button') {
        info.kind = 'button';
        info.disabled = !!(inter.disabled || inter.getAttribute('aria-disabled') === 'true');
        info.buttonType = (inter.getAttribute('type') || inter.type || '').toLowerCase();
        info.hasPopup = inter.getAttribute('aria-haspopup');
        info.expanded = inter.hasAttribute('aria-expanded') ? inter.getAttribute('aria-expanded') === 'true' : null;
        info.pressed = inter.hasAttribute('aria-pressed') ? inter.getAttribute('aria-pressed') === 'true' : null;
        info.isSummary = inter.tagName === 'SUMMARY';
        info.description = clean(inter.getAttribute('aria-description') || inter.getAttribute('title') || '', 120);
        const form = inter.form || inter.closest('form');
        if (form) info.formInfo = labelOf(form) || form.getAttribute('name') || form.getAttribute('id') || '';
        info.actionText = inferButtonAction(inter, label, info);
      } else if (kind === 'link') {
        const a = inter.closest('a[href]') || inter;
        const linkData = inspectLink(a);
        Object.assign(info, linkData);
      } else if (['input', 'select', 'checkbox', 'radio', 'file'].includes(kind)) {
        info.kind = 'input';
        info.fieldType = (inter.type || inter.tagName).toLowerCase();
        if (inter.isContentEditable) info.fieldType = 'contenteditable';
        else if (inter.tagName === 'TEXTAREA') info.fieldType = 'textarea';

        info.required = !!(inter.required || inter.getAttribute('aria-required') === 'true');
        info.disabled = !!(inter.disabled || inter.getAttribute('aria-disabled') === 'true');
        info.readonly = !!(inter.readOnly || inter.getAttribute('aria-readonly') === 'true');
        info.placeholder = clean(inter.placeholder || '', 80);
        info.description = clean(inter.getAttribute('aria-description') || inter.getAttribute('title') || '', 120);

        if (info.fieldType === 'search' || inter.getAttribute('role') === 'searchbox' || /\bsearch\b/i.test(label || info.placeholder || inter.name || inter.id)) {
          info.isSearch = true;
        }

        if (isSensitiveInput(inter)) {
          info.sensitive = true;
          info.filled = !!inter.value;
        } else if (kind === 'checkbox' || kind === 'radio') {
          info.checked = !!inter.checked;
        } else if (kind === 'select') {
          info.selectedText = clean(inter.options?.[inter.selectedIndex]?.text || inter.value || '', 60);
          info.optionsCount = inter.options?.length || 0;
        } else if (inter.isContentEditable) {
          const val = clean(inter.innerText || inter.textContent || '', 300);
          info.value = val;
          info.filled = val.length > 0;
        } else {
          const val = clean(inter.value || '', 300);
          info.value = val;
          info.filled = val.length > 0;
        }

        if (info.isSearch) info.actionText = 'Type keywords to search.';
        else if (info.fieldType === 'email') info.actionText = 'Enter your email address.';
        else if (info.fieldType === 'password') info.actionText = 'Enter your password.';
        else if (info.fieldType === 'textarea') info.actionText = 'Multi-line text box to enter details.';
      }

      return { info, node: inter };
    }

    const heading = el.closest('h1,h2,h3,h4,h5,h6,[role=heading]');
    if (heading && heading !== document.body) {
      const level = Number(heading.tagName[1]) || Number(heading.getAttribute('aria-level')) || 2;
      return {
        info: {
          kind: 'heading',
          level,
          text: clean(heading.innerText || heading.textContent || '', 200),
        },
        node: heading,
      };
    }

    if (el.tagName === 'IMG' || el.closest('img')) {
      const img = el.tagName === 'IMG' ? el : el.closest('img');
      const r = img.getBoundingClientRect();
      return {
        info: {
          kind: 'image',
          alt: clean(img.alt || img.title || '', 120),
          caption: clean(img.closest('figure')?.querySelector('figcaption')?.textContent || '', 120),
          width: Math.round(r.width),
          height: Math.round(r.height),
        },
        node: img,
      };
    }

    const textBlock = el.closest('p,li,blockquote,pre,code,td,th,figcaption,caption,dd,dt');
    if (textBlock && textBlock !== document.body) {
      const text = clean(textBlock.innerText || textBlock.textContent || '', 500);
      if (text) {
        return {
          info: {
            kind: 'text',
            tag: textBlock.tagName.toLowerCase(),
            text,
          },
          node: textBlock,
        };
      }
    }

    const directText = clean(el.innerText || el.textContent || '', 300);
    if (directText && directText.length < 300 && el !== document.body && el !== document.documentElement) {
      return {
        info: {
          kind: 'text',
          tag: el.tagName.toLowerCase(),
          text: directText,
        },
        node: el,
      };
    }

    // text / section fallback
    let block = el;
    while (block && block !== document.body && block !== document.documentElement && clean(block.innerText || '').length < 25) block = block.parentElement;
    if (!block || block === document.documentElement) block = document.body;
    const sec = block.closest(LANDMARKS) || block;
    const root = block.querySelectorAll('button,a[href],input,select,textarea').length >= sec.querySelectorAll('button,a[href],input,select,textarea').length ? block : sec;
    const hd = (block.matches('h1,h2,h3,h4,h5,h6') ? block : block.querySelector('h1,h2,h3,h4,h5,h6') || sec.querySelector('h1,h2,h3,h4,h5,h6'));
    const info = {
      kind: 'section',
      title: clean(hd?.textContent || sectionLabel(sec) || '', 80),
      text: clean(block.innerText || '', 600),
      buttons: listFrom(root, 'button,[role=button],input[type=submit],input[type=button]', labelOf, 10),
      links: listFrom(root, 'a[href]', labelOf, 10),
      inputs: listFrom(root, 'input:not([type=hidden]),select,textarea', (i) => (labelOf(i) || i.type || 'field') + (isSensitiveInput(i) ? ' (password)' : ''), 10),
      images: root.querySelectorAll('img').length,
    };
    if (block === document.body) info.title = info.title || clean(document.title, 80);
    return { info, node: block === document.body ? el : block };
  }

  // ---------- Ctrl + hover describes whatever is under the mouse pointer ----------
  let lastEl = null, ctrlDown = false, otherKey = false;
  let hoverTimer = null, lastDescribedNode = null;

  function triggerHover(targetEl) {
    if (!targetEl || !(targetEl instanceof Element)) return;
    try {
      const { info, node } = describe(targetEl);
      if (!node || node === lastDescribedNode) return;
      if (node === document.body && !info.text && !info.label) return;
      lastDescribedNode = node;
      highlight(node, 2200);
      chrome.runtime.sendMessage({ ww: true, type: 'ctrl', info }).catch(() => {});
    } catch { /* page may be mid-navigation */ }
  }

  addEventListener('mousemove', (e) => {
    lastEl = e.composedPath ? e.composedPath()[0] : e.target;
    if (e.ctrlKey && !otherKey) {
      clearTimeout(hoverTimer);
      hoverTimer = setTimeout(() => triggerHover(lastEl), 60);
    }
  }, { passive: true, capture: true });

  addEventListener('keydown', (e) => {
    if (e.altKey && (e.key === 'j' || e.key === 'J') && !e.ctrlKey && !e.metaKey) {
      chrome.runtime.sendMessage({ ww: true, type: 'command', command: 'toggle-mic' }).catch(() => {});
      return;
    }
    if (e.key === 'Control') {
      if (!e.repeat) {
        ctrlDown = true;
        otherKey = false;
        clearTimeout(hoverTimer);
        hoverTimer = setTimeout(() => {
          if (ctrlDown && !otherKey && lastEl) triggerHover(lastEl);
        }, 70);
      }
    } else if (ctrlDown) {
      otherKey = true;
      clearTimeout(hoverTimer);
    }
  }, true);

  addEventListener('mousedown', () => {
    clearTimeout(hoverTimer);
    if (ctrlDown) otherKey = true;
  }, true);

  addEventListener('blur', () => {
    ctrlDown = false;
    lastDescribedNode = null;
    clearTimeout(hoverTimer);
  });

  addEventListener('keyup', (e) => {
    if (e.key === 'Control') {
      ctrlDown = false;
      otherKey = false;
      lastDescribedNode = null;
      clearTimeout(hoverTimer);
    }
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
