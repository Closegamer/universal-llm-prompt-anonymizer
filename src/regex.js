const EMAIL = /(?<![\w.+-])[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+(?![\w-])/g;
const CARD = /(?<!\d)(?:\d[ -]?){13,19}(?!\d)/g;
const IBAN = /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]){11,30}(?![\p{L}\p{N}])/gu;
const SSN = /(?<!\d)\d{3}-\d{2}-\d{4}(?!\d)/g;
const IPV4 = /(?<![\d.])(?:\d{1,3}\.){3}\d{1,3}(?!\d|\.\d)/g;
const PHONE_INTL = /(?<![\p{L}\p{N}])\+\d{1,3}[\s().-]{0,2}(?:\d[\s().-]?){6,14}\d(?![\p{L}\p{N}])/gu;
const PHONE_RU = /(?<![\p{L}\p{N}])(?:\+7|8)[\s(-]?\d{3}[\s)-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?![\p{L}\p{N}])/gu;
const PHONE_US = /(?<![\p{L}\p{N}])\(?\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}(?![\p{L}\p{N}])/gu;
const PHONE_PLAIN = /(?<![\p{L}\p{N}])\d{10,15}(?![\p{L}\p{N}])/gu;
const PHONE_LABEL =
  /(?:phone|tel|telephone|mobile|cell|call|whatsapp|telegram|телефон|тел|мобильный|моб|позвони|ватсап|телеграм)\s*(?:number|no\.?|:|=)?\s*(\+?[\d][\d\s().-]{5,20})/giu;
const LONG_NUMBER = /(?<![\p{L}\p{N}])\d{9,}(?![\p{L}\p{N}])/gu;

