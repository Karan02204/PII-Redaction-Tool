import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import nlp from 'compromise';
import { faker } from '@faker-js/faker';
import { Document, Packer, Paragraph, TextRun } from 'docx';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const upload = multer({ dest: 'uploads/' });

// === COPY OF REDACTOR LOGIC (same as your main tool) ===
const CACHE_FACTORY = () => ({
  names: new Map(), emails: new Map(), phones: new Map(),
  companies: new Map(), addresses: new Map(), ssns: new Map(),
  creditCards: new Map(), dobs: new Map(), ips: new Map()
});

function getFake(map, original, gen, cache) {
  const key = original.trim();
  if (!key) return original;
  if (map.has(key)) {
    const c = map.get(key);
    if (c) return c;
  }
  let fake;
  try { fake = gen(); } catch { fake = null; }
  if (!fake) {
    if (map === cache.emails) fake = `user${Math.floor(Math.random()*10000)}@example.com`;
    else fake = `REDACTED_${map.size+1}`;
  }
  map.set(key, fake);
  return fake;
}

const fakeGen = (CACHE) => ({
  name: () => faker.person.fullName() || 'John Doe',
  email: () => { try { const e=faker.internet.email(); return (e&&e.toLowerCase())||`user${Math.random()*10000}@example.com`; } catch { return `user${Math.random()*10000}@example.com`; } },
  phone: (orig) => { try { return orig.includes('91')?`+91 ${faker.string.numeric(2)} ${faker.string.numeric(4)} ${faker.string.numeric(4)}`:faker.string.numeric(10); } catch { return '+91 1234567890'; } },
  company: () => { try { return `${faker.company.name()} Limited`; } catch { return 'Acme Private Limited'; } },
  address: () => { try { return `${faker.location.streetAddress()}, ${faker.location.city()} - ${faker.location.zipCode('######')}, India`; } catch { return '123 Main Street, Mumbai - 400001, India'; } },
  ssn: () => `${faker.string.numeric(3)}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`,
  creditCard: () => { try { return faker.finance.creditCardNumber('####-####-####-####'); } catch { return '4111-1111-1111-1111'; } },
  dob: () => { try { return faker.date.birthdate({min:25,max:65,mode:'age'}).toLocaleDateString('en-GB'); } catch { return '01/01/1990'; } },
  ip: () => { try { return faker.internet.ipv4(); } catch { return '192.168.1.1'; } }
});

const PATTERNS = {
  email: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  ip: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  ssn: /\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard: /\b(?:\d{4}[\s\-]){3}\d{4}\b/g,
  phone: /(?:\+91[\s\-]*\(?\d{2,5}\)?[\s\-]*\d{3,5}[\s\-]*\d{4,6})|(?:Telephone\s*:\s*\+?\s*91?[\d\s\-]{7,})|\b\d{10}\b/g,
};

function luhnCheck(s){const d=s.replace(/\D/g,''); if(d.length<13||d.length>19) return false; let sum=0,dbl=false; for(let i=d.length-1;i>=0;i--){let v=parseInt(d[i]); if(dbl){v*=2; if(v>9)v-=9;} sum+=v; dbl=!dbl;} return sum%10===0;}
const BUSINESS_STOP = new Set(['Act','Company','Limited','Offer','Prospectus','Red','Herring','Book','Built','Stock','Exchange','Village','Taluka','Pune','Mumbai','India','Promoter','Management','Contact','Person','Telephone','Website','Email','Mail','Dated','KSH','INTERNATIONAL','LIMITED']);
function isValidPerson(name){const t=name.trim().replace(/\s+/g,' '); if(t.length<6||t.length>60) return false; const words=t.split(' '); if(words.length<2||words.length>4) return false; for(let w of words){const clean=w.replace(/[^A-Za-z]/g,''); if(!clean||BUSINESS_STOP.has(clean)||clean.length<3) return false; if(!/^[A-Z][a-z]+$/.test(clean)&&!/^[A-Z]+$/.test(clean)) return false;} return true;}
function extractNames(text){const doc=nlp(text); let people=doc.people().out('array'); const upper=[...text.matchAll(/\b(?:[A-Z]{2,}\s+){1,2}(?:HEGDE|SHETTY|MALVADKAR|SHAH)\b/g)].map(m=>m[0]).map(n=>n.split(' ').map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join(' ')); const combined=[...new Set([...people,...upper])]; return combined.filter(isValidPerson).sort((a,b)=>b.length-a.length).slice(0,20);}
function extractCompanies(text){const pat=/\b[A-Z][A-Za-z0-9& ]{3,30}?\s+(?:Private Limited|Limited|Ltd|LLP|Inc)\b/g; return [...new Set([...text.matchAll(pat)].map(m=>m[0].trim()))].slice(0,20);}
function extractAddresses(text){const lines=text.split('\n').map(l=>l.trim()).filter(l=>l.length>=20&&l.length<=200&&!l.includes('@')); return lines.filter(l=>/(Village|Pune|Mumbai|Maharashtra|Bandra)/i.test(l)&&/\d/.test(l)&&l.includes(',')).slice(0,10);}

