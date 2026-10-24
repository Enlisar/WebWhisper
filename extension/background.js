// Service worker: routes keyboard commands (Alt+J, Alt+Shift+W) and manages WebWhisper side panel.

function setupSidePanel() {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
}

chrome.runtime.onInstalled.addListener(() => {
  setupSidePanel();
});

chrome.runtime.onStartup.addListener(() => {
  setupSidePanel();
});

// Run setup immediately on service worker start
setupSidePanel();

// Handle keyboard shortcuts
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'open-panel') {
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
    return;
  }

  if (command === 'toggle-mic' || command === 'stop-speech') {
    // Call open synchronously to preserve live user gesture
    if (tab?.windowId) {
      chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
    }
    // Dispatch command to the side panel
    chrome.runtime.sendMessage({ ww: true, type: 'command', command }).catch(() => {
      chrome.storage.session.set({ ww_pending_command: command }).catch(() => {});
    });
  }
});