const ADDRESS_EN =
  /(?<![\p{L}\p{N}])\d{1,5}\s+[\p{L}][\p{L}\p{N} .'-]{2,40}?\s+(?:street|st|avenue|ave|road|rd|boulevard|blvd|lane|ln|drive|dr|court|ct|way|place|pl)\b[^\n,]{0,40}/giu;
const ADDRESS_RU =
  /(?<![\p{L}\p{N}])(?:ул(?:ица)?\.?|проспект|пр-т|переулок|пер\.?|шоссе|бульвар|набережная|наб\.?)\s+[\p{L}][\p{L}\p{N} .'-]{2,40}(?:,\s*(?:д(?:ом)?\.?\s*)?\d{1,5})?(?:,\s*(?:кв(?:артира)?\.?\s*)?\d{1,5})?/giu;
const HOME_PATH =
  /(?:[A-Za-z]:[\\/]Users[\\/]|[\\/]home[\\/]|[\\/]Users[\\/])([^\\/\s"'<>]+)/gi;

const MONTHS_EN =
  "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:tember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
const MONTHS_RU = "января|февраля|марта|апреля|мая|июня|июля|августа|сентября|октября|ноября|декабря";
const DATE = new RegExp(
  String.raw`(?<![\p{L}\p{N}])(?:\d{1,2}[./-]\d{1,2}[./-]\d{2,4}|\d{4}-\d{2}-\d{2}|\d{1,2}\s+(?:${MONTHS_RU})\s+\d{4}|(?:${MONTHS_EN})\.?\s+\d{1,2},?\s+\d{4}|\d{1,2}\s+(?:${MONTHS_EN})\.?,?\s+\d{4})(?![\p{L}\p{N}])`,
  "giu",
);
const BIRTH_LABEL = /(?:born|birth(?:day|date)?|d\.?o\.?b\.?|date of birth|родил(?:ся|ась)|дата рождения|день рождения)/iu;
const YEAR_ONLY = /(?<![\p{L}\p{N}])(?:19|20)\d{2}(?![\p{L}\p{N}])/gu;

const NICKNAME =
  /(?:nickname|nick|alias|handle|call me|ник(?:нейм)?|псевдоним|зови меня)\s*(?:is|are|:|=|-)?\s*(?:["«“']([^"»”'\n]{1,40})["»”']|([\p{Lu}][\p{L}\p{N}_-]{1,29}))/giu;
const ID_LABEL =
  /(?:account|acct|passport|licen[cs]e|ssn|social security|identifier|номер|счёт|счет|паспорт|аккаунт|инн|снилс|удостоверение)\s*(?:number|no\.?|#|№|:|=)?\s*(\d[\d -]{4,24})/giu;

const PRIORITY = {
  EMAIL: 0,
  CARD: 1,
  IBAN: 2,
  SSN: 3,
  PHONE: 4,
  IP: 5,
  ADDRESS: 6,
  USERNAME: 6,
  DATE: 7,
  NICKNAME: 8,
  ID: 9,
  PERSON: 100,
};

function luhn(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (alt) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function validIban(raw) {
  const s = raw.replace(/ /g, "").toUpperCase();
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(s)) return false;
  const rearranged = s.slice(4) + s.slice(0, 4);
  let rem = 0;
  for (const ch of rearranged) {
    const isDigit = ch >= "0" && ch <= "9";
    const value = isDigit ? Number(ch) : ch.charCodeAt(0) - 55;
    rem = (rem * (isDigit ? 10 : 100) + value) % 97;
  }
  return rem === 1;
}

function digitCount(s) {
  return (s.match(/\d/g) ?? []).length;
}

function validPhone(s) {
  const n = digitCount(s);
  return n >= 7 && n <= 15;
}

function validIpv4(s) {
  return s.split(".").every((part) => Number(part) <= 255);
}

function trimSpan(span, text) {
  let end = span.end;
  while (end > span.start && /[\s.,;:!?]/.test(text[end - 1])) end--;
  return { ...span, end, value: text.slice(span.start, end) };
}

function addMatches(re, type, text, out, validate) {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    if (m[0].length === 0) {
      re.lastIndex++;
      continue;
    }
    if (validate && !validate(m[0], m.index)) continue;
    out.push(trimSpan({ start: m.index, end: m.index + m[0].length, type, value: m[0] }, text));
  }
}

function addGroup(re, type, group, text, out, validate) {
  re.lastIndex = 0;
  for (let m = re.exec(text); m; m = re.exec(text)) {
    const value = m[group];
    if (!value) continue;
    if (validate && !validate(value)) continue;
    const offset = m[0].lastIndexOf(value);
    if (offset < 0) continue;
    const start = m.index + offset;
    out.push(trimSpan({ start, end: start + value.length, type, value }, text));
  }
}

export function detectRegex(text, detectors = {}) {
  const out = [];
  const on = (name) => detectors[name] !== false;

  if (on("email")) addMatches(EMAIL, "EMAIL", text, out);
  if (on("card")) {
    addMatches(CARD, "CARD", text, out, (v) => {
      const d = v.replace(/\D/g, "");
      return d.length >= 13 && d.length <= 19 && luhn(d);
    });
  }
  if (on("iban")) addMatches(IBAN, "IBAN", text, out, validIban);
  if (on("ssn")) addMatches(SSN, "SSN", text, out);
  if (on("phone")) {
    addMatches(PHONE_INTL, "PHONE", text, out, validPhone);
    addMatches(PHONE_RU, "PHONE", text, out, validPhone);
    addMatches(PHONE_US, "PHONE", text, out, validPhone);
    addMatches(PHONE_PLAIN, "PHONE", text, out, validPhone);
    addGroup(PHONE_LABEL, "PHONE", 1, text, out, validPhone);
  }
  if (on("ip")) addMatches(IPV4, "IP", text, out, validIpv4);
  if (on("address")) {
    addMatches(ADDRESS_EN, "ADDRESS", text, out);
    addMatches(ADDRESS_RU, "ADDRESS", text, out);
  }
  if (on("username")) addGroup(HOME_PATH, "USERNAME", 1, text, out);

  if (on("date")) {
    addMatches(DATE, "DATE", text, out, (value, start) => {
      const from = Math.max(0, start - 50);
      const to = Math.min(text.length, start + value.length + 50);
      return BIRTH_LABEL.test(text.slice(from, to));
    });
    addMatches(YEAR_ONLY, "DATE", text, out, (value, start) => {
      const from = Math.max(0, start - 25);
      const to = Math.min(text.length, start + value.length + 25);
      return BIRTH_LABEL.test(text.slice(from, to));
    });
  }

  if (on("nickname")) {
    addGroup(NICKNAME, "NICKNAME", 1, text, out);
    addGroup(NICKNAME, "NICKNAME", 2, text, out);
  }
  if (on("id")) {
    addGroup(ID_LABEL, "ID", 1, text, out, (v) => {
      const n = digitCount(v);
      return n >= 5 && n <= 25;
    });
  }
  if (on("number")) addMatches(LONG_NUMBER, "ID", text, out);

  return dedupe(out);
}

export function dedupe(spans) {
  spans.sort(
    (a, b) =>
      (PRIORITY[a.type] ?? 50) - (PRIORITY[b.type] ?? 50) ||
      b.end - b.start - (a.end - a.start) ||
      a.start - b.start,
  );
  const kept = [];
  for (const span of spans) {
    if (span.start >= span.end) continue;
    const overlaps = kept.some((k) => span.start < k.end && k.start < span.end);
    if (!overlaps) kept.push(span);
  }
  kept.sort((a, b) => a.start - b.start);
  return kept;
}

export function findWordSpans(text, words, type = "PERSON") {
  const out = [];
  for (const word of words) {
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`(?<![\\p{L}\\p{N}_])${escaped}(?![\\p{L}\\p{N}_])`, "gu");
    for (let m = re.exec(text); m; m = re.exec(text)) {
      out.push({ start: m.index, end: m.index + m[0].length, type, value: m[0] });
    }
  }
  if (type !== "PERSON") return out;

  out.sort((a, b) => a.start - b.start || b.end - b.start - (a.end - a.start));
  const merged = [];
  for (const span of out) {
    const prev = merged.at(-1);
    if (prev && span.start >= prev.end && /^\s+$/.test(text.slice(prev.end, span.start))) {
      prev.end = span.end;
      prev.value = text.slice(prev.start, prev.end);
    } else {
      merged.push({ ...span });
    }
  }
  return merged;
}
