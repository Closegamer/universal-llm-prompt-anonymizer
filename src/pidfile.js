import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = path.join(os.homedir(), ".cache", "prompt-anonymizer");
const file = path.join(dir, "proxy.json");

export function writePid(info) {
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(info)}\n`);
}

export function readPid() {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

export function clearPid(pid) {
  const current = readPid();
  if (!pid || current?.pid === pid) fs.rmSync(file, { force: true });
}

export const pidFilePath = file;
