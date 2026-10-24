const msg = document.getElementById('msg');
const btn = document.getElementById('go');
function say(t) {
  msg.textContent = t;
  try { speechSynthesis.cancel(); speechSynthesis.speak(new SpeechSynthesisUtterance(t)); } catch {}
}
async function ask(isClick = false) {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    await chrome.storage?.local?.set({ ww_mic_granted: true }).catch(() => {});
    say('Microphone allowed. Closing this tab. Switch back to WebWhisper.');
    chrome.runtime.sendMessage({ ww: true, type: 'mic-granted' }).catch(() => {});
    setTimeout(async () => {
      const t = await chrome.tabs.getCurrent();
      if (t?.id) chrome.tabs.remove(t.id);
    }, 1500);
  } catch (e) {
    if (isClick) {
      say(e.name === 'NotAllowedError'
        ? 'The microphone is blocked. Open Chrome settings, Privacy and security, Site settings, Microphone, and remove WebWhisper from the blocked list. Then press the button again.'
        : 'No microphone was found. Plug one in and press the button again.');
    } else {
      msg.textContent = 'Please press the "Allow microphone" button below to enable access.';
    }
  }
}
btn.addEventListener('click', () => ask(true));
ask(false);
