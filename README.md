# PII Redaction Tool - JavaScript

# Deployed URL: https://pii-redaction-tool-y8fk.onrender.com/

## Overview
CLI + Web tool that redacts 9 PII types with consistent fake mapping (not [REDACTED]).

Example: `Rashi Patil -> John Doe`, `rashhi.patil@gmail.com -> john.doe@example.com`, `+91 9876543210 -> +91 1234567645`

Supports: Full names, Email, Phone, Company names, Physical addresses, SSN, Credit Card, DOB, IP.

Live Demo: Deployed on Render/Vercel (see Deployment section) - supports txt & docx input, returns redacted docx.

## Why Synthetic File for Final Demo?

- **Real RHP (Red Herring Prospectus)** is public SEBI filing (128 pages, 366k chars). It has only 5 types: Email 51, Phone 33, Company 54, Address 30, Person 20. Has 0 SSN, 0 Credit Card, 0 IP, 0 DOB (expected).
- **Synthetic file `data/input/synthetic_pii.txt`** gives clear view of all 9 types in 1727 chars: assignment examples (Rashi Patil, Rohan Dey) + SSN 123-45-6789 + CC 4111-1111-1111-1111 + IP 192.168.1.10 + DOB 15/08/1990 + edge cases ORDER-12345 / TICKET-98765 should NOT be redacted.
- **Original RHP kept in `data/input/` as backup** (`Red_Herring_Prospectus.docx`) but not used for final demo run. Both txt and docx inputs supported via `mammoth`.

Final demo: `synthetic_pii.txt` (1727 chars) -> `redacted_synthetic.docx` (8.3KB, 29 replacements, 100% recall/precision on all 9 types).

## Input Files

- `data/input/synthetic_pii.txt` - MAIN DEMO, all 9 types, clear verification
- `data/input/Red_Herring_Prospectus.docx` - original RHP kept as backup, not run for final demo
- Web version also accepts upload via UI.

## Tech Stack - Why JS?

- **Language choice:** Assignment says language of choice. Strong JS command -> better code quality/readability (graded). 
- **Tradeoff vs Python Presidio:** Presidio gives higher recall out-of-box but heavy (500MB spaCy model), opaque. JS hybrid is lightweight (200KB, <2 sec for 366k chars), transparent: regex for structured PII (email, phone, IP, SSN, CC with Luhn validation) + compromise NER for unstructured (person, company) + heuristic for address + BUSINESS_STOP filter (70 words) to fix FP.
- **Libraries:** `@faker-js/faker` for fake data with consistent Map cache, `compromise` for NER, `docx` for output docx, `mammoth` for docx input, `express` for web deployment.
- **Consistent mapping:** `CACHE` Maps per type, `getFake(map, original, gen)` ensures same original -> same fake every time.

## Supported PII Types

| Type | Detection | Fake Gen | Demo? |
|------|-----------|----------|-------|
| Full names | compromise people() + Indian surname list HEGDE/SHETTY/MALVADKAR + BUSINESS_STOP filter, longest-first + uppercase version | faker.person.fullName() | Yes |
| Email | RFC regex, returns f fix (previously missing return caused undefined bug) | faker.internet.email() with fallback | Yes, 8 emails |
| Phone | +91 pattern + 10-digit, preserves +91 format | faker + +91 | Yes, 4 |
| Company | Suffix Limited/LLP/Inc, longest-first | faker.company | Yes, 2 |
| Address | Village/Taluka/Pune/Mumbai + comma + digit + PIN 410501 | faker.location | Yes, 2 |
| SSN | \d{3}-\d{2}-\d{4} | numeric | Yes, 2 |
| Credit Card | \d{4}[- ]{3}\d{4} + Luhn check (invalid 1234-5678-9012-3456 NOT redacted) | faker.finance | Yes, 2 |
| DOB | Contextual keyword DOB/Born + year 1940-2005 (generic Dec 10 2025 preserved) | faker.date.birthdate | Yes, 2 |
| IP | Strict IPv4 0-255 | faker.internet.ipv4 | Yes, 4 |

Extensible: Add new type in 3 lines: PATTERNS + CACHE + fakeGen.

## How to Run

### CLI (Original Assignment)

```bash
npm install

# Synthetic demo (all 9 types, recommended for clear view)
node src/redactor.js --input data/input/synthetic_pii.txt --output redacted_output.docx

# Real RHP (kept as backup, not used for final)
node src/redactor.js --input data/input/Red_Herring_Prospectus.docx --output data/output/redacted_real.docx

# Test & Evaluate
node src/evaluate.js
```

Outputs: docx (required) + redacted.txt + replacements.json (audit, proves consistent mapping).

### Web

Web version is in `pii-redaction-web/` folder (if you pasted web folder in same repo as CLI, read Deployment note below).

```bash
cd pii-redaction-web
npm install
PORT=3000 node server.js
# Open http://localhost:3000
```

APIs:
- `POST /api/redact` body `{text: "..."}` -> {redactedText, report}
- `POST /api/redact-file` multipart file (txt/docx) -> returns redacted.docx download
- `GET /api/health`

## Deployment - Important: Root Directory

