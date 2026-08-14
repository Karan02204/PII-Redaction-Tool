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

const MONTHS = new Set([
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
]);
const BUSINESS_STOP = new Set([
  "Act",
  "Regulation",
  "Regulations",
  "Board",
  "Company",
  "Companies",
  "Limited",
  "Private",
  "Offer",
  "Prospectus",
  "Red",
  "Herring",
  "Book",
  "Built",
  "Stock",
  "Exchange",
  "Securities",
  "Capital",
  "Structure",
  "Risk",
  "Factors",
  "Financial",
  "Information",
  "Material",
  "Contracts",
  "Corporate",
  "Identity",
  "Number",
  "Office",
  "Contact",
  "Person",
  "Telephone",
  "Website",
  "Village",
  "Taluka",
  "District",
  "Pune",
  "Mumbai",
  "Maharashtra",
  "India",
  "Promoter",
  "Promoters",
  "Selling",
  "Shareholder",
  "Trust",
  "Family",
  "Management",
  "Participants",
  "Depository",
  "Infrastructure",
  "Pipeline",
  "Surveillance",
  "Measure",
  "Designated",
  "Intermediaries",
  "Syndicate",
  "Members",
  "Systemically",
  "Hospital",
  "Institutional",
  "Buyers",
  "Qualified",
  "Chartered",
  "Engineer",
  "Borrower",
  "Fraudulent",
  "Mechanism",
  "Redressal",
  "Complaints",
  "Registrar",
  "Agreement",
  "Circulars",
  "Locations",
  "Specified",
  "Allotment",
  "Identification",
  "Director",
  "Economic",
  "Fugitive",
  "Central",
  "Electricity",
  "Regulatory",
  "Monetization",
  "National",
  "Purchase",
  "Renewable",
  "Obligations",
  "Payment",
  "Directors",
  "Independent",
  "Activities",
  "Responsibility",
  "Coordinator",
  "Application",
  "Supported",
  "Fund",
  "Issue",
  "Documents",
  "Inspection",
  "General",
  "Summary",
  "Objects",
  "Basis",
  "Price",
  "Industry",
  "Overview",
  "Business",
  "History",
  "Key",
  "Policies",
  "Statement",
  "Benefits",
  "Tax",
  "Provisions",
  "Articles",
  "Association",
  "SEBI",
  "BSE",
  "NSE",
  "ICDR",
  "UPI",
  "BRLM",
  "KSH",
  "INTERNATIONAL",
  "LIMITED",
  "WEBSITE",
  "TELEPHONE",
  "EMAIL",
  "MAIL",
  "Dated",
  "Please",
  "Read",
  "Section",
  "Built",
  "Type",
  "Size",
  "Fresh",
  "Sale",
  "Total",
  "Eligibility",
  "Reservation",
  "Among",
  "QIBs",
  "NIIs",
  "RIIs",
  "Equity",
  "Shares",
  "Face",
  "Value",
  "Million",
  "Regulation",
  "Public",
  "Details",
  "Offer",
  "For",
  "And",
  "The",
  "Our",
  "Inc",
  "Ltd",
  "Tower",
  "Centre",
  "Business",
  "Centre",
]);

function isValidPerson(name) {
  const t = name.trim().replace(/\s+/g, " ");
  if (t.length < 6 || t.length > 60) return false;
  const words = t.split(" ");
  if (words.length < 2 || words.length > 4) return false;
  // reject if any word is business/month
  for (let w of words) {
    const clean = w.replace(/[^A-Za-z]/g, "");
    if (!clean) return false;
    if (BUSINESS_STOP.has(clean)) return false;
    if (MONTHS.has(clean)) return false;
    if (clean.length < 3) return false; // avoid initials
    if (clean.length > 20) return false;
    // must be capitalized properly
    if (!/^[A-Z][a-z]+$/.test(clean) && !/^[A-Z]+$/.test(clean)) return false;
    if (/^[A-Z]+$/.test(clean) && clean.length <= 2) return false;
  }
  // must have at least 2 title-case words
  const titleCase = words.filter((w) => /^[A-Z][a-z]+$/.test(w)).length;
  if (titleCase < 2) return false;
  // reject if contains digits or symbols
  if (/\d/.test(t) || /[●®©]/.test(t)) return false;
  return true;
}

function extractNames(text) {
  // Use compromise only, plus manually curated promoter names from doc
  const doc = nlp(text);
  let people = doc.people().out("array");
  // Add known promoter pattern: uppercase 2-3 words that are near "PROMOTER" or "HEGDE" "SHETTY"
  const upperPromoters = [
    ...text.matchAll(
      /\b(?:[A-Z]{2,}\s+){1,2}(?:HEGDE|SHETTY|MALVADKAR|SHAH|SARKAR|RASTOGI|DIWAN|GOPALKRISHNAN|BORICHA|PARAB)\b/g,
    ),
  ].map((m) => m[0]);
  // Convert to title case
  const titlePromoters = upperPromoters.map((n) =>
    n
      .split(" ")
      .map((w) => w.charAt(0) + w.slice(1).toLowerCase())
      .join(" "),
  );
  const combined = [...new Set([...people, ...titlePromoters])];
  const filtered = combined.filter(isValidPerson);
  // Deduplicate case-insensitively, keep longest
  const seen = new Set();
  const result = [];
  filtered.sort((a, b) => b.length - a.length);
  for (let n of filtered) {
    const low = n.toLowerCase();
    if (seen.has(low)) continue;
    seen.add(low);
    result.push(n);
  }
  return result;
}

