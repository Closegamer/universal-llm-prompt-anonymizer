import assert from "node:assert/strict";
import test from "node:test";
import { MESSAGES, normalizeLanguage, translate } from "../desktop/i18n.js";

test("English and Russian interfaces have the same keys", () => {
  assert.deepEqual(Object.keys(MESSAGES.ru).sort(), Object.keys(MESSAGES.en).sort());
});

test("Russian translations keep the English placeholders", () => {
  for (const [key, template] of Object.entries(MESSAGES.en)) {
    const placeholders = template.match(/\{\w+\}/g) ?? [];
    for (const placeholder of placeholders) {
      assert.ok(MESSAGES.ru[key].includes(placeholder), `${key} is missing ${placeholder}`);
    }
  }
});

test("unknown languages fall back to English", () => {
  assert.equal(normalizeLanguage("de"), "en");
  assert.equal(translate("de", "endpoint.copy"), "Copy");
});

test("placeholders are replaced", () => {
  assert.equal(
    translate("ru", "error.didNotStart", { port: 8787 }),
    "Прокси не запустился на порту 8787. Возможно, порт занят. Подробности в логе.",
  );
});
