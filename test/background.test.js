const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "youtube-audio-only", "background.js");
const code = fs.readFileSync(SRC, "utf8");

let beforeRequestListener = null;
let onChangedListener = null;
const sentMessages = [];

const browser = {
  storage: {
    local: {
      get(defaults, cb) {
        cb(defaults);
      }
    },
    onChanged: {
      addListener(fn) {
        onChangedListener = fn;
      }
    }
  },
  webRequest: {
    onBeforeRequest: {
      addListener(fn) {
        beforeRequestListener = fn;
      }
    }
  },
  tabs: {
    sendMessage(tabId, msg) {
      sentMessages.push({ tabId, msg });
      return Promise.resolve();
    }
  }
};

const sandbox = { browser, URL, console };
vm.createContext(sandbox);
vm.runInContext(code, sandbox);

if (typeof beforeRequestListener !== "function") {
  throw new Error("background.js did not register an onBeforeRequest listener");
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

function run(details) {
  return beforeRequestListener(details);
}

console.log("Background request filter:");

// 1. Video streams must be cancelled
let r = run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=video%2Fmp4&itag=137&range=0-100000",
  tabId: 1
});
check("blocks video/mp4", r && r.cancel === true, JSON.stringify(r));

r = run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=video%2Fwebm&itag=248",
  tabId: 1
});
check("blocks video/webm", r && r.cancel === true, JSON.stringify(r));

// 2. Audio streams must NOT be cancelled and should emit cleaned URL
sentMessages.length = 0;
r = run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=audio%2Fmp4&itag=140&range=0-50000&rn=5&rbuf=0",
  tabId: 7
});
check("allows audio/mp4", r && r.cancel !== true, JSON.stringify(r));
check("sends one message for audio", sentMessages.length === 1, String(sentMessages.length));
if (sentMessages.length === 1) {
  const msg = sentMessages[0].msg;
  check("message type is SET_AUDIO_STREAM", msg.type === "SET_AUDIO_STREAM");
  check("message targets correct tab", sentMessages[0].tabId === 7);
  check("range param removed", !/[?&]range=/.test(msg.audioUrl), msg.audioUrl);
  check("rn param removed", !/[?&]rn=/.test(msg.audioUrl), msg.audioUrl);
  check("rbuf param removed", !/[?&]rbuf=/.test(msg.audioUrl), msg.audioUrl);
  check("mime preserved", /mime=audio/.test(msg.audioUrl), msg.audioUrl);
}

// 3. tabId <= 0 should not send a message
sentMessages.length = 0;
run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=audio%2Fmp4&itag=140",
  tabId: -1
});
check("no message when tabId <= 0", sentMessages.length === 0, String(sentMessages.length));

// 4. Toggle OFF => nothing blocked, no messages
if (typeof onChangedListener !== "function") {
  throw new Error("background.js did not register a storage.onChanged listener");
}
onChangedListener({ enabled: { newValue: false } }, "local");
sentMessages.length = 0;
r = run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=video%2Fmp4&itag=137",
  tabId: 1
});
check("disabled: video not blocked", r && r.cancel !== true, JSON.stringify(r));
r = run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=audio%2Fmp4&itag=140",
  tabId: 1
});
check("disabled: no audio message", sentMessages.length === 0, String(sentMessages.length));

// 5. Toggle back ON
onChangedListener({ enabled: { newValue: true } }, "local");
r = run({
  url: "https://rr1---sn-x.googlevideo.com/videoplayback?mime=video%2Fmp4&itag=137",
  tabId: 1
});
check("re-enabled: video blocked again", r && r.cancel === true, JSON.stringify(r));

console.log("\n" + pass + " passed, " + fail + " failed");
process.exit(fail === 0 ? 0 : 1);