function extractCompanies(text) {
  const pattern =
    /\b[A-Z][A-Za-z0-9& ]{3,60}?\s+(?:International\s+Limited|Wealth Management Limited|Securities Limited|Private Limited|Limited|Ltd|LLP|Inc|Corporation)\b/g;
  const raw = [...text.matchAll(pattern)]
    .map((m) => m[0].replace(/\s+/g, " ").trim())
    .filter((m) => m.length > 10 && m.length < 80);
  // Filter out those that are actually person names or generic
  const filtered = raw.filter((c) => {
    if (BUSINESS_STOP.has(c.split(" ")[0])) return false;
    if (
      c.includes("Book Built") ||
      c.includes("Red Herring") ||
      c.includes("Offer")
    )
      return false;
    return true;
  });
  return [...new Set(filtered)];
}

function extractAddresses(text) {
  const lines = text
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.length >= 20 && l.length <= 250);
  const addr = [];
  for (let line of lines) {
    if (line.includes("@")) continue;
    const hasVillage =
      /(Village|Taluka|Birdewadi|Chakan|Pune|Mumbai|Maharashtra|Bandra|Kurla|Vikhroli|Baner|Business Centre|Tower|Floor|Building)/i.test(
        line,
      );
    const hasNum = /\d/.test(line);
    const hasComma = line.includes(",");
    const isAddressLike =
      hasVillage && hasNum && hasComma && line.split(" ").length >= 5;
    if (isAddressLike) {
      // Exclude if it's just phone/email line
      if (!/^(Email|Telephone|Website)/i.test(line)) {
        addr.push(line);
      }
    }
  }
  // PIN block
  const pinBlocks = [
    ...text.matchAll(
      /[A-Za-z0-9\/,\- ]{20,150}\b(?:410\s*501|411\s*045|400\s*051|400\s*025|400\s*083|400\s*042|400\s*020)\b[^\n]{0,30}/g,
    ),
  ].map((m) => m[0].trim());
  return [...new Set([...addr, ...pinBlocks])].slice(0, 30);
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

function makeFlexibleRegex(str) {
  const esc = str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(esc.replace(/\\\s+/g, "\\s+").replace(/\s+/g, "\\s+"), "g");
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

  // 7 COMPANY
  const comps = extractCompanies(original);
  comps.sort((a, b) => b.length - a.length);
  for (const c of comps) {
    if (!text.includes(c.split(" ")[0])) continue; // rough check
    // flexible space match
    try {
      const re = makeFlexibleRegex(c);
      if (re.test(text)) {
        const f = getFake(CACHE.companies, c, fakeGen.company);
        text = text.replace(re, f);
        repl.push({ type: "COMPANY", original: c, fake: f });
      }
    } catch (e) {}
  }

  // 8 ADDRESS
  const addrs = extractAddresses(original);
  addrs.sort((a, b) => b.length - a.length);
  for (const a of addrs) {
    if (a.length < 15) continue;
    if (!original.includes(a.substring(0, 20))) continue;
    const f = getFake(CACHE.addresses, a, fakeGen.address);
    const esc = a
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(/\s+/g, "\\s+");
    try {
      const re = new RegExp(esc, "g");
      text = text.replace(re, f);
      repl.push({
        type: "ADDRESS",
        original: a.slice(0, 80),
        fake: f.slice(0, 80),
      });
    } catch (e) {}
  }

  // 9 PERSON
  const names = extractNames(original);
  names.sort((a, b) => b.length - a.length);
  for (const n of names) {
    // Title case version
    const f = getFake(CACHE.names, n, fakeGen.name);
    const esc = n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const re = new RegExp(`\\b${esc}\\b`, "g");
    if (re.test(text)) {
      text = text.replace(re, f);
      repl.push({ type: "PERSON", original: n, fake: f });
    }
    // Also uppercase version
    const upper = n.toUpperCase();
    if (original.includes(upper)) {
      const fUpper = f.toUpperCase();
      const escUpper = upper.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const reUp = new RegExp(`\\b${escUpper}\\b`, "g");
      text = text.replace(reUp, fUpper);
      // avoid duplicate push if already counted
      if (!repl.find((r) => r.original === upper)) {
        repl.push({ type: "PERSON", original: upper, fake: fUpper });
      }
    }
  }

  const byType = repl.reduce((acc, r) => {
    acc[r.type] = (acc[r.type] || 0) + 1;
    return acc;
  }, {});
  return {
    redactedText: text,
    report: { total: repl.length, byType },
    replacements: repl,
  };
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
