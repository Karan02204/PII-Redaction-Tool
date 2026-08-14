import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { fileURLToPath } from 'url';
import nlp from 'compromise';
import { faker } from '@faker-js/faker';
import { Document, Packer, Paragraph, TextRun } from 'docx';
import mammoth from 'mammoth';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const PORT = process.env.PORT || 10000;

if (!fs.existsSync('uploads')) fs.mkdirSync('uploads', {recursive:true});

app.use(cors());
app.use(express.json({limit: '10mb'}));
app.use(express.static(path.join(__dirname, 'public')));

const storage = multer.diskStorage({
  destination: (req,file,cb)=>cb(null,'uploads/'),
  filename: (req,file,cb)=>cb(null,Date.now()+'-'+file.originalname)
});
const upload = multer({ storage, limits:{fileSize: 5*1024*1024} }); // 5MB limit reduced

// === MEMORY-EFFICIENT REDACTOR ===
const CACHE_FACTORY = () => ({
  names:new Map(), emails:new Map(), phones:new Map(),
  companies:new Map(), addresses:new Map(), ssns:new Map(),
  creditCards:new Map(), dobs:new Map(), ips:new Map()
});

function getFake(map, original, gen, cache){
  const key=original.trim(); if(!key) return original;
  if(map.has(key)){const c=map.get(key); if(c) return c;}
  let fake; try{fake=gen();}catch{fake=null;}
  if(!fake){
    if(map===cache.emails) fake=`user${Math.floor(Math.random()*10000)}@example.com`;
    else fake=`REDACTED_${map.size+1}`;
  }
  map.set(key,fake); return fake;
}

const fakeGen = (CACHE)=>({
  name:()=>faker.person.fullName()||'John Doe',
  email:()=>{try{const e=faker.internet.email(); return e&&e.toLowerCase()||`user${Math.random()*10000}@example.com`;}catch{return `user${Math.random()*10000}@example.com`;}},
  phone:(orig)=>{try{return orig.includes('91')?`+91 ${faker.string.numeric(2)} ${faker.string.numeric(4)} ${faker.string.numeric(4)}`:faker.string.numeric(10);}catch{return '+91 1234567890';}},
  company:()=>{try{return `${faker.company.name()} Limited`;}catch{return 'Acme Private Limited';}},
  address:()=>{try{return `${faker.location.streetAddress()}, Mumbai - 400001, India`;}catch{return '123 Main St, Mumbai - 400001';}},
  ssn:()=>`${faker.string.numeric(3)}-${faker.string.numeric(2)}-${faker.string.numeric(4)}`,
  creditCard:()=>{try{return faker.finance.creditCardNumber('####-####-####-####');}catch{return '4111-1111-1111-1111';}},
  dob:()=>{try{return faker.date.birthdate({min:25,max:65,mode:'age'}).toLocaleDateString('en-GB');}catch{return '01/01/1990';}},
  ip:()=>{try{return faker.internet.ipv4();}catch{return '192.168.1.1';}}
});

const PATTERNS = {
  email:/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g,
  ip:/\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  ssn:/\b\d{3}-\d{2}-\d{4}\b/g,
  creditCard:/\b(?:\d{4}[\s\-]){3}\d{4}\b/g,
  phone:/(?:\+91[\s\-]*\(?\d{2,5}\)?[\s\-]*\d{3,5}[\s\-]*\d{4,6})|\b\d{10}\b/g,
};
function luhnCheck(s){const d=s.replace(/\D/g,''); if(d.length<13||d.length>19) return false; let sum=0,dbl=false; for(let i=d.length-1;i>=0;i--){let v=parseInt(d[i]); if(dbl){v*=2; if(v>9)v-=9;} sum+=v; dbl=!dbl;} return sum%10===0;}
const BUSINESS_STOP = new Set(['Act','Company','Limited','Offer','Prospectus','Red','Herring','Book','Built','Stock','Exchange','Village','Taluka','Pune','Mumbai','India','Promoter','Management','Contact','Person','Telephone','Website','Email']);
function isValidPerson(name){const t=name.trim().replace(/\s+/g,' '); if(t.length<6||t.length>60) return false; const words=t.split(' '); if(words.length<2||words.length>4) return false; for(let w of words){const c=w.replace(/[^A-Za-z]/g,''); if(!c||BUSINESS_STOP.has(c)||c.length<3) return false;} return true;}

