# WebWhisper

A Chrome side-panel assistant for blind and low-vision people. It reads the page you're on, answers questions by voice or text, and clicks, types and scrolls when you ask.

```
extension/   Chrome extension (Manifest V3, plain JavaScript, no build step)
server/      Node backend: keeps API keys in .env, calls Gemini + TinyFish
shared/      Redaction + masking code (copied into extension/ and server/ by `npm run sync`)
```

## Run it (5 minutes)

1. **Backend** (Node 20+)
   ```
   cd server
   npm install
   cp .env.example .env      # then paste TINYFISH_API_KEY (and GEMINI_API_KEY)
   npm run check             # confirms your keys work (Search/Fetch are free)
   npm start
   ```
2. **Extension**: open `chrome://extensions` → turn on *Developer mode* → *Load unpacked* → choose the `extension` folder. Pin WebWhisper and click its icon to open the side panel.
3. **Microphone**: press **Mic**. The first time, a tab opens asking for permission. Allow it once; it applies to every site. Press **Mic** again to mute.
4. Optional: copy the extension's ID from `chrome://extensions` into `ALLOWED_EXTENSION_ID` in `server/.env` so only your extension can call the server.

Shortcuts (change at `chrome://extensions/shortcuts`): **Alt+Shift+W** open · **Alt+J** mic on/off · **Alt+Shift+S** stop speaking · **Esc** stop speaking · **Ctrl + hover** (hold Ctrl and hover over an element) describe and read aloud what it says and does.

Voice commands handled instantly on-device: "stop", "repeat that", "faster", "slower", "stop listening".

## How it works

```
You speak/type ──► side panel ──► mask typed values locally ({{V1}})
                       │
          page snapshot (no input values, redacted) 
                       ▼
                 your server ──► Gemini: statement ➜ goal/actions (JSON)
                       │              └─ if Gemini fails ➜ TinyFish Agent gets your statement directly
                       │         TinyFish Search / Fetch / Agent for anything beyond the open tab
                       ▼
 side panel runs the actions in YOUR tab (content script) and speaks the reply
```
- **TinyFish** does web search, fetching other pages, and cloud-browser tasks, and is the fallback if Gemini is down or unconfigured. It has no chat model or speech, and its agent runs in its own remote browser, so it can't click inside your tab. That is why the extension performs local actions itself.
- **Gemini** (the one non-TinyFish service) turns your sentence into a plan and phrases replies naturally. Remove `GEMINI_API_KEY` and everything falls back to TinyFish alone (web tasks only).
- **Voice**: Chrome's built-in speech recognition and the best installed voice (free, instant). Replies are spoken sentence by sentence so speech starts immediately.

## Privacy model

- Anything you dictate to be typed (usernames, passwords, text) is replaced by `{{V1}}`-style placeholders **in the browser** before anything is sent. Real values live only in memory, are typed locally, are not stored, and are never spoken.
- Page snapshots never contain what is typed into fields, only whether a field is filled. On pages with password or card fields, page text is omitted.
- Cards, ID numbers, emails, phone numbers, OTPs and long tokens are redacted in the extension and again on the server. This is pattern-based and can't catch everything; other personal text on a page (a name on a dashboard) can still reach Gemini.
- The server binds to localhost, can restrict callers to your extension, and doesn't log request bodies.
- Irreversible-looking buttons (pay, buy, delete, transfer…) always need a spoken "yes".

## Tests

`cd server && npm test` (privacy masking, redaction, planner/fallback logic with mocked APIs).

## Known limits / next steps

- Chrome's own pages (settings, new tab) and the Web Store can't be read. Cross-origin iframes aren't included in snapshots.
- Dictated credentials are only as accurate as speech recognition. Spelling letters ("R A H U L") works best.
- Built-in voices vary by OS. For more natural speech later, a neural TTS can be added behind `lib/speech.js`.
- Images are described using their alt text only; image captioning would be a good next feature.
- TinyFish Agent's response shape was implemented from its docs; run `npm run check -- --agent` once to confirm on your account.
- If you use a screen reader as well, expect it and WebWhisper's voice to overlap; the chat log is deliberately not a live region.
- Before publishing to the Chrome Web Store: host the server (HTTPS + auth), bundle the Manrope font, and write a privacy policy.
