const btn = document.getElementById("toggleBtn");

function render(enabled) {
  btn.textContent = enabled ? "Audio Only: ON" : "Audio Only: OFF";
  btn.className = enabled ? "active" : "disabled";
}

browser.storage.local.get({ enabled: true }, (res) => {
  render(res.enabled);
});

btn.addEventListener("click", () => {
  browser.storage.local.get({ enabled: true }, (res) => {
    const next = !res.enabled;
    browser.storage.local.set({ enabled: next }).then(() => {
      render(next);
      // Reload current tab to update
      browser.tabs.query({ active: true, currentWindow: true }).then((tabs) => {
        if (tabs[0]?.id) browser.tabs.reload(tabs[0].id);
      });
    });
  });
});
