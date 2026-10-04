/*
 * Runs in YouTube's page context (injected by content.js).  Enables the
 * player's native audio-only mode so the video stream is never requested, and
 * strips video/muxed formats from the player response as a fallback.
 */
(function () {
  "use strict";

  var de = document.documentElement;

  function enabled() {
    return de.getAttribute("data-yt-audio") !== "0";
  }

  function goodAudio(mime) {
    mime = String(mime || "");
    if (mime.indexOf("audio/") !== 0) return false;
    if (mime.indexOf("ec-3") !== -1) return false;
    if (mime.indexOf("ac-3") !== -1) return false;
    return true;
  }

  function strip(pr) {
    if (!enabled()) return pr;
    try {
      var sd = pr && pr.streamingData;
      if (sd) {
        if (Array.isArray(sd.adaptiveFormats)) {
          sd.adaptiveFormats = sd.adaptiveFormats.filter(function (f) {
            return goodAudio(f.mimeType);
          });
        }
        if (Array.isArray(sd.formats)) sd.formats = [];
      }
    } catch (e) {}
    return pr;
  }

  function ytConfigFix(config_) {
    if (!enabled() || !config_) return;
    try {
      var pk =
        (((config_ || 0).WEB_PLAYER_CONTEXT_CONFIGS || 0)
          .WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH) ||
        0;
      if (pk) {
        pk.deviceIsAudioOnly = true;
        var usp = new URLSearchParams("?" + pk.serializedExperimentFlags);
        usp.set("html5_onesie_audio_only_playback", "true");
        usp.set("allow_vb_audio_formats", "true");
        usp.set("allow_vb_audio_formats_with_mta", "true");
        usp.set("ws_use_centralized_hqa_filter", "true");
        usp.set("web_cinematic_watch_settings", "false");
        usp.set("web_l3_storyboard", "false");
        pk.serializedExperimentFlags = String(usp).replace(/^\?+/g, "");
      }
      var ef = config_.EXPERIMENT_FLAGS;
      if (ef) {
        ef.kevlar_watch_cinematics = false;
        ef.mweb_cinematic_watch = false;
      }
    } catch (e) {}
  }

  function fixYtConfig() {
    try {
      if (window.yt && window.yt.config_) ytConfigFix(window.yt.config_);
    } catch (e) {}
  }

  // 1. Strip video formats from the inline player response.
  var stored;
  try {
    Object.defineProperty(window, "ytInitialPlayerResponse", {
      configurable: true,
      get: function () {
        return stored;
      },
      set: function (v) {
        stored = strip(v);
      },
    });
  } catch (e) {}

  // 2. Strip video formats from player API responses.
  try {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      var p = origFetch.apply(this, arguments);
      if (url && url.indexOf("/youtubei/v1/player") !== -1) {
        return p.then(function (resp) {
          return resp
            .clone()
            .json()
            .then(function (json) {
              strip(json);
              return new Response(JSON.stringify(json), {
                status: resp.status,
                statusText: resp.statusText,
                headers: { "content-type": "application/json" },
              });
            })
            .catch(function () {
              return resp;
            });
        });
      }
      return p;
    };
  } catch (e) {}

  // 3. Force the player config as early as possible (bounded retries, ~5s).
  var configTries = 0;
  var configTimer = setInterval(function () {
    fixYtConfig();
    if (++configTries >= 100) clearInterval(configTimer);
  }, 50);

  try {
    customElements.whenDefined("ytd-player").then(function () {
      var dummy =
        document.querySelector("ytd-player") ||
        document.createElement("ytd-player");
      var cnt = dummy.polymerController || dummy;
      var proto = cnt && cnt.constructor && cnt.constructor.prototype;
      if (proto && proto.createMainAppPlayer_ && !proto.__ytAudioOnly) {
        proto.__ytAudioOnly = true;
        var orig = proto.createMainAppPlayer_;
        proto.createMainAppPlayer_ = function () {
          fixYtConfig();
          return orig.apply(this, arguments);
        };
      }
    });
  } catch (e) {}
})();
