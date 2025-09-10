"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.injectCode = injectCode;
function injectCode(html, adapterName, jsonConfigFileName) {
    return html.replace('</head>', `
<script type="module">
import { io } from "https://cdn.socket.io/4.4.1/socket.io.esm.min.js";

let currentConfig = "";

const socket = io("/browser-sync", { path: "/browser-sync/socket.io" });
socket.on("browser:reload", async () => {
  // try for 2 seconds:
  for (let i = 0; i < 20; i++) {
    const newConfig = await readJsonConfig();
    if (newConfig != currentConfig) {
      console.log("Config changed", i);
      if (location.hash && location.hash.startsWith("#tab-instances/config/system.adapter.${adapterName}.")) {
        // "reload" the config page if the config changed
        const oldHash = location.hash;
        location.hash = "#tab-instances";
        setTimeout(() => location.hash = oldHash, 1);
      }
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log("Config did not change!");
});

async function readJsonConfig() {
  return new Promise((resolve, reject) => {
    window.io.emit("readFile", "${adapterName}.admin", "${jsonConfigFileName}", (err, data, type) => {
      if (err) reject(err);
      else resolve(data);
    });
  });
}

setTimeout(async () => {
  currentConfig = await readJsonConfig();
  console.log({ currentConfig });
}, 1000);
</script>
</head>`);
}
