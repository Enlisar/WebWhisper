// Edit these if you move the backend or want a different accent.
export const CONFIG = {
  SERVER_URL: 'http://localhost:8787',
  TOKEN: '',                 // must equal WW_TOKEN in server/.env if you set one
  MIC_LANG: 'en-IN',         // speech recognition language (English only for now)
  DEFAULT_SPEECH_RATE: 1.0,
  MAX_STEPS: 6,              // max plan -> act -> look-again cycles per request
  FONT_SIZES: [14, 16, 18, 20, 22, 24, 28, 32],
  DEFAULT_FONT_INDEX: 2,
};
