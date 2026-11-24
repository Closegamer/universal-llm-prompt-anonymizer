import { createHash } from "node:crypto";
import os from "node:os";
import path from "node:path";
import { env, pipeline } from "@huggingface/transformers";

env.cacheDir = path.join(os.homedir(), ".cache", "prompt-anonymizer", "models");

const MODELS = {
  latin: "Xenova/distilbert-base-multilingual-cased-ner-hrl",
  cyrillic: "onnx-community/bert-base-NER-Russian-ONNX",
};

const LABELS = new Set(["PER", "PERSON", "FIRST_NAME", "LAST_NAME", "MIDDLE_NAME", "NICKNAME"]);

const pipes = new Map();
const loading = new Map();
const cache = new Map();
const CACHE_MAX = 4000;

let queue = Promise.resolve();
let readyLogged = new Set();

function enqueue(fn) {
  const run = queue.then(fn, fn);
  queue = run.catch(() => {});
  return run;
}

async function getPipe(kind) {
  if (pipes.has(kind)) return pipes.get(kind);
  if (!loading.has(kind)) {
    const promise = pipeline("token-classification", MODELS[kind], {
      dtype: "q8",
      progress_callback: (progress) => {
        if (progress.status === "progress" && progress.progress === 100) return;
      },
    }).then((pipe) => {
      pipes.set(kind, pipe);
      return pipe;
    });
    loading.set(kind, promise);
  }
  return loading.get(kind);
}

export function scriptKind(text) {
  const cyrillic = (text.match(/[А-Яа-яЁё]/g) ?? []).length;
  const latin = (text.match(/[A-Za-z]/g) ?? []).length;
  if (cyrillic === 0 && latin === 0) return null;
  return cyrillic > latin ? "cyrillic" : "latin";
}

function hash(text) {
  return createHash("sha1").update(text).digest("hex");
}

function splitChunks(text, size = 1500, overlap = 150, maxChunks = 250) {
  const chunks = [];
  let start = 0;
  while (start < text.length && chunks.length < maxChunks) {
    let end = Math.min(text.length, start + size);
    if (end < text.length) {
      const space = text.lastIndexOf(" ", end);
      if (space > start + size * 0.6) end = space;
    }
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = Math.max(start + 1, end - overlap);
  }
  return chunks;
}

function normalizeLabel(raw) {
  return String(raw ?? "")
    .replace(/^[UBI]-/, "")
    .replace(/^U-/, "")
    .toUpperCase();
}

async function inferChunk(pipe, chunk, kind, threshold) {
  const results = await enqueue(() => pipe(chunk, { aggregation_strategy: "simple" }));
  const words = [];
  for (const result of results ?? []) {
    const label = normalizeLabel(result.entity_group ?? result.entity);
    if (!LABELS.has(label)) continue;
    if ((result.score ?? 0) < threshold) continue;
    const word = String(result.word ?? "").trim();
    if (word.length < 2) continue;
    if (kind === "cyrillic" ? !/[А-Яа-яЁё]/.test(word) : !/[A-Za-z]/.test(word)) continue;
    words.push(word);
  }
  return words;
}

export async function detectNames(text, options = {}) {
  const kind = scriptKind(text);
  if (!kind) return [];

  const threshold =
    kind === "cyrillic"
      ? (options.cyrillicThreshold ?? 0.6)
      : (options.latinThreshold ?? 0.75);

  if (!pipes.has(kind) && !readyLogged.has(kind)) {
    console.error(`[prompt-anonymizer] loading NER model (${kind}), first run downloads weights`);
  }
  const pipe = await getPipe(kind);
  if (!readyLogged.has(kind)) {
    readyLogged.add(kind);
    console.error(`[prompt-anonymizer] NER ready (${kind})`);
  }

  const found = new Set();
  for (const chunk of splitChunks(text)) {
    const key = `${kind}:${hash(chunk)}`;
    let words = cache.get(key);
    if (!words) {
      words = await inferChunk(pipe, chunk, kind, threshold);
      cache.set(key, words);
      if (cache.size > CACHE_MAX) {
        cache.delete(cache.keys().next().value);
      }
    }
    for (const word of words) found.add(word);
  }
  return [...found];
}

export async function preloadNer() {
  await detectNames("John Smith was born on 12.03.1985.", {});
  await detectNames("Иван Петров родился 12.03.1985.", {});
}
