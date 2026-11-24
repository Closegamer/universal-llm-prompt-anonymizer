const detectorInputs = [...document.querySelectorAll("[data-detector]")];
const optionInputs = [...document.querySelectorAll("[data-option]")];
const $ = (selector) => document.querySelector(selector);

const STATUS_TEXT = {
  running: "Proxy is running",
  starting: "Starting proxy...",
  stopping: "Stopping proxy...",
  stopped: "Proxy is stopped",
  error: "Proxy error",
};

let state = null;
let flashTimer = null;

function showError(error) {
  const box = $("#error");
  box.hidden = false;
  box.textContent = String(error?.message ?? error);
}

function flash(message) {
  const element = $("#saved");
  element.textContent = message;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => {
    element.textContent = "";
  }, 2500);
}

function syncPreload() {
  const names = detectorInputs.find((input) => input.dataset.detector === "names");
  const preload = $("#preload");
  preload.disabled = !names.checked;
  if (!names.checked) preload.checked = false;
}

function render(next) {
  state = next;

  for (const input of detectorInputs) {
    input.checked = next.settings.detectors?.[input.dataset.detector] !== false;
  }
  for (const input of optionInputs) {
    input.checked = Boolean(next.settings[input.dataset.option]);
  }

  const port = $("#port");
  if (document.activeElement !== port) port.value = next.settings.port;

  $("#proxy-url").textContent = next.proxyUrl;
  $("#version").textContent = next.version;

  const status = $("#status");
  status.dataset.status = next.status;
  $("#status-text").textContent = STATUS_TEXT[next.status] ?? next.status;

  const running = next.status === "running" || next.status === "starting";
  const toggle = $("#toggle");
  toggle.textContent = running ? "Stop proxy" : "Start proxy";
  toggle.disabled = next.status === "starting" || next.status === "stopping";

  const error = $("#error");
  error.hidden = !next.error;
  error.textContent = next.error ?? "";

  syncPreload();
}

function collect() {
  return {
    port: Number($("#port").value),
    startAtLogin: $("#startAtLogin").checked,
    preload: $("#preload").checked,
    log: $("#log").checked,
    allowUnscanned: $("#allowUnscanned").checked,
    detectors: Object.fromEntries(
      detectorInputs.map((input) => [input.dataset.detector, input.checked]),
    ),
  };
}

async function save() {
  const button = $("#save");
  button.disabled = true;
  $("#saved").textContent = "";
  try {
    const next = await window.api.saveSettings(collect());
    render(next);
    flash("Saved and restarted");
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

async function toggleProxy() {
  const button = $("#toggle");
  button.disabled = true;
  try {
    const next = state?.status === "running" ? await window.api.stop() : await window.api.start();
    render(next);
  } catch (error) {
    showError(error);
  } finally {
    button.disabled = false;
  }
}

async function copyEndpoint() {
  try {
    await navigator.clipboard.writeText(state.proxyUrl);
    flash("Copied");
  } catch {
    flash("Copy failed");
  }
}

function toggleAll() {
  const allOn = detectorInputs.every((input) => input.checked);
  for (const input of detectorInputs) input.checked = !allOn;
  syncPreload();
}

$("#save").addEventListener("click", save);
$("#toggle").addEventListener("click", toggleProxy);
$("#copy").addEventListener("click", copyEndpoint);
$("#log").addEventListener("click", () => window.api.openLog());
$("#all").addEventListener("click", toggleAll);

for (const input of detectorInputs) {
  if (input.dataset.detector === "names") {
    input.addEventListener("change", syncPreload);
  }
}

window.api.onState(render);
window.api.getState().then(render).catch(showError);