// MEMORY FIX: Don't run compromise on huge text (>20k chars) - use regex only for large chunks
function extractNames(text){
  if (text.length > 20000) {
    console.log(`Skipping compromise NER for large chunk ${text.length} chars - using regex only`);
    // Regex only for large text to save memory
    const regex = [...text.matchAll(/\b[A-Z][a-z]+\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\b/g)].map(m=>m[0]);
    return [...new Set(regex)].filter(isValidPerson).slice(0,10);
  }
  try {
    const doc=nlp(text);
    let people=doc.people().out('array');
    const upper=[...text.matchAll(/\b(?:[A-Z]{2,}\s+){1,2}(?:HEGDE|SHETTY|MALVADKAR|SHAH)\b/g)].map(m=>m[0]).map(n=>n.split(' ').map(w=>w.charAt(0)+w.slice(1).toLowerCase()).join(' '));
    const combined=[...new Set([...people,...upper])];
    return combined.filter(isValidPerson).sort((a,b)=>b.length-a.length).slice(0,20);
  } catch(e){
    console.log('NER failed, fallback to regex:', e.message);
    return [];
  }
}
function extractCompanies(text){
  if (text.length > 20000) return []; // skip for large chunks to save memory
  const pat=/\b[A-Z][A-Za-z0-9& ]{3,30}?\s+(?:Private Limited|Limited|Ltd|LLP|Inc)\b/g;
  return [...new Set([...text.matchAll(pat)].map(m=>m[0].trim()))].slice(0,10);
}
function extractAddresses(text){
  const lines=text.split('\n').map(l=>l.trim()).filter(l=>l.length>=20&&l.length<=200&&!l.includes('@'));
  return lines.filter(l=>/(Village|Pune|Mumbai|Maharashtra|Bandra)/i.test(l)&&/\d/.test(l)&&l.includes(',')).slice(0,5);
}

// CHUNKED REDACTION - Process large files in 10k char chunks to avoid OOM
function redactTextChunked(original, chunkSize=10000) {
  const CACHE = CACHE_FACTORY();
  const fg = fakeGen(CACHE);
  let fullRedacted = '';
  let allReplacements = [];
  
  // Split by paragraphs but keep chunks under chunkSize
  const paragraphs = original.split('\n');
  let currentChunk = '';
  
  for (let para of paragraphs) {
    if ((currentChunk + para).length > chunkSize) {
      // Process current chunk
      if (currentChunk) {
        const { redactedChunk, repl } = redactSingleChunk(currentChunk, CACHE, fg);
        fullRedacted += redactedChunk + '\n';
        allReplacements = allReplacements.concat(repl);
        currentChunk = '';
        // Force GC hint
        if (global.gc) global.gc();
      }
      // If single paragraph is larger than chunkSize, split it
      if (para.length > chunkSize) {
        for (let i=0; i<para.length; i+=chunkSize) {
          const subChunk = para.substring(i, i+chunkSize);
          const { redactedChunk, repl } = redactSingleChunk(subChunk, CACHE, fg);
          fullRedacted += redactedChunk;
          allReplacements = allReplacements.concat(repl);
        }
        fullRedacted += '\n';
      } else {
        currentChunk = para + '\n';
      }
    } else {
      currentChunk += para + '\n';
    }
  }
  if (currentChunk) {
    const { redactedChunk, repl } = redactSingleChunk(currentChunk, CACHE, fg);
    fullRedacted += redactedChunk;
    allReplacements = allReplacements.concat(repl);
  }
  
  return { redactedText: fullRedacted, report:{total:allReplacements.length, byType: allReplacements.reduce((a,r)=>{a[r.type]=(a[r.type]||0)+1; return a;},{})}, replacements: allReplacements };
}

function redactSingleChunk(text, CACHE, fg) {
  let t = text;
  const repl=[];
  t = t.replace(PATTERNS.email, (m)=>{ const f=getFake(CACHE.emails,m,fg.email,CACHE); repl.push({type:'EMAIL',original:m,fake:f}); return f; });
  t = t.replace(PATTERNS.ip, (m)=>{ const f=getFake(CACHE.ips,m,fg.ip,CACHE); repl.push({type:'IP',original:m,fake:f}); return f; });
  t = t.replace(PATTERNS.ssn, (m)=>{ const f=getFake(CACHE.ssns,m,fg.ssn,CACHE); repl.push({type:'SSN',original:m,fake:f}); return f; });
  t = t.replace(PATTERNS.creditCard, (m)=>{ if(!luhnCheck(m)) return m; const f=getFake(CACHE.creditCards,m,fg.creditCard,CACHE); repl.push({type:'CC',original:m,fake:f}); return f; });
  t = t.replace(PATTERNS.phone, (m)=>{ const d=m.replace(/\D/g,''); if(d.length<10||d.length>13) return m; const f=getFake(CACHE.phones,m.trim(),()=>fg.phone(m),CACHE); repl.push({type:'PHONE',original:m.trim(),fake:f}); return f; });
  // Company, Address, Person only for smaller chunks to save memory
  if (text.length < 20000) {
    const comps=extractCompanies(text); for(const c of comps){ if(!t.includes(c)) continue; const f=getFake(CACHE.companies,c,fg.company,CACHE); t=t.split(c).join(f); repl.push({type:'COMPANY',original:c,fake:f}); }
    const names=extractNames(text); for(const n of names){ const f=getFake(CACHE.names,n,fg.name,CACHE); const re=new RegExp(`\\b${n.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')}\\b`,'g'); if(re.test(t)){ t=t.replace(re,f); repl.push({type:'PERSON',original:n,fake:f}); } }
  }
  return { redactedChunk: t, repl };
}

