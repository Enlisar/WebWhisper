// Service worker: opens the side panel and routes keyboard shortcuts to it.
chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === 'open-panel') {
    if (tab?.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
    return;
  }
  // toggle-mic / stop-speech: send to the panel; if it is closed, open it and leave a note.
  try {
    await chrome.runtime.sendMessage({ ww: true, type: 'command', command });
  } catch {
    await chrome.storage.session.set({ ww_pending_command: command });
    if (tab?.id) chrome.sidePanel.open({ tabId: tab.id }).catch(() => {});
  }
});
