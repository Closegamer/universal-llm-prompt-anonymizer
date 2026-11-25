const detectorInputs = [...document.querySelectorAll("[data-detector]")];
const optionInputs = [...document.querySelectorAll("[data-option]")];
const $ = (selector) => document.querySelector(selector);

let state = null;
let flashTimer = null;

function language() {
  return state?.settings?.language ?? "en";
}

function t(key) {
  return state?.messages?.[key] ?? key;
}

function applyTranslations() {
  document.documentElement.lang = language();
  for (const element of document.querySelectorAll("[data-i18n]")) {
    element.textContent = t(element.dataset.i18n);
  }
  $("#language").value = language();
}

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
  applyTranslations();

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
  $("#status-text").textContent = t(`status.${next.status}`);

  const running = next.status === "running" || next.status === "starting";
  const toggle = $("#toggle");
  toggle.textContent = running ? t("actions.stop") : t("actions.start");
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
    flash(t("flash.saved"));
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

async function changeLanguage() {
  try {
    const next = await window.api.setLanguage($("#language").value);
    render(next);
  } catch (error) {
    showError(error);
  }
}

async function copyEndpoint() {
  try {
    await navigator.clipboard.writeText(state.proxyUrl);
    flash(t("flash.copied"));
  } catch {
    flash(t("flash.copyFailed"));
  }
}

function toggleAll() {
  const allOn = detectorInputs.every((input) => input.checked);
  for (const input of detectorInputs) input.checked = !allOn;
  syncPreload();
}

$("#save").addEventListener("click", save);
$("#toggle").addEventListener("click", toggleProxy);
$("#language").addEventListener("change", changeLanguage);
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