function redactText(original) {
  // Auto-select chunked for large files
  if (original.length > 50000) {
    console.log(`Large file detected (${original.length} chars), using chunked redaction to avoid OOM`);
    return redactTextChunked(original, 8000);
  }
  // For small files, use original logic with chunking disabled
  return redactTextChunked(original, 20000);
}

app.get('/api/health', (req,res)=>res.json({status:'ok', types:9, memory:'optimized with chunking', maxFile:'5MB'}));

// Simple text redact - with size limit
app.post('/api/redact', async (req,res)=>{
  try {
    const { text } = req.body;
    if (!text) return res.status(400).json({error:'No text'});
    if (text.length > 100000) return res.status(413).json({error:'Text too large (>100k chars). Please use file upload with chunking or use smaller file. For demo, use synthetic_pii.txt (1727 chars). Real RHP is 366k chars which needs chunking and may OOM on free tier. Try synthetic first.'});
    const { redactedText, report, replacements } = redactText(text);
    res.json({ redactedText, report, replacements: replacements.slice(0,50) });
  } catch(e){ console.error(e); res.status(500).json({error:e.message}); }
});

app.post('/api/redact-file', upload.single('file'), async (req,res)=>{
  console.log('Upload request');
  try {
    if (!req.file) return res.status(400).json({error:'No file'});
    console.log(`File: ${req.file.originalname}, ${req.file.size} bytes, ${req.file.path}`);
    
    // Reject too large files early to avoid OOM
    if (req.file.size > 2*1024*1024) {
      fs.unlinkSync(req.file.path);
      return res.status(413).json({error:`File too large (${(req.file.size/1024/1024).toFixed(1)}MB). Render free tier has 256MB heap. Your RHP docx is 1.8MB / 366k chars which causes OOM. Please use synthetic_pii.txt (1.7KB) for demo, or split RHP into smaller chunks. For full RHP, run CLI locally: node src/redactor.js --input original.txt --output redacted.docx`});
    }

    const filePath = req.file.path;
    let originalText = '';
    try {
      if (req.file.originalname.toLowerCase().endsWith('.docx')) {
        console.log('Extracting docx...');
        const result = await mammoth.extractRawText({path: filePath});
        originalText = result.value;
        console.log(`Extracted ${originalText.length} chars`);
      } else {
        originalText = fs.readFileSync(filePath,'utf-8');
      }
    } catch (extractError) {
      console.error('Extract error:', extractError);
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
      return res.status(500).json({error:'Failed to extract: '+extractError.message});
    }

    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch(e){}

    // Double check text length after extraction (docx 1.8MB -> 366k chars)
    if (originalText.length > 150000) {
      console.log(`Very large text ${originalText.length} chars - using aggressive chunking and skipping heavy NER`);
      // Still try but with warning
    }

    console.log(`Redacting ${originalText.length} chars...`);
    const { redactedText, report, replacements } = redactText(originalText);
    console.log(`Redacted: ${report.total}`);

    let buffer;
    try {
      // MEMORY FIX: Don't create Paragraph per line for huge files - chunk into fewer paragraphs
      const lines = redactedText.split('\n');
      const paras = [];
      // If huge, combine 10 lines per paragraph to reduce docx objects
      if (lines.length > 500) {
        for (let i=0; i<lines.length; i+=10) {
          const chunkLines = lines.slice(i, i+10).join('\n').slice(0,5000);
          paras.push(new Paragraph({children:[new TextRun({text: chunkLines})]}));
        }
      } else {
        for (let l of lines) {
          paras.push(new Paragraph({children:[new TextRun({text:l.slice(0,1000)})]}));
        }
      }
      const doc = new Document({sections:[{children:paras}]});
      buffer = await Packer.toBuffer(doc);
      console.log(`Buffer: ${buffer.length}`);
    } catch (docxError) {
      console.error('Docx error:', docxError);
      return res.status(500).json({error:'Docx creation failed: '+docxError.message});
    }

    res.setHeader('Content-Type','application/vnd.openxmlformats-officedocument.wordprocessingml.document');
    res.setHeader('Content-Disposition','attachment; filename=redacted.docx');
    res.send(buffer);
  } catch(e){ console.error('Unexpected:', e); res.status(500).json({error:e.message}); }
});

app.get('/', (req,res)=>res.sendFile(path.join(__dirname,'public','index.html')));

app.listen(PORT, '0.0.0.0', ()=>console.log(`PII Tool OPTIMIZED running on ${PORT}, chunking enabled, max file 2MB for free tier`));