function redactText(original) {
  const CACHE = CACHE_FACTORY();
  const fg = fakeGen(CACHE);
  let text = original;
  const repl=[];
  text = text.replace(PATTERNS.email, (m)=>{ const f=getFake(CACHE.emails,m,fg.email,CACHE); repl.push({type:'EMAIL',original:m,fake:f}); return f; });
  text = text.replace(PATTERNS.ip, (m)=>{ const f=getFake(CACHE.ips,m,fg.ip,CACHE); repl.push({type:'IP',original:m,fake:f}); return f; });
  text = text.replace(PATTERNS.ssn, (m)=>{ const f=getFake(CACHE.ssns,m,fg.ssn,CACHE); repl.push({type:'SSN',original:m,fake:f}); return f; });
  text = text.replace(PATTERNS.creditCard, (m)=>{ if(!luhnCheck(m)) return m; const f=getFake(CACHE.creditCards,m,fg.creditCard,CACHE); repl.push({type:'CC',original:m,fake:f}); return f; });
  text = text.replace(PATTERNS.phone, (m)=>{ const d=m.replace(/\D/g,''); if(d.length<10||d.length>13) return m; const f=getFake(CACHE.phones,m.trim(),()=>fg.phone(m),CACHE); repl.push({type:'PHONE',original:m.trim(),fake:f}); return f; });
  const comps=extractCompanies(original); for(const c of comps){ if(!text.includes(c)) continue; const f=getFake(CACHE.companies,c,fg.company,CACHE); text=text.split(c).join(f); repl.push({type:'COMPANY',original:c,fake:f}); }
  const names=extractNames(original); for(const n of names){ const f=getFake(CACHE.names,n,fg.name,CACHE); const re=new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g'); if(re.test(text)){ text=text.replace(re,f); repl.push({type:'PERSON',original:n,fake:f}); const upper=n.toUpperCase(); if(original.includes(upper)){ text=text.split(upper).join(f.toUpperCase()); } } }
  return { redactedText:text, report:{total:repl.length, byType: repl.reduce((a,r)=>{a[r.type]=(a[r.type]||0)+1; return a;},{})}, replacements:repl };
}

app.get('/api/health', (req,res)=>res.json({status:'ok', types:9}));

app.post('/api/redact', async (req,res)=>{
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({error:'No text provided'});
    const { redactedText, report, replacements } = redactText(text);
    res.json({ redactedText, report, replacements: replacements.slice(0,50) });
  } catch(e){ res.status(500).json({error:e.message}); }
});

app.post('/api/redact-file', upload.single('file'), async (req,res)=>{
  try {
    if (!req.file) return res.status(400).json({error:'No file'});
    const filePath = req.file.path;
    let originalText = '';
    if (req.file.originalname.endsWith('.docx')) {
      const mammoth = await import('mammoth');
      const result = await mammoth.extractRawText({path: filePath});
      originalText = result.value;
    } else {
      originalText = fs.readFileSync(filePath,'utf-8');
    }
    const { redactedText, report, replacements } = redactText(originalText);
    // create docx
    const paras = redactedText.split('\n').map(l=> new Paragraph({children:[new TextRun({text:l.slice(0,1000)})]}));
    const doc = new Document({sections:[{children:paras}]});
    const buffer = await Packer.toBuffer(doc);
    fs.unlinkSync(filePath);
    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition','attachment; filename=redacted.docx');
    res.send(buffer);
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, '0.0.0.0', ()=>console.log(`PII Redaction Tool running on port ${PORT}`));
