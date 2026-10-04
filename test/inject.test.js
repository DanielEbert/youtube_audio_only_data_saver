const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "youtube-audio-only", "inject.js");
const code = fs.readFileSync(SRC, "utf8");

let audioAttr = null;
const intervals = [];
const clearedIntervals = [];
const timers = [];

function makeResponse() {
  return {
    streamingData: {
      formats: [{ mimeType: "video/mp4" }],
      adaptiveFormats: [
        { mimeType: "video/mp4" },
        { mimeType: "audio/webm" },
        { mimeType: "audio/mp4; codecs=\"ec-3\"" },
        { mimeType: "audio/mp4; codecs=\"ac-3\"" },
        { mimeType: "audio/mp4" }
      ]
    }
  };
}

const window = {};
window.fetch = function (input) {
  const url = typeof input === "string" ? input : input && input.url;
  return Promise.resolve({
    status: 200,
    statusText: "OK",
    url,
    clone() {
      return this;
    },
    json() {
      return Promise.resolve(makeResponse());
    }
  });
};

const document = {
  documentElement: {
    getAttribute(name) {
      return name === "data-yt-audio" ? audioAttr : null;
    }
  },
  querySelector() {
    return null;
  },
  createElement() {
    return {};
  }
};

const sandbox = {
  window,
  document,
  customElements: { whenDefined: () => new Promise(() => {}) },
  setInterval: (fn) => {
    intervals.push(fn);
    return intervals.length;
  },
  clearInterval: (id) => {
    clearedIntervals.push(id);
  },
  setTimeout: (fn) => {
    timers.push(fn);
    return timers.length;
  },
  URLSearchParams,
  Response,
  console
};

vm.createContext(sandbox);
vm.runInContext(code, sandbox);

function load(pr) {
  window.ytInitialPlayerResponse = pr;
  return window.ytInitialPlayerResponse;
}

function watchConfig() {
  return {
    WEB_PLAYER_CONTEXT_CONFIGS: {
      WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH: {
        serializedExperimentFlags: "a=b&c=d"
      },
      WEB_PLAYER_CONTEXT_CONFIG_ID_MWEB_WATCH: {
        serializedExperimentFlags: "m=n"
      }
    },
    EXPERIMENT_FLAGS: {
      kevlar_watch_cinematics: true,
      mweb_cinematic_watch: true
    }
  };
}

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) {
    pass++;
    console.log("  PASS  " + name);
  } else {
    fail++;
    console.log("  FAIL  " + name + (extra ? " -> " + extra : ""));
  }
}

(async function main() {
  console.log("Player response filter:");

  if (typeof Object.getOwnPropertyDescriptor(window, "ytInitialPlayerResponse").set !== "function") {
    throw new Error("inject.js did not install a ytInitialPlayerResponse setter");
  }

  audioAttr = "1";
  let pr = load(makeResponse());
  check("muxed formats cleared", Array.isArray(pr.streamingData.formats) && pr.streamingData.formats.length === 0);
  check(
    "video adaptive formats removed",
    pr.streamingData.adaptiveFormats.every((f) => f.mimeType.indexOf("audio/") === 0),
    JSON.stringify(pr.streamingData.adaptiveFormats)
  );
  check(
    "ec-3 audio removed",
    pr.streamingData.adaptiveFormats.every((f) => f.mimeType.indexOf("ec-3") === -1)
  );
  check(
    "ac-3 audio removed",
    pr.streamingData.adaptiveFormats.every((f) => f.mimeType.indexOf("ac-3") === -1)
  );
  check(
    "good audio kept",
    pr.streamingData.adaptiveFormats.some((f) => f.mimeType === "audio/webm") &&
      pr.streamingData.adaptiveFormats.some((f) => f.mimeType === "audio/mp4"),
    JSON.stringify(pr.streamingData.adaptiveFormats)
  );

  audioAttr = "0";
  pr = load(makeResponse());
  check("disabled: formats untouched", pr.streamingData.formats.length === 1);
  check(
    "disabled: video kept",
    pr.streamingData.adaptiveFormats.some((f) => f.mimeType === "video/mp4")
  );

  console.log("\nPlayer API fetch filter:");
  audioAttr = "1";
  window.yt = { config_: watchConfig() };
  check(
    "config readied by yt assignment",
    window.yt.config_.WEB_PLAYER_CONTEXT_CONFIGS
      .WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH.deviceIsAudioOnly === true
  );
  const playerJson = await (await window.fetch("/youtubei/v1/player?key=x", {})).json();
  check("fetch: muxed formats cleared", playerJson.streamingData.formats.length === 0);
  check(
    "fetch: video adaptive formats removed",
    playerJson.streamingData.adaptiveFormats.every((f) => f.mimeType.indexOf("audio/") === 0)
  );
  const otherJson = await (await window.fetch("/youtubei/v1/browse")).json();
  check("fetch: non-player request untouched", otherJson.streamingData.formats.length === 1);

  console.log("\nPlayer config fix:");
  audioAttr = "1";
  window.yt = { config_: watchConfig() };
  intervals.forEach((fn) => fn());
  const pk = window.yt.config_.WEB_PLAYER_CONTEXT_CONFIGS.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH;
  check("config: deviceIsAudioOnly set", pk.deviceIsAudioOnly === true);
  check(
    "config: audio-only flag added",
    pk.serializedExperimentFlags.indexOf("html5_onesie_audio_only_playback=true") !== -1,
    pk.serializedExperimentFlags
  );
  check("config: existing flags kept", pk.serializedExperimentFlags.indexOf("a=b") !== -1);
  check(
    "config: EXPERIMENT_FLAGS patched",
    window.yt.config_.EXPERIMENT_FLAGS.kevlar_watch_cinematics === false
  );
  const mweb = window.yt.config_.WEB_PLAYER_CONTEXT_CONFIGS.WEB_PLAYER_CONTEXT_CONFIG_ID_MWEB_WATCH;
  check("config: mweb deviceIsAudioOnly set", mweb.deviceIsAudioOnly === true);
  check(
    "config: mweb audio-only flag added",
    mweb.serializedExperimentFlags.indexOf("html5_onesie_audio_only_playback=true") !== -1,
    mweb.serializedExperimentFlags
  );
  check("config: mweb existing flags kept", mweb.serializedExperimentFlags.indexOf("m=n") !== -1);

  audioAttr = "0";
  window.yt = { config_: watchConfig() };
  intervals.forEach((fn) => fn());
  const pk2 = window.yt.config_.WEB_PLAYER_CONTEXT_CONFIGS.WEB_PLAYER_CONTEXT_CONFIG_ID_KEVLAR_WATCH;
  check(
    "disabled: config untouched",
    pk2.deviceIsAudioOnly === undefined && pk2.serializedExperimentFlags === "a=b&c=d"
  );

  console.log("\nInterval bound:");
  intervals.forEach((fn) => {
    for (let i = 0; i < 100; i++) fn();
  });
  check("config interval stops after bounded retries", clearedIntervals.length >= 1);

  console.log("\n" + pass + " passed, " + fail + " failed");
  process.exit(fail === 0 ? 0 : 1);
})();
