// writtenBy('Closegamer', 2026)
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, BrowserWindow, Menu, Tray, ipcMain, nativeImage, shell } from "electron";

const PRODUCT = "Universal LLM Prompt Anonymizer";
const SERVICE = "universal-llm-prompt-anonymizer";
const APP_ID = "com.closegamer.universalllmpromptanonymizer";
const DIR = path.dirname(fileURLToPath(import.meta.url));
const PRELOAD = path.join(DIR, "preload.cjs");
const RENDERER = path.join(DIR, "renderer", "index.html");
const ASSET_ROOT = app.isPackaged ? path.join(process.resourcesPath, "assets") : path.join(DIR, "assets");
const ICON = path.join(ASSET_ROOT, "icon.png");
const TRAY_ICON = path.join(ASSET_ROOT, "tray.png");

const DETECTOR_KEYS = [
  "names",
  "nickname",
  "date",
  "username",
  "email",
  "phone",
  "address",
  "card",
  "iban",
  "ssn",
  "id",
  "number",
  "ip",
];

const DEFAULT_SETTINGS = {
  port: 8787,
  startAtLogin: false,
  preload: false,
  log: false,
  allowUnscanned: false,
  detectors: Object.fromEntries(DETECTOR_KEYS.map((key) => [key, true])),
};

let settings = structuredClone(DEFAULT_SETTINGS);
let settingsPath = "";
let proxyConfigPath = "";
let logPath = "";
let child = null;
let status = "stopped";
let lastError = "";
let stopping = false;
let quitting = false;
let win = null;
let tray = null;
let startHidden = process.argv.includes("--hidden");

app.setName(PRODUCT);
app.setAppUserModelId(APP_ID);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function loadSettings() {
  if (fs.existsSync(settingsPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(settingsPath, "utf8"));
      settings = {
        ...structuredClone(DEFAULT_SETTINGS),
        ...parsed,
        detectors: { ...DEFAULT_SETTINGS.detectors, ...(parsed.detectors ?? {}) },
      };
    } catch {
      settings = structuredClone(DEFAULT_SETTINGS);
    }
  }
  if (!Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535) {
    settings.port = 8787;
  }
  saveSettings();
}

function saveSettings() {
  fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
  fs.writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`);
}

function writeProxyConfig() {
  const config = {
    host: "127.0.0.1",
    port: settings.port,
    detectors: settings.detectors,
    ner: { enabled: settings.detectors.names !== false },
    allowUnscanned: settings.allowUnscanned,
    log: settings.log,
  };
  fs.mkdirSync(path.dirname(proxyConfigPath), { recursive: true });
  fs.writeFileSync(proxyConfigPath, `${JSON.stringify(config, null, 2)}\n`);
}

function appendLog(text) {
  if (!logPath) return;
  try {
    const line = `[${new Date().toISOString()}] ${text}`;
    fs.appendFileSync(logPath, line.endsWith("\n") ? line : `${line}\n`);
    if (fs.statSync(logPath).size > 1_000_000) {
      const tail = fs.readFileSync(logPath, "utf8").slice(-500_000);
      fs.writeFileSync(logPath, tail);
    }
  } catch {
    // Logging must never break the app.
  }
}

function proxyRuntimeDir() {
  return app.isPackaged
    ? path.join(process.resourcesPath, "proxy", "proxy-runtime")
    : path.join(DIR, "build", "proxy-runtime");
}

function nodeBinary() {
  if (app.isPackaged) {
    return path.join(
      process.resourcesPath,
      "proxy",
      "node",
      process.platform === "win32" ? "node.exe" : "node",
    );
  }
  return process.env.PROMPT_ANONYMIZER_NODE ?? "node";
}

async function health() {
  try {
    const response = await fetch(`http://127.0.0.1:${settings.port}/health`, {
      signal: AbortSignal.timeout(800),
    });
    const body = await response.json();
    return body?.service === SERVICE;
  } catch {
    return false;
  }
}

