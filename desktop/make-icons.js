// writtenBy('Closegamer', 2026)
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(ROOT, "assets", "icon.svg");

await sharp(source).png().toFile(path.join(ROOT, "assets", "icon.png"));
await sharp(source).resize(32, 32).png().toFile(path.join(ROOT, "assets", "tray.png"));
await sharp(source).resize(64, 64).png().toFile(path.join(ROOT, "assets", "tray@2x.png"));

console.log("icons written");