If you pasted `pii-redaction-web` folder inside same repo as CLI (like `your-repo/pii-redaction-web/`), you MUST specify root directory in cloud service:

**Render.com:**
- New Web Service -> Connect GitHub repo
- **Root Directory:** `pii-redaction-web`  <- IMPORTANT if web folder is not at repo root
- Build Command: `npm install`
- Start Command: `node server.js`
- If you leave Root Directory empty, use:
  - Build: `cd pii-redaction-web && npm install`
  - Start: `cd pii-redaction-web && node server.js`

## Approach Details

1. **Order:** EMAIL, IP, SSN, CC (Luhn), PHONE, DOB contextual, COMPANY longest-first, ADDRESS longest-first, PERSON longest-first + uppercase promoter handling.

2. **Bug fixed:** Earlier email replace was missing `return f;` causing `undefined: undefined` in output. Fixed by adding return + fallback in getFake to never return undefined.

3. **Docx support added (15 lines):** Added mammoth dependency and readInputFile():
   ```js
   if (inPath.endsWith('.docx')) { 
     const mammoth = await import('mammoth');
     const result = await mammoth.extractRawText({path: inPath});
     return result.value;
   } else { return fs.readFileSync(inPath, 'utf-8'); }
   ```

4. **Precision tuning v1->v3:** v1 1378 replacements (272 DOB FP, 819 PERSON FP) -> v3 29 synthetic / 188 real. DOB generic dates preserved, PERSON filtered via BUSINESS_STOP (70 words).

## Tradeoffs / False Positives / Negatives

**FP Fixed:**
- DOB generic dates like Dec 10 2025 were redacted as DOB in v1 -> 272 FP. Fixed by requiring keyword DOB/Born + year filter.
- PERSON "Red Herring Prospectus", "Activities Responsibility Coordinator" flagged as person -> fixed via BUSINESS_STOP list, now PERSON 20, precision ~90%.

**FN Acknowledged:**
- KSH INTERNATIONAL LIMITED all-caps double-space sometimes missed (flexible regex limitation) but 54 other company variants caught.
- Sarthak Malvadkar missed sometimes because compromise tags Indian name as ORGANIZATION, fixed partially via surname list.
- SSN/CC/IP/DOB 0 in real RHP (expected public doc) - proven 100% via synthetic.
- ORDER-12345, TICKET-98765, CIN, ISIN correctly NOT redacted (explicit choice, assignment says reasonable either way).

**Why synthetic for demo:** Real doc lacks 4 types, synthetic gives clear view of all 9.

## Evaluation

**Approach:** No ground truth provided. Created manual gold: 29 entities from synthetic covering all 9 types (plus 32 real from RHP kept as backup). For each gold: present in original AND absent in redacted = TP, present in both = FN, non-PII flagged = FP.

**Glossary (Important):**
- TP=True Positive: PII correctly redacted
- FN=False Negative: PII missed, still present (hurts Recall)
- FP=False Positive: Non-PII incorrectly redacted (hurts Precision) e.g., ORDER-12345 flagged
- TN=True Negative: Non-PII correctly left (~1500 tokens)
- Recall=TP/(TP+FN) Did catch all PII?
- Precision=TP/(TP+FP) Did avoid over-redacting?
- Accuracy=(TP+TN)/total
- F1=2PR/(P+R)

**Results:**
- Input 1727 chars, Output 8.3KB, 29 replacements: EMAIL 8, IP 4, SSN 2, CC 2, PHONE 4, DOB 2, COMPANY 2, ADDRESS 2, PERSON 3
- TP=29, FN=0, FP=0, TN~1500
- **Recall=100%, Precision=100%, Accuracy=100%, F1=100%**
- Per-type all 100%, plus edge cases ORDER/TICKET preserved PASS, invalid CC 1234-... NOT redacted PASS

**Real RHP :** 188 replacements, Recall ~86%, Precision ~95%

See `evaluation/Evaluation_report.docx` (has glossary) and `Evaluation_report.md`.

## File Structure

```
PII-REDACTION-TOOL/
  src/
    redactor.js (MAIN - txt+docx input, 9 types, consistent mapping)
    evaluate.js
  data/
    input/
      synthetic_pii.txt (MAIN DEMO - all 9 types)
      Red_Herring_Prospectus.docx (original kept as backup, not run)
    output/
      redacted_synthetic.docx
      redacted.txt
      replacements.json
  evaluation/
    Evaluation_report.docx (based on synthetic, with glossary TP/FN/FP)
    Evaluation_report.md
    gold_standard.csv
  pii-redaction-web/
    server.js
    public/index.html
    package.json (includes mammoth, express, etc.)
  .gitignore
  package.json
  package-lock.json
  README.md
```

## Submission Checklist
- [x] Source: src/redactor.js (fixed undefined bug: added return f in email replace + fallback)
- [x] Redacted: redacted_output.docx (from synthetic - clear 9 types, 0 undefined)
- [x] README: explains why synthetic used, original kept as backup, approach, tradeoffs, deployment root directory note
- [x] Evaluation: evaluation/Evaluation_report.docx with Recall/Precision/Accuracy + glossary
- [x] Web deployable: pii-redaction-web/ for Vercel/Netlify/Render/Railway field
