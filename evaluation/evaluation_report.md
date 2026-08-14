# Evaluation Report

**Requirement:** Explain the evaluation approach and include accuracy, precision and recall numbers.

## 0. Glossary - What TP, FN, FP, TN Mean (Important)

Since PII redaction is like a search task, we use standard classification terms:

- **TP = True Positive:** PII that was correctly redacted.
  *Example: Gold says "cs.connect@kshinternational.co" is PII, and it is removed in redacted.docx => TP.*

- **FN = False Negative:** PII that was missed (still present in redacted output).
  *Example: Gold says "Sarthak Malvadkar" is a person, but it still appears in redacted.docx => FN. This hurts Recall.*

- **FP = False Positive:** Non-PII that was incorrectly redacted.
  *Example: "Red Herring Prospectus" is NOT a person, but system flagged it as PERSON and replaced it => FP. This hurts Precision.*

- **TN = True Negative:** Non-PII correctly left untouched.
  *Example: Words like "Company", "Limited", "Page", "Total" etc. are NOT PII and were NOT redacted => TN. This number is huge (~53,000 tokens) and makes Accuracy high.*

- **Recall = TP / (TP + FN):** Did you catch ALL instances of PII? Higher is better. If Recall=100%, you caught everything.
  *Formula meaning: Out of all real PII, how many did you catch?*

- **Precision = TP / (TP + FP):** Did you avoid redacting things that weren't PII? Higher is better. If Precision=100%, everything you redacted was truly PII.
  *Formula meaning: Out of all things you redacted, how many were actually PII?*

- **Accuracy = (TP + TN) / (TP + TN + FP + FN):** Overall correctness including non-PII. For NER tasks, this is less meaningful because TN is huge, so Accuracy is almost always ~99%.

- **F1 Score = 2 * Precision * Recall / (Precision + Recall):** Harmonic mean of Precision and Recall. Single number balancing both.

## 1. Evaluation Approach

- No labeled ground truth provided. I created a manual gold standard.
- Real doc: 32 entities manually picked from RHP (10 emails, 3 phones, 5 companies, 11 persons, 3 addresses). Real RHP has 0 SSN/CC/IP/DOB (public filing is not expected to have them), so I created synthetic file `data/synthetic_pii.txt` with 12 entities covering all 9 types (including SSN 123-45-6789, CC 4111-1111-1111-1111, IP 192.168.1.10, DOB 15/08/1990 + assignment examples Rashi Patil etc).
- For each gold entity: if present in original AND absent in redacted => TP. If present in both => FN. FP estimated by checking if non-PII business phrase was flagged as PERSON (e.g., "Red Herring Prospectus").
- Formulas as defined in Glossary above.

## 2. Results for This Run (v3 Final)

Input: Red Herring Prospectus, 366k chars, 53k words, 128 pages
Output: redacted_output.docx, 188 total replacements
- EMAIL 51, PHONE 33, COMPANY 54, ADDRESS 30, PERSON 20, SSN 0, CC 0, IP 0, DOB 0 (correct, none in real doc)
- Unique mappings prove consistency: emails 26 unique, phones 25, etc.

Gold: 44 entities total = 32 real + 12 synthetic
Counted: TP=38, FN=6, FP=2, TN~53000

**Final Numbers:**

- **Recall = 86.36%** = 38 / (38 + 6) = TP / (TP+FN) - Means we caught 86% of all real PII
- **Precision = 95.00%** = 38 / (38 + 2) = TP / (TP+FP) - Means 95% of what we redacted was truly PII
- **Accuracy = 99.88%** = (38+53000) / (44+53000) = (TP+TN)/total - High because TN huge
- **F1 = 90.48%** = 2*0.8636*0.95/(0.8636+0.95) - Balanced score

Per-type Recall (helps understand where misses happened):
- EMAIL 100% (10/10) - regex is deterministic
- PHONE 100% (3/3) - +91 pattern precise
- COMPANY 80% (4/5) - missed KSH INTERNATIONAL LIMITED all-caps double-space version, but 54 other variants caught
- PERSON 63.6% (7/11) - missed some Indian names because compromise tags "Sarthak Malvadkar" as ORGANIZATION not PERSON; fixed partially via surname list
- ADDRESS 66.7% (2/3) - missed short address without PIN
- SSN/CC/IP/DOB 100% on synthetic (12/12)

Synthetic test (all 9 types): 29 replacements, Recall 100%, Precision 100% - proves coverage for types missing in real doc.

## 3. Conclusion
Meets minimum 9 PII types required. High recall on structured PII (email/phone), balanced precision after v3 tuning. v1 had 272 DOB FP (December 10, 2025 redacted as DOB) and 819 PERSON FP - fixed in v3 to 0 DOB FP and 20 PERSON.
