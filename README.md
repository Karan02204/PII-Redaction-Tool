# PII Redaction Tool - JavaScript

# Deployed URL: https://pii-redaction-tool-y8fk.onrender.com/

## Overview
CLI + Web tool that redacts 9 PII types with consistent fake mapping.

Example: `Rashi Patil -> John Doe`, `rashhi.patil@gmail.com -> john.doe@example.com`, `+91 9876543210 -> +91 1234567645`

Supports: Full names, Email, Phone, Company names, Physical addresses, SSN, Credit Card, DOB, IP.

Live Demo: Deployed on Render/Vercel (see Deployment section) - supports txt & docx input, returns redacted docx.

**Glossary (Important):**
- TP=True Positive: PII correctly redacted
- FN=False Negative: PII missed, still present (hurts Recall)
- FP=False Positive: Non-PII incorrectly redacted (hurts Precision) e.g., ORDER-12345 flagged
- TN=True Negative: Non-PII correctly left (~1500 tokens)
- Recall=TP/(TP+FN) Did catch all PII?
- Precision=TP/(TP+FP) Did avoid over-redacting?
- Accuracy=(TP+TN)/total
- F1=2PR/(P+R)

## Why Synthetic File for Final Demo?

- **Real RHP (Red Herring Prospectus)** is public SEBI filing (128 pages, 366k chars). It has only 5 types: Email 51, Phone 33, Company 54, Address 30, Person 20. Has 0 SSN, 0 Credit Card, 0 IP, 0 DOB (expected).
- **Synthetic file `data/input/synthetic_pii.txt`** gives clear view of all 9 types in 1727 chars: assignment examples (Rashi Patil, Rohan Dey) + SSN 123-45-6789 + CC 4111-1111-1111-1111 + IP 192.168.1.10 + DOB 15/08/1990 + edge cases ORDER-12345 / TICKET-98765 should NOT be redacted.
- **Original RHP kept in `data/input/` as backup** (`Red_Herring_Prospectus.docx`) but not used for final demo run. Both txt and docx inputs supported via `mammoth`.

Final demo: `synthetic_pii.txt` (1727 chars) -> `redacted_synthetic.docx` (8.3KB, 29 replacements, 100% recall/precision on all 9 types).

## Approach Details

I used a **hybrid regex + NER model + third-party library approach** in JavaScript (chosen as language of choice for better code quality, as assignment allows any language).

For **structured PII** (Email, Phone, IP, SSN, Credit Card, DOB) I used regex-based detection with validation: Email follows RFC pattern, Phone matches +91 and 10-digit, IP uses strict IPv4 0-255 validation, SSN is `\d{3}-\d{2}-\d{4}`, Credit Card uses `\d{4}[- ]{3}\d{4}` plus Luhn checksum to avoid false positives, DOB is contextual requiring keyword like DOB/Date of Birth/Born on plus year filter 1940-2005 so generic dates like "December 10, 2025" are not redacted.

For **unstructured PII** (Full names, Company names, Addresses) I used NER model `compromise` (lightweight JS alternative to spaCy) for people and organizations, plus custom heuristics: Company detection via suffix regex (Limited/LLP/Inc/Private Limited), Address detection via keywords (Village/Taluka/Pune/Mumbai) + comma + number + PIN pattern (410501). To handle Indian names that compromise misclassifies (e.g., "Sarthak Malvadkar" as ORGANIZATION), I added Indian surname list (HEGDE/SHETTY/MALVADKAR) and a BUSINESS_STOP list of 70 business terms to filter non-persons.

For **fake generation** I used third-party library `@faker-js/faker` with consistent mapping via `Map` cache: same original PII always maps to same fake (e.g., `ksh.ipo@nuvama.com` -> same fake everywhere), as required by assignment example. Order is most-specific-first (EMAIL, IP, SSN, CC, PHONE, DOB) then COMPANY/ADDRESS/PERSON longest-first to avoid overlaps. File handling uses `mammoth` for docx input and `docx` library for docx output.

## Tradeoffs / False Positives / Negatives

**Tradeoffs:**
- Chose JavaScript over Python Presidio: Presidio gives higher recall out-of-box but heavy (500MB spaCy model) and opaque. JS hybrid is lightweight (200KB, <2 sec), transparent, easy to extend (add new PII type in 3 lines: PATTERNS + CACHE + fakeGen). Tradeoff: lower recall on Indian names vs transformer model, but better maintainability and meets assignment's code quality criteria.
- Favored precision after achieving acceptable recall: v1 had high recall but many FP (272 DOB FP, 819 PERSON FP), v3 reduced to 29 replacements with high precision (100% on synthetic). Assignment values Recall but also says avoid redacting Order/Ticket numbers.

**False Positives (Precision loss) - Fixed:**
- DOB: v1 used generic date regex `\d{1,2}[/-]\d{1,2}[/-]\d{4}` which flagged every date like "Dated December 10, 2025" (offer date) as DOB -> 272 FP. Fixed by requiring contextual keyword DOB/Born + year filter. Now generic dates preserved (precision win).
- PERSON: `compromise` flagged "Red Herring Prospectus", "Qualified Institutional Buyers", "Activities Responsibility Coordinator" as persons -> 819 FP. Fixed by BUSINESS_STOP list (70 business terms like Company, Limited, Offer, Prospectus, Village etc.) + title-case validation + month filter. Now PERSON 3 on synthetic, 20 on real doc, precision ~90-100%.
- Email: Earlier missing `return f;` in replace callback caused `undefined: undefined` output -> fixed by adding return and fallback to ensure never undefined.

**False Negatives (Recall loss) - Acknowledged:**
- Real RHP: "KSH INTERNATIONAL LIMITED" all-caps with double spaces sometimes missed due to flexible space regex limitation, but 54 other company variants caught -> Company recall 80% on real doc.
- "Sarthak Malvadkar" sometimes missed because compromise labels Indian name as ORGANIZATION not PERSON, fixed partially via surname list, 1-2 misses remain -> Person recall 63.6% real, 100% synthetic.
- Short addresses without PIN/comma missed to keep precision high -> Address recall 66.7% real, 100% synthetic.
- SSN/CC/IP/DOB are 0 in real RHP (expected public doc) -> proven 100% via synthetic file `synthetic_pii.txt`.
- Explicit non-redactions (precision wins, as assignment says reasonable either way): ORDER-12345, TICKET-98765, CIN, ISIN correctly NOT redacted, proven in synthetic test.

## Input Files

- `data/input/synthetic_pii.txt` - MAIN DEMO, all 9 types, clear verification
- `data/input/Red_Herring_Prospectus.docx` - original RHP kept as backup, not run for final demo
- Web version also accepts upload via UI.

## Tech Stack - Why JS?

- **Language choice:** Better code quality/readability. 
- **Tradeoff vs Python Presidio:** Presidio gives higher recall out-of-box but heavy (500MB spaCy model), opaque. JS hybrid is lightweight (200KB, <2 sec for 366k chars), transparent: regex for structured PII (email, phone, IP, SSN, CC with Luhn validation) + compromise NER for unstructured (person, company) + heuristic for address + BUSINESS_STOP filter (70 words) to fix False Positive(FP).
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

**Why synthetic for demo:** Real doc lacks 4 types, synthetic gives clear view of all 9.

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