async function startProxy() {
  if (child) return;
  if (await health()) {
    status = "error";
    lastError = `A proxy is already running on port ${settings.port}. Stop it with "prompt-anonymizer stop" or change the port.`;
    broadcast();
    return;
  }

  const runtime = proxyRuntimeDir();
  const cli = path.join(runtime, "src", "cli.js");
  if (!fs.existsSync(cli)) {
    status = "error";
    lastError = "Proxy runtime is missing. Run npm run prepare:desktop before starting the app.";
    broadcast();
    return;
  }

  writeProxyConfig();
  status = "starting";
  lastError = "";
  broadcast();

  const args = [];
  if (process.platform === "win32") args.push("--use-system-ca");
  args.push(cli, "--config", proxyConfigPath);
  if (!settings.log) args.push("--no-log");
  if (settings.preload && settings.detectors.names !== false) args.push("--preload");

  appendLog(`starting: ${nodeBinary()} ${args.join(" ")}`);
  try {
    child = spawn(nodeBinary(), args, {
      cwd: runtime,
      windowsHide: true,
      env: {
        ...process.env,
        ...(process.platform === "win32" ? { PROMPT_ANONYMIZER_NO_SYSTEM_CA: "1" } : {}),
      },
    });
  } catch (error) {
    status = "error";
    lastError = `Could not start the proxy: ${error.message}`;
    broadcast();
    return;
  }

  child.stdout.on("data", (data) => appendLog(data.toString()));
  child.stderr.on("data", (data) => appendLog(data.toString()));
  child.on("error", (error) => {
    appendLog(`spawn error: ${error.message}`);
    lastError = `Could not start the proxy: ${error.message}`;
  });
  child.on("exit", (code, signal) => {
    child = null;
    if (stopping) {
      stopping = false;
      if (status !== "error") {
        status = "stopped";
        lastError = "";
      }
    } else {
      status = "error";
      lastError = `Proxy stopped unexpectedly (${signal ?? code}). Open the log for details.`;
      appendLog(`proxy exited: ${signal ?? code}`);
    }
    broadcast();
  });

  for (let attempt = 0; attempt < 80; attempt++) {
    if (!child) break;
    if (await health()) {
      status = "running";
      lastError = "";
      broadcast();
      return;
    }
    await sleep(250);
  }

  if (status === "starting") {
    status = "error";
    lastError = `Proxy did not start on port ${settings.port}. The port may be busy. Open the log for details.`;
    stopping = true;
    if (child) child.kill();
    broadcast();
  }
}

async function stopProxy() {
  if (!child) {
    status = "stopped";
    lastError = "";
    broadcast();
    return;
  }

  const current = child;
  status = "stopping";
  broadcast();
  stopping = true;

  const exited = new Promise((resolve) => current.once("exit", resolve));
  try {
    current.kill();
  } catch {
    // The process may already be gone.
  }
  await Promise.race([exited, sleep(3000)]);

  if (child === current) child = null;
  if (status !== "error") {
    status = "stopped";
    lastError = "";
  }
  stopping = false;
  clearPidFor(current.pid);
  broadcast();
}

function clearPidFor(pid) {
  try {
    const pidPath = path.join(os.homedir(), ".cache", "prompt-anonymizer", "proxy.json");
    const info = JSON.parse(fs.readFileSync(pidPath, "utf8"));
    if (info.pid === pid) fs.rmSync(pidPath, { force: true });
  } catch {
    // Nothing to clear.
  }
}

function state() {
  return {
    settings,
    status,
    error: lastError,
    proxyUrl: `http://127.0.0.1:${settings.port}`,
    version: app.getVersion(),
    logPath,
  };
}

function broadcast() {
  if (win && !win.isDestroyed()) win.webContents.send("state", state());
  updateTray();
}

