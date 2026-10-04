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
    // Apply the audio-only config before handing the player a video-less
    // response; otherwise the player rejects it ("video can't be played").
    fixYtConfig();
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

  // True once at least one watch context has been switched to audio-only.
  var configReady = false;

  function patchWatchContext(ctx) {
    if (!ctx) return false;
    try {
      ctx.deviceIsAudioOnly = true;
      var usp = new URLSearchParams("?" + (ctx.serializedExperimentFlags || ""));
      usp.set("html5_onesie_audio_only_playback", "true");
      usp.set("allow_vb_audio_formats", "true");
      usp.set("allow_vb_audio_formats_with_mta", "true");
      usp.set("ws_use_centralized_hqa_filter", "true");
      usp.set("web_cinematic_watch_settings", "false");
      usp.set("web_l3_storyboard", "false");
      ctx.serializedExperimentFlags = String(usp).replace(/^\?+/g, "");
      return true;
    } catch (e) {
      return false;
    }
  }

  // Patch every watch player context (desktop KEVLAR and mobile MWEB) rather
  // than only the desktop one, so audio-only mode is honoured on m.youtube.com.
  function ytConfigFix(config_) {
    if (!config_) return false;
    try {
      var cfgs = config_.WEB_PLAYER_CONTEXT_CONFIGS;
      if (cfgs) {
        Object.keys(cfgs).forEach(function (key) {
          if (String(key).indexOf("WATCH") !== -1) {
            if (patchWatchContext(cfgs[key])) configReady = true;
          }
        });
      }
      var ef = config_.EXPERIMENT_FLAGS;
      if (ef) {
        ef.kevlar_watch_cinematics = false;
        ef.mweb_cinematic_watch = false;
      }
    } catch (e) {}
    return configReady;
  }

  function fixYtConfig() {
    if (!enabled()) return false;
    try {
      if (window.yt && window.yt.config_) return ytConfigFix(window.yt.config_);
    } catch (e) {}
    return false;
  }

  // Resolve once the audio-only config is in place (or the timeout elapses).
  // Used to hold back stripped player responses so the player is never handed a
  // video-less response while it is still in video mode.
  function whenConfigReady(timeoutMs) {
    return new Promise(function (resolve) {
      var t0 = Date.now();
      (function tick() {
        if (fixYtConfig() || Date.now() - t0 >= timeoutMs) {
          resolve(configReady);
          return;
        }
        setTimeout(tick, 25);
      })();
    });
  }

  // 1. Patch the player config the moment YouTube defines window.yt.
  var ytStored;
  try {
    Object.defineProperty(window, "yt", {
      configurable: true,
      get: function () {
        return ytStored;
      },
      set: function (v) {
        ytStored = v;
        try {
          if (enabled() && v && v.config_) ytConfigFix(v.config_);
        } catch (e) {}
      },
    });
  } catch (e) {}

  // 2. Strip video formats from the inline player response.
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

  // 3. Strip video formats from player API responses.  The response is held
  // back until the audio-only config is applied so the player never sees a
  // stripped response while still in video mode.
  try {
    var origFetch = window.fetch;
    window.fetch = function (input, init) {
      var url = typeof input === "string" ? input : input && input.url;
      var p = origFetch.apply(this, arguments);
      if (url && url.indexOf("/youtubei/v1/player") !== -1) {
        return p.then(function (resp) {
          return whenConfigReady(2000)
            .then(function () {
              return resp.clone().json();
            })
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

  // 4. Force the player config as early as possible (bounded retries, ~5s).
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
