/** 
 Approach: Hybrid regex + compromise NER + Faker with consistent mapping 
*/

import fs from "fs";
import nlp from "compromise";
import { faker } from "@faker-js/faker";
import { Document, Packer, Paragraph, TextRun } from "docx";

const CACHE = {
  names: new Map(),
  emails: new Map(),
  phones: new Map(),
  companies: new Map(),
  addresses: new Map(),
  ssns: new Map(),
  creditCards: new Map(),
  dobs: new Map(),
  ips: new Map(),
};

function getFake(map, original, gen) {
  const key = original.trim();
  if (!key) return original;
  if (map.has(key)) return map.get(key);
  const fake = gen();
  map.set(key, fake);
  return fake;
}

const fakeGen = {
  name: () => faker.person.fullName(),
  email: () => faker.internet.email().toLowerCase(),
  phone: (orig) =>
    orig.includes("91")
      ? `+91 ${faker.string.numeric(2)} ${faker.string.numeric(4)} ${faker.string.numeric(4)}`
      : faker.string.numeric(10),
  company: () =>
    `${faker.company.name()} ${faker.helpers.arrayElement(["Limited", "Private Limited", "LLP", "Management Limited"])}`,
  address: () =>
    `${faker.location.streetAddress()}, ${faker.location.city()}, ${faker.location.state()} - ${faker.location.zipCode("######")}, India`,
  ssn: () =>
    `${faker.string.numeric(3)}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`,
  creditCard: () => faker.finance.creditCardNumber("####-####-####-####"),
  dob: () =>
    faker.date
      .birthdate({ min: 25, max: 65, mode: "age" })
      .toLocaleDateString("en-GB"),
  ip: () => faker.internet.ipv4(),
};

// ====== PATTERNS ======
const PATTERNS = {
  email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  ip: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:\d{4}[\s\-]){3}\d{4}\b/g,
  phone:
    /(?:\+91[\s\-]*\(?\d{2,5}\)?[\s\-]*\d{3,5}[\s\-]*\d{4,6})|(?:Telephone\s*:\s*\+?\s*91?[\d\s\-]{7,})|\b\d{10}\b/g,
};

function luhnCheck(s) {
  const d = s.replace(/\D/g, "");
  if (d.length < 13 || d.length > 19) return false;
  let sum = 0,
    dbl = false;
  for (let i = d.length - 1; i >= 0; i--) {
    let v = parseInt(d[i]);
    if (dbl) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
    dbl = !dbl;
  }
  return sum % 10 === 0;
}

function extractDOBs(text) {
  const results = [];
  const regex =
    /(?:DOB|Date of Birth|Birth Date|Born on)[^0-9\n]{0,30}(\d{1,2}[\/\-]\d{1,2}[\/\-]\d{2,4})/gi;
  let m;
  while ((m = regex.exec(text)) !== null) {
    const y = m[1].match(/(19\d{2}|20[0-2]\d)/);
    if (y) {
      const yr = parseInt(y[1]);
      if (yr >= 1940 && yr <= 2005) results.push(m[0]);
    }
  }
  return [...new Set(results)];
}

function readactText(original) {
  let text = original;
  const repl = [];

  // 1 Email
  text = text.replace(PATTERNS.email, (m) => {
    const f = getFake(CACHE.emails, m, fakeGen.email);
    repl.push({ type: "EMAIL", original: m, fake: f });
  });

  // 2 IP
  text = text.replace(PATTERNS.ip, (m) => {
    const f = getFake(CACHE.ips, m, fakeGen.ip);
    repl.push({ type: "IP_ADDRESS", original: m, fake: f });
    return f;
  });

  // 3 SSN
  text = text.replace(PATTERNS.ssn, (m) => {
    const f = getFake(CACHE.ssns, m, fakeGen.ssn);
    repl.push({ type: "SSN", original: m, fake: f });
    return f;
  });

  // 4 CREDIT CARD
  text = text.replace(PATTERNS.creditCard, (m) => {
    if (!luhnCheck(m)) return m;
    const f = getFake(CACHE.creditCards, m, fakeGen.creditCard);
    repl.push({ type: "CREDIT_CARD", original: m, fake: f });
    return f;
  });

  // 5 PHONE
  text = text.replace(PATTERNS.phone, (m) => {
    const digits = m.replace(/\D/g, "");
    if (digits.length < 10 || digits.length > 13) return m;
    if (/^\d{6}$/.test(digits)) return m; // PIN
    const cleaned = m.replace(/\s+/g, " ").trim().slice(0, 50);
    const f = getFake(CACHE.phones, cleaned, () => fakeGen.phone(cleaned));
    repl.push({ type: "PHONE", original: cleaned, fake: f });
    return f;
  });

  // 6 DOB contextual
  const dobs = extractDOBs(original);
  for (const d of dobs) {
    const esc = d.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const f = getFake(CACHE.dobs, d, fakeGen.dob);
    text = text.replace(new RegExp(esc, "g"), f);
    repl.push({ type: "DOB", original: d, fake: f });
  }
}

function parseArgs() {
  const a = process.argv.slice(2);
  const r = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i] === "--input") r.input = a[i + 1];
    if (a[i] === "--output") r.output = a[i + 1];
  }
  return r;
}

async function main() {
  const { input, output } = parseArgs();
  const inPath = input;
  const outPath = output;
  if (!fs.existsSync(inPath)) {
    console.error("Input missing " + inPath);
    process.exit(1);
  }

  const orig = fs.readFileSync(inPath, "utf-8");
  console.log(`Input ${orig.length} chars`);
}

main().catch(console.error);