function createWindow() {
  win = new BrowserWindow({
    width: 780,
    height: 840,
    minWidth: 640,
    minHeight: 640,
    show: false,
    backgroundColor: "#070b16",
    icon: ICON,
    title: PRODUCT,
    autoHideMenuBar: true,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  win.loadFile(RENDERER);
  win.once("ready-to-show", () => {
    if (!startHidden) win.show();
  });
  win.on("close", (event) => {
    if (!quitting) {
      event.preventDefault();
      win.hide();
    }
  });
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

function showWindow() {
  if (!win || win.isDestroyed()) createWindow();
  win.show();
  win.focus();
}

function applyLogin(enabled) {
  if (process.platform === "linux") {
    const dir = path.join(os.homedir(), ".config", "autostart");
    const file = path.join(dir, "universal-llm-prompt-anonymizer.desktop");
    if (enabled) {
      fs.mkdirSync(dir, { recursive: true });
      const executable = process.env.APPIMAGE ?? process.execPath;
      fs.writeFileSync(
        file,
        `[Desktop Entry]\nType=Application\nName=${PRODUCT}\nComment=Local privacy gateway for cloud LLMs\nExec="${executable}" --hidden\nX-GNOME-Autostart-enabled=true\n`,
      );
    } else {
      fs.rmSync(file, { force: true });
    }
    return;
  }

  app.setLoginItemSettings({
    openAtLogin: enabled,
    openAsHidden: true,
    args: ["--hidden"],
  });
}

function updateTray() {
  if (!tray) return;
  const running = status === "running";
  const busy = status === "starting" || status === "stopping";
  const menu = Menu.buildFromTemplate([
    { label: PRODUCT, enabled: false },
    { label: `Status: ${status}`, enabled: false },
    { type: "separator" },
    { label: "Open settings", click: showWindow },
    {
      label: running ? "Stop proxy" : "Start proxy",
      enabled: !busy,
      click: () => {
        if (running) void stopProxy();
        else void startProxy();
      },
    },
    { type: "separator" },
    {
      label: "Start at login",
      type: "checkbox",
      checked: settings.startAtLogin,
      click: (item) => {
        settings.startAtLogin = item.checked;
        saveSettings();
        applyLogin(item.checked);
        broadcast();
      },
    },
    { label: "Open log", click: () => shell.openPath(logPath) },
    { type: "separator" },
    { label: "Quit", click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  tray.setToolTip(`${PRODUCT}: ${status}`);
}

function createTray() {
  const image = nativeImage.createFromPath(TRAY_ICON);
  tray = new Tray(image);
  tray.setToolTip(`${PRODUCT}: ${status}`);
  tray.on("click", showWindow);
  updateTray();
}

function registerIpc() {
  ipcMain.handle("get-state", () => state());

  ipcMain.handle("save-settings", async (_event, incoming) => {
    const port = Number(incoming?.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) {
      throw new Error("Port must be a number between 1024 and 65535.");
    }

    settings = {
      ...settings,
      port,
      startAtLogin: Boolean(incoming.startAtLogin),
      preload: Boolean(incoming.preload),
      log: Boolean(incoming.log),
      allowUnscanned: Boolean(incoming.allowUnscanned),
      detectors: Object.fromEntries(
        DETECTOR_KEYS.map((key) => [key, incoming?.detectors?.[key] !== false]),
      ),
    };
    saveSettings();
    applyLogin(settings.startAtLogin);

    const wasRunning = status === "running" || status === "starting";
    if (wasRunning) {
      await stopProxy();
      await startProxy();
    } else {
      broadcast();
    }
    return state();
  });

  ipcMain.handle("start-proxy", async () => {
    await startProxy();
    return state();
  });

  ipcMain.handle("stop-proxy", async () => {
    await stopProxy();
    return state();
  });

  ipcMain.handle("open-log", () => shell.openPath(logPath));
}

async function init() {
  settingsPath = path.join(app.getPath("userData"), "settings.json");
  proxyConfigPath = path.join(app.getPath("userData"), "proxy.config.json");
  logPath = path.join(app.getPath("userData"), "proxy.log");

  if (process.platform === "darwin" && app.getLoginItemSettings().wasOpenedAsHidden) {
    startHidden = true;
  }

  loadSettings();
  registerIpc();
  createTray();
  createWindow();
  applyLogin(settings.startAtLogin);
  await startProxy();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", showWindow);
  app.on("window-all-closed", () => {
    // Stay in the tray.
  });
  app.on("before-quit", () => {
    quitting = true;
    if (child) {
      clearPidFor(child.pid);
      try {
        child.kill();
      } catch {
        // Already gone.
      }
    }
  });
  app.on("activate", showWindow);

  app.whenReady().then(init).catch((error) => {
    console.error(error);
    app.quit();
  });
}
