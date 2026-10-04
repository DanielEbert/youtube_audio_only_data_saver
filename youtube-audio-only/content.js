"use strict";

let isAudioOnly = true;

// Set the mode flag as early as possible (default: enabled).  The injected
// page script reads this attribute and only enters audio-only mode when it is
// not explicitly "0".
try {
  document.documentElement.setAttribute("data-yt-audio", "1");
} catch (e) {}

browser.storage.local.get({ enabled: true }, (res) => {
  isAudioOnly = res.enabled;
  applyMode();
});

browser.storage.onChanged.addListener((changes) => {
  if (changes.enabled !== undefined) {
    isAudioOnly = changes.enabled.newValue;
    applyMode();
  }
});

function applyMode() {
  try {
    document.documentElement.setAttribute(
      "data-yt-audio",
      isAudioOnly ? "1" : "0"
    );
  } catch (e) {}

  if (isAudioOnly) {
    injectPageScript();
    hideVideo(true);
    showAudioOverlay(true);
  } else {
    hideVideo(false);
    showAudioOverlay(false);
  }
  updateUI();
}

// The page script must run in YouTube's own JS context to toggle the player's
// audio-only mode.  It is listed in web_accessible_resources, so YouTube's CSP
// does not block it.
function injectPageScript() {
  if (document.documentElement.hasAttribute("data-yt-audio-injected")) return;
  try {
    const s = document.createElement("script");
    s.src = browser.runtime.getURL("inject.js");
    s.onload = () => s.remove();
    (document.head || document.documentElement).appendChild(s);
    document.documentElement.setAttribute("data-yt-audio-injected", "1");
  } catch (e) {}
}

// ---------------------------------------------------------------------------
// Visuals
// ---------------------------------------------------------------------------
function hideVideo(hide) {
  const root = document.documentElement;
  if (!root) return;
  if (hide) root.classList.add("yt-audio-only-active");
  else root.classList.remove("yt-audio-only-active");
}

function showAudioOverlay(show) {
  const video = document.querySelector("video");
  if (!video || !video.parentElement) return;

  let overlay = document.getElementById("yt-audio-only-overlay");
  if (!overlay) {
    if (!show) return;
    overlay = document.createElement("div");
    overlay.id = "yt-audio-only-overlay";
    overlay.innerHTML = `
      <div class="yt-audio-box">
        <div class="yt-audio-icon">🎵</div>
        <div class="yt-audio-text">Audio Only Mode Active</div>
        <div class="yt-audio-sub">Saving Mobile Data</div>
      </div>
    `;
    video.parentElement.style.position = "relative";
    video.parentElement.appendChild(overlay);
  }
  overlay.style.display = show ? "flex" : "none";
}

// In-page floating toggle button for mobile screens
function createFloatingButton() {
  if (document.getElementById("yt-audio-toggle-btn")) return;

  const btn = document.createElement("button");
  btn.id = "yt-audio-toggle-btn";
  btn.addEventListener("click", () => {
    const nextState = !isAudioOnly;
    browser.storage.local.set({ enabled: nextState }).then(() => {
      location.reload();
    });
  });

  document.body.appendChild(btn);
  updateUI();
}

function updateUI() {
  const btn = document.getElementById("yt-audio-toggle-btn");
  if (btn) {
    btn.textContent = isAudioOnly ? "🎧 Audio Mode: ON" : "🎬 Video Mode";
    btn.className = isAudioOnly ? "btn-active" : "btn-disabled";
  }
}

// Keep the video hidden across YouTube SPA navigation
window.addEventListener("yt-navigate-finish", () => {
  applyMode();
});

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
injectPageScript();

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", createFloatingButton);
} else {
  createFloatingButton();
}
