let isAudioOnly = true;

// Load persisted state
browser.storage.local.get({ enabled: true }, (res) => {
  isAudioOnly = res.enabled;
});

// React to toggle changes
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && changes.enabled !== undefined) {
    isAudioOnly = changes.enabled.newValue;
  }
});

// Intercept YouTube media stream requests
browser.webRequest.onBeforeRequest.addListener(
  (details) => {
    if (!isAudioOnly) return {};

    try {
      const url = new URL(details.url);
      const mime = url.searchParams.get("mime") || "";

      // 1. Block video chunks (saves the vast majority of bandwidth)
      if (mime.startsWith("video/") || url.pathname.includes("/mime/video")) {
        return { cancel: true };
      }

      // 2. Intercept audio streams
      if (mime.startsWith("audio/") || url.pathname.includes("/mime/audio")) {
        // Remove range and buffer parameters to stream the full audio file
        url.searchParams.delete("range");
        url.searchParams.delete("rn");
        url.searchParams.delete("rbuf");

        const audioUrl = url.toString();

        if (details.tabId > 0) {
          browser.tabs.sendMessage(details.tabId, {
            type: "SET_AUDIO_STREAM",
            audioUrl: audioUrl
          }).catch(() => {});
        }
      }
    } catch (e) {
      console.error("Audio-only filter error:", e);
    }

    return {};
  },
  { urls: ["*://*.googlevideo.com/videoplayback*"] },
  ["blocking"]
);
