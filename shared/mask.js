
const TYPING_INTENT = /\b(type|enter|write|input|fill|password|passcode|username|user name|e-?mail|pin|otp|cvv)\b/i;
const SECRET_WORDS = /\b(password|passcode|pass code|pin|otp|cvv|cvc|secret|security code|card number)\b/i;
const FIELDISH = /\b(field|box|input|bar|area|username|user\s?name|user\s?field|password|e-?mail|search|text|id|phone|number|address|code|pin|otp|message|comment|name|city)\b/i;
const GENERIC = /^(the |a |an |my )?(form|forms|fields?|boxes|details|information|info|page|text|search\s?box)$/i;

export function maskUtterance(text, startIndex = 1) {
  const values = {};
  let n = startIndex - 1;
  const put = (v) => {
    const k = `V${++n}`;
    values[k] = v;
    return `{{${k}}}`;
  };
  let out = text;

  if (TYPING_INTENT.test(text)) {
    out = out.replace(/"([^"]{1,200})"/g, (m, v) => put(v));
    out = out.replace(/\u201c([^\u201d]{1,200})\u201d/g, (m, v) => put(v));
    out = out.replace(/(^|\s)'([^']{1,200})'(?=\s|[.,;!?]|$)/g, (m, pre, v) => pre + put(v));
  }
  
  out = out.replace(/(?<![A-Za-z0-9{])(?:[A-Za-z0-9](?:\s*-\s*|\s+)){3,}[A-Za-z0-9](?![A-Za-z0-9}])/g, (m) => put(m.replace(/[\s-]+/g, '')));
  
  out = out.replace(/\b(password|passcode|pin|otp|cvv|cvc)\s+(?:is|was|:)\s+(?!\{\{)(\S+)/gi, (m, w, v) => `${w} is ${put(v)}`);

  out = out.replace(
    /\b(type|enter|write|input|fill(?:\s+in)?)\s+(?!\{\{)(.+?)\s+(in|into|on|inside)\s+((?:the\s+|my\s+)?[^,.;]+?)(?=\s+(?:and|then)\s+|[,.;]|$)/gi,
    (m, verb, val, prep, field) => {
      if (GENERIC.test(val.trim()) || !FIELDISH.test(field)) return m;
      return `${verb} ${put(val.trim())} ${prep} ${field}`;
    }
  );

  const secretContext = SECRET_WORDS.test(text);
  const display = out.replace(/\{\{(V\d+)\}\}/g, (m, k) => (secretContext ? '\u2022\u2022\u2022\u2022\u2022\u2022' : values[k]));
  return { masked: out, values, secretContext, display, nextIndex: n + 1 };
}


export function resolveValues(text, values) {
  let missing = false;
  const out = String(text ?? '').replace(/\{\{(V\d+)\}\}/g, (m, k) => {
    if (!(k in values)) missing = true;
    return values[k] ?? '';
  });
  return missing ? null : out;
}


export function stripTokens(text) {
  return String(text ?? '').replace(/\{\{V\d+\}\}/g, 'your entry');
}
