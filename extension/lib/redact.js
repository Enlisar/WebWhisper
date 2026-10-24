

const digits = (s) => (s.match(/\d/g) || []).length;

const RULES = [
  [/\b(?:\d[ -]?){13,19}\b/g, (m) => (digits(m) >= 13 ? '[number removed]' : m)],
  [/\b\d{3}-\d{2}-\d{4}\b/g, '[id removed]'],
  [/\b\d{4}\s\d{4}\s\d{4}\b/g, '[id removed]'],
  [/\b[A-Z]{5}\d{4}[A-Z]\b/g, '[id removed]'],
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email removed]'],
  [/(?<![\w.])\+?\d[\d\s().-]{8,}\d(?!\w)/g, (m) => (digits(m) >= 10 ? '[number removed]' : m)],
];
const TOKEN = /\b(?=[A-Za-z0-9_-]*\d)(?=[A-Za-z0-9_-]*[A-Za-z])[A-Za-z0-9_-]{32,}\b/g;
const OTP = /\b(otp|one[- ]time (?:password|code)|verification code|security code|passcode|pin|cvv|cvc)\b([^0-9\n]{0,15})(\d{3,8})\b/gi;

export function redactText(input, { tokens = true } = {}) {
  if (typeof input !== 'string') return input;
  let s = input;
  for (const [re, rep] of RULES) s = s.replace(re, rep);
  if (tokens) s = s.replace(TOKEN, '[token removed]');
  return s.replace(OTP, '$1$2[removed]');
}

export function scrub(value, key = '', depth = 0) {
  if (depth > 8) return undefined;
  if (typeof value === 'string') return redactText(value, { tokens: !/^(href|url)$/i.test(key) });
  if (Array.isArray(value)) return value.map((v) => scrub(v, key, depth + 1));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = scrub(v, k, depth + 1);
    return out;
  }
  return value;
}
