// Bibliya ng Iglesia: maliit na server (Node lang, walang npm install).
// Patakbuhin: node server.js   (o i-double-click ang start-bible.cmd)
// 2026-11-19: dinagdagan ng /api/ai (Paliwanag at Sermon gamit ang Gemini) at
// /api/commentary (Matthew Henry, public domain, fallback kapag walang AI).
const http = require("http"), fs = require("fs"), path = require("path"), zlib = require("zlib"), os = require("os");
const ROOT = __dirname;

// ---------- .env (GEMINI_API_KEY at iba pa). Hindi ito sine-serve sa browser. ----------
try {
  for (const line of fs.readFileSync(path.join(ROOT, ".env"), "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && !line.trim().startsWith("#") && process.env[m[1]] === undefined) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
  }
} catch (e) { /* walang .env: ok lang, naka-off ang AI */ }

const PORT = Number(process.env.PORT) || 8080;
const TYPES = {".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".json":"application/json; charset=utf-8",
  ".webmanifest":"application/manifest+json",".png":"image/png",".woff2":"font/woff2",".txt":"text/plain; charset=utf-8"};
const GZ = new Set([".html",".js",".json",".webmanifest",".txt"]);
const gzCache = new Map();
const BLOCK = new Set(["server.js","start-bible.cmd","ai-cache.json","download-commentary.js","download-commentary.cmd","package.json","package-lock.json"]);

// ---------- AI settings ----------
const AI_KEY = process.env.GEMINI_API_KEY || "";
const AI_MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const AI_BASE = process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com/v1beta";
const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT) || 200;   // bagong AI request bawat araw (hindi kasama ang galing sa cache)
const AI_PER_DEVICE = Number(process.env.AI_PER_DEVICE) || 15;      // bawat phone/PC, kada 10 minuto
const COMM_BASE = process.env.COMMENTARY_BASE || "https://bible.helloao.org/api/c/matthew-henry";
const COMM_DIR = path.join(ROOT, "commentary");
const MAX_VERSES = 40;

const BOOKS = [["Genesis","Genesis"],["Exodus","Exodo"],["Leviticus","Levitico"],["Numbers","Mga Bilang"],["Deuteronomy","Deuteronomio"],["Joshua","Josue"],["Judges","Mga Hukom"],["Ruth","Ruth"],["1 Samuel","1 Samuel"],["2 Samuel","2 Samuel"],["1 Kings","1 Mga Hari"],["2 Kings","2 Mga Hari"],["1 Chronicles","1 Mga Cronica"],["2 Chronicles","2 Mga Cronica"],["Ezra","Ezra"],["Nehemiah","Nehemias"],["Esther","Esther"],["Job","Job"],["Psalms","Mga Awit"],["Proverbs","Mga Kawikaan"],["Ecclesiastes","Eclesiastes"],["Song of Solomon","Awit ng mga Awit"],["Isaiah","Isaias"],["Jeremiah","Jeremias"],["Lamentations","Mga Panaghoy"],["Ezekiel","Ezekiel"],["Daniel","Daniel"],["Hosea","Oseas"],["Joel","Joel"],["Amos","Amos"],["Obadiah","Obadias"],["Jonah","Jonas"],["Micah","Mikas"],["Nahum","Nahum"],["Habakkuk","Habacuc"],["Zephaniah","Sofonias"],["Haggai","Hageo"],["Zechariah","Zacarias"],["Malachi","Malakias"],["Matthew","Mateo"],["Mark","Marcos"],["Luke","Lucas"],["John","Juan"],["Acts","Mga Gawa"],["Romans","Roma"],["1 Corinthians","1 Corinto"],["2 Corinthians","2 Corinto"],["Galatians","Galacia"],["Ephesians","Efeso"],["Philippians","Filipos"],["Colossians","Colosas"],["1 Thessalonians","1 Tesalonica"],["2 Thessalonians","2 Tesalonica"],["1 Timothy","1 Timoteo"],["2 Timothy","2 Timoteo"],["Titus","Tito"],["Philemon","Filemon"],["Hebrews","Hebreo"],["James","Santiago"],["1 Peter","1 Pedro"],["2 Peter","2 Pedro"],["1 John","1 Juan"],["2 John","2 Juan"],["3 John","3 Juan"],["Jude","Judas"],["Revelation","Apocalipsis"]];
const USFM = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" ");
const VERS = {adb:{name:"Ang Dating Biblia (1905)",tl:true},kjv:{name:"King James Version",tl:false},web:{name:"World English Bible",tl:false}};

// ---------- helpers ----------
function sendJson(res, code, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(code, {"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(body);
}
function readBody(req, max) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on("data", c => { size += c.length; if (size > max) { reject(new Error("too big")); req.destroy(); } else chunks.push(c); });
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}
const bibleCache = {};
function bible(ver) {
  if (!bibleCache[ver]) bibleCache[ver] = JSON.parse(fs.readFileSync(path.join(ROOT, "data", ver + ".json"), "utf8"));
  return bibleCache[ver];
}
// Tinitingnan ang b, c, verses. Ibinabalik ang malinis na bersyon o null.
function checkPassage(q, needVer) {
  const b = Number(q.b), c = Number(q.c);
  if (!Number.isInteger(b) || b < 0 || b > 65 || !Number.isInteger(c) || c < 1) return null;
  let verses = Array.isArray(q.verses) ? q.verses : String(q.verses || "").split(",");
  verses = [...new Set(verses.map(Number))].filter(v => Number.isInteger(v) && v >= 1).sort((x, y) => x - y);
  if (!verses.length || verses.length > MAX_VERSES) return null;
  const out = {b, c, verses};
  if (needVer) {
    if (!VERS[q.ver]) return null;
    const ch = bible(q.ver)[b] && bible(q.ver)[b][c - 1];
    if (!ch || verses[verses.length - 1] > ch.length) return null;
    out.ver = q.ver; out.lines = verses.map(v => v + " " + (ch[v - 1] || "")).filter(l => /\S\s+\S/.test(l));
  }
  return out;
}
function refOf(p, tl) {
  const name = BOOKS[p.b][tl ? 1 : 0], vs = p.verses;
  const contiguous = vs.every((v, i) => i === 0 || v === vs[i - 1] + 1);
  return name + " " + p.c + ":" + (contiguous ? (vs.length > 1 ? vs[0] + "-" + vs[vs.length - 1] : vs[0]) : vs.join(","));
}
// Kapag naka-host (Render atbp.), nasa likod ng proxy ang server, kaya iisang IP lang ang makikita sa socket.
// I-on lang ito sa hosting (TRUST_PROXY=1). Sa LAN, naka-off para hindi ma-peke ng phone ang IP niya.
// Unahin ang True-Client-IP (galing Cloudflare sa harap ng Render). Kung wala, ang HULING IP sa X-Forwarded-For
// (idinagdag ng proxy mismo). Hindi ang una: kayang pekein ng phone ang unang IP dahil nag-a-append lang ang proxy.
const TRUST_PROXY = process.env.TRUST_PROXY === "1";
function clientIp(req) {
  if (TRUST_PROXY) {
    const tci = String(req.headers["true-client-ip"] || "").trim();
    if (tci) return tci.replace(/^::ffff:/, "");
    const fwd = String(req.headers["x-forwarded-for"] || "").split(",").map(s => s.trim()).filter(Boolean).pop();
    if (fwd) return fwd.replace(/^::ffff:/, "");
  }
  return (req.socket.remoteAddress || "").replace(/^::ffff:/, "");
}

// ---------- AI: cache at limits ----------
const CACHE_FILE = path.join(ROOT, "ai-cache.json");
let aiCache = {};
try { aiCache = JSON.parse(fs.readFileSync(CACHE_FILE, "utf8")); } catch (e) {}
let saveTimer = null;
function saveCache() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const keys = Object.keys(aiCache);
    if (keys.length > 3000) keys.sort((a, b) => aiCache[a].ts - aiCache[b].ts).slice(0, keys.length - 3000).forEach(k => delete aiCache[k]);
    fs.writeFile(CACHE_FILE, JSON.stringify(aiCache), () => {});
  }, 500);
}
const pending = new Map();
const perIp = new Map();
let day = "", dayCount = 0;
function allow(ip) {
  const today = new Date().toDateString();
  if (today !== day) { day = today; dayCount = 0; }
  if (dayCount >= AI_DAILY_LIMIT) return "Naabot na ang limit ng AI para sa araw na ito. Subukan ulit bukas, o gamitin muna ang Matthew Henry.";
  const now = Date.now(), list = (perIp.get(ip) || []).filter(t => now - t < 10 * 60 * 1000);
  if (list.length >= AI_PER_DEVICE) return "Medyo marami nang tanong mula sa device na ito. Maghintay ng ilang minuto, tapos subukan ulit.";
  list.push(now); perIp.set(ip, list); dayCount++;
  return "";
}

const SYSTEM = `You are a careful Bible teacher helping members of a local Filipino Christian church study Scripture.
Rules:
- Stay faithful to the passage given. Explain what the text says in its literary and historical context before applying it.
- Hold to historic, orthodox Christian teaching (the Bible as God's Word, the Trinity, salvation by grace through faith in Jesus Christ). Stay non-denominational: do not push one church's distinct positions, and when sincere Christians differ on a point, say so briefly and gently.
- Do not invent facts, dates, quotations, or verse wording. When pointing to other Bible passages, give the reference only (e.g. "Juan 3:16") and do not quote their wording.
- If something in the text is uncertain or debated, say so plainly instead of guessing.
- No politics, no attacks on other churches or religions, no sensational or speculative prophecy claims.
- Be warm, clear, and practical. Write for ordinary church members, not scholars.
- Use simple Markdown only: "## " headings, "- " bullets, "1. " numbered lists, and **bold**. No tables, no links, no emojis.`;

const LANG = {
  tl: `Write in Tagalog (Filipino) the way a native speaker talks in everyday life: short sentences, natural words like "'yung", "kasi", "na lang", "talaga". Avoid deep, formal, or translated-sounding Tagalog (avoid words like "nangangahulugang", "nakatakdang", "kamuhian"). Simple English church terms that Filipinos commonly use are fine. When you quote the passage itself, copy its wording exactly as given.`,
  en: `Write in clear, simple English. When you quote the passage itself, copy its wording exactly as given.`
};
const TASK = {
  explain: tl => `Explain this passage. Use these sections (use the ${tl ? "Tagalog" : "English"} headings shown):
## ${tl ? "Buod" : "Summary"} — 1 to 2 sentences.
## ${tl ? "Konteksto" : "Context"} — who wrote it, to whom, and what is happening around it.
## ${tl ? "Paliwanag" : "Explanation"} — go through the verses or main thoughts in order.
## ${tl ? "Kaugnay na talata" : "Related passages"} — 2 to 4 references with one short line each (reference only, no quotes).
## ${tl ? "Para sa buhay natin" : "For our lives"} — 2 to 3 practical applications.
Keep it around 350 to 550 words.`,
  sermon: tl => `Write a sermon outline a pastor or Bible study leader can preach from. Use these sections (use the ${tl ? "Tagalog" : "English"} headings shown):
## ${tl ? "Pamagat" : "Title"} — one short title line.
## ${tl ? "Pangunahing punto" : "Big idea"} — one sentence.
## ${tl ? "Panimula" : "Introduction"} — a short opening and an idea for a simple, relatable illustration (Filipino everyday life is good). Do not present a made-up story as if it really happened.
## ${tl ? "Punto 1" : "Point 1"}, ## ${tl ? "Punto 2" : "Point 2"}, ## ${tl ? "Punto 3" : "Point 3"} — each with its own short title after the heading, the verse(s) it comes from, a short explanation, 1 to 2 supporting references, and an application.
## ${tl ? "Pagtatapos" : "Conclusion"} — summary and a call to respond.
## ${tl ? "Panalangin" : "Closing prayer"} — 3 to 4 sentences.
Keep it around 700 to 1000 words.`
};

async function callGemini(prompt) {
  if (typeof fetch !== "function") throw Object.assign(new Error("Luma ang Node.js sa PC. Kailangan ng Node 18 o mas bago para sa AI."), {status: 500});
  const url = AI_BASE + "/models/" + encodeURIComponent(AI_MODEL) + ":generateContent";
  let r;
  try {
    r = await fetch(url, {method: "POST", signal: AbortSignal.timeout(90000),
      headers: {"Content-Type": "application/json", "x-goog-api-key": AI_KEY},
      body: JSON.stringify({systemInstruction: {parts: [{text: SYSTEM}]}, contents: [{role: "user", parts: [{text: prompt}]}], generationConfig: {temperature: 0.5}})});
  } catch (e) {
    throw Object.assign(new Error("Hindi maabot ang AI. Paki-check ang internet ng PC na may server."), {status: 502});
  }
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    const msg = (j.error && j.error.message) || ("HTTP " + r.status);
    console.error("  [AI] Gemini error " + r.status + ": " + msg.slice(0, 200));
    if (r.status === 429) throw Object.assign(new Error("Naubos muna ang libreng limit ng AI. Subukan ulit mamaya, o gamitin muna ang Matthew Henry."), {status: 429});
    if (r.status === 400 && /api key/i.test(msg) || r.status === 401 || r.status === 403) throw Object.assign(new Error("May problema sa API key ng AI. Pakisabi sa admin ng app."), {status: 503});
    if (r.status === 404) throw Object.assign(new Error("Hindi makita ang AI model na \"" + AI_MODEL + "\". Pakisabi sa admin ng app."), {status: 503});
    throw Object.assign(new Error("May error ang AI ngayon. Subukan ulit mamaya."), {status: 502});
  }
  const cand = (j.candidates || [])[0];
  const text = cand && cand.content && (cand.content.parts || []).map(p => p.text || "").join("").trim();
  if (!text) throw Object.assign(new Error("Walang naibigay na sagot ang AI para sa talatang ito. Subukan ulit, o gamitin ang Matthew Henry."), {status: 502});
  return text;
}

async function handleAi(req, res) {
  if (req.method !== "POST") return sendJson(res, 405, {error: "POST lang"});
  if (!AI_KEY) return sendJson(res, 503, {error: "Hindi pa naka-setup ang AI sa server (walang GEMINI_API_KEY). Pwede munang gamitin ang Matthew Henry.", code: "nokey"});
  let q;
  try { q = JSON.parse(await readBody(req, 4096)); } catch (e) { return sendJson(res, 400, {error: "Maling request"}); }
  const mode = q.mode === "sermon" ? "sermon" : q.mode === "explain" ? "explain" : "";
  const lang = q.lang === "en" ? "en" : q.lang === "tl" ? "tl" : "";
  let p;
  try { p = mode && lang && checkPassage(q, true); } catch (e) { p = null; }
  if (!p || !p.lines.length) return sendJson(res, 400, {error: "Hindi makilala ang napiling talata."});
  const key = [mode, lang, p.ver, p.b, p.c, p.verses.join(",")].join("|");
  if (aiCache[key]) return sendJson(res, 200, {text: aiCache[key].text, cached: true});
  if (!pending.has(key)) {
    const why = allow(clientIp(req));
    if (why) return sendJson(res, 429, {error: why});
    const tl = lang === "tl";
    const prompt = `Passage: ${refOf(p, VERS[p.ver].tl)} (${VERS[p.ver].name})\n\n${p.lines.join("\n")}\n\n${LANG[lang]}\n\n${TASK[mode](tl)}`;
    pending.set(key, callGemini(prompt).then(text => { aiCache[key] = {text, ts: Date.now()}; saveCache(); return text; }).finally(() => pending.delete(key)));
  }
  try { sendJson(res, 200, {text: await pending.get(key)}); }
  catch (e) { sendJson(res, e.status || 500, {error: e.message || "May error ang AI."}); }
}

// ---------- Matthew Henry (public domain) ----------
function flat(x) {
  if (x == null) return "";
  if (typeof x === "string") return x;
  if (Array.isArray(x)) return x.map(flat).join(" ");
  if (typeof x === "object") return flat(x.text != null ? x.text : x.content);
  return "";
}
async function commentaryChapter(b, c) {
  const file = path.join(COMM_DIR, USFM[b] + "_" + c + ".json");
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) {}
  if (typeof fetch !== "function") throw new Error("offline");
  let r;
  try { r = await fetch(COMM_BASE + "/" + USFM[b] + "/" + c + ".json", {signal: AbortSignal.timeout(20000)}); } catch (e) { throw new Error("offline"); }
  if (!r.ok) throw new Error(r.status === 404 ? "none" : "offline");
  const j = await r.json();
  try { fs.mkdirSync(COMM_DIR, {recursive: true}); fs.writeFileSync(file, JSON.stringify(j)); } catch (e) {}
  return j;
}
function pickCommentary(j, verses) {
  const ch = j.chapter || j;
  const items = (ch.content || []).filter(i => i && i.type === "verse" && Number.isFinite(Number(i.number)))
    .map(i => ({n: Number(i.number), t: flat(i.content).replace(/\s+/g, " ").trim()})).filter(i => i.t).sort((a, b) => a.n - b.n);
  const lo = verses[0], hi = verses[verses.length - 1], parts = [];
  items.forEach((it, i) => {
    const end = i + 1 < items.length ? items[i + 1].n - 1 : Infinity;
    if (it.n <= hi && end >= lo) parts.push({from: it.n, to: end === Infinity ? null : end, text: it.t});
  });
  const intro = flat(ch.introduction || j.introduction).replace(/\s+/g, " ").trim();
  return {parts, intro: parts.length ? "" : intro};
}
async function handleCommentary(req, res, url) {
  const p = checkPassage({b: url.searchParams.get("b"), c: url.searchParams.get("c"), verses: url.searchParams.get("verses")}, false);
  if (!p) return sendJson(res, 400, {error: "Hindi makilala ang napiling talata."});
  try {
    const out = pickCommentary(await commentaryChapter(p.b, p.c), p.verses);
    if (!out.parts.length && !out.intro) return sendJson(res, 404, {error: "Walang komentaryo ni Matthew Henry para sa talatang ito."});
    sendJson(res, 200, Object.assign({source: "Matthew Henry, Commentary on the Whole Bible (1706). Public domain."}, out));
  } catch (e) {
    sendJson(res, e.message === "none" ? 404 : 503, {error: e.message === "none" ? "Walang komentaryo ni Matthew Henry para sa kabanatang ito."
      : "Wala pang naka-download na komentaryo para sa kabanatang ito at walang internet ang PC. (Patakbuhin ang download-commentary.cmd para gumana kahit offline.)"});
  }
}

// ---------- server ----------
http.createServer((req, res) => {
  let p, url;
  try { url = new URL(req.url, "http://x"); p = decodeURIComponent(url.pathname); } catch { res.writeHead(400); return res.end(); }
  if (p === "/api/ai") return handleAi(req, res).catch(e => sendJson(res, 500, {error: "May error sa server."}));
  if (p === "/api/commentary") return handleCommentary(req, res, url).catch(e => sendJson(res, 500, {error: "May error sa server."}));
  if (p === "/api/status") return sendJson(res, 200, {ai: !!AI_KEY});
  if (p.endsWith("/")) p += "index.html";
  const file = path.normalize(path.join(ROOT, p));
  const base = path.basename(file);
  const parts = path.relative(ROOT, file).split(path.sep);
  const wellKnown = parts.length === 2 && parts[0] === ".well-known" && base === "assetlinks.json";
  const dotPath = parts.some(s => s.startsWith("."));
  if (!file.startsWith(ROOT + path.sep) || BLOCK.has(base) || (dotPath && !wellKnown)) { res.writeHead(403); return res.end("Bawal"); }
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) { res.writeHead(404, {"Content-Type":"text/plain; charset=utf-8"}); return res.end("Hindi makita"); }
    const ext = path.extname(file).toLowerCase();
    const headers = {"Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": ext === ".json" || ext === ".woff2" || ext === ".png" ? "public, max-age=86400" : "no-cache",
      "X-Content-Type-Options": "nosniff"};
    if (path.basename(file) === "sw.js") headers["Service-Worker-Allowed"] = "/";
    const wantsGz = GZ.has(ext) && /\bgzip\b/.test(req.headers["accept-encoding"] || "");
    if (!wantsGz) { headers["Content-Length"] = st.size; res.writeHead(200, headers); return req.method === "HEAD" ? res.end() : fs.createReadStream(file).pipe(res); }
    const k = file + ":" + st.mtimeMs;
    let buf = gzCache.get(k);
    if (!buf) { buf = zlib.gzipSync(fs.readFileSync(file), {level: 9}); gzCache.set(k, buf); }
    Object.assign(headers, {"Content-Encoding":"gzip","Content-Length":buf.length,"Vary":"Accept-Encoding"});
    res.writeHead(200, headers); res.end(req.method === "HEAD" ? undefined : buf);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("\n  Bibliya ng Iglesia - tumatakbo na!\n");
  console.log("  Sa PC na ito:      http://localhost:" + PORT);
  for (const list of Object.values(os.networkInterfaces())) for (const a of list || [])
    if (a.family === "IPv4" && !a.internal) console.log("  Sa phone (same Wi-Fi): http://" + a.address + ":" + PORT);
  console.log("\n  AI (Paliwanag/Sermon): " + (AI_KEY ? "ON (" + AI_MODEL + ", limit " + AI_DAILY_LIMIT + "/araw)" : "OFF - walang GEMINI_API_KEY sa .env (tingnan ang PAANO-GAMITIN.txt)"));
  console.log("\n  Isara ang window na ito para ihinto.\n");
}).on("error", e => { console.error(e.code === "EADDRINUSE" ? "Gamit na ang port " + PORT + ". Subukan: set PORT=8081 && node server.js" : e.message); process.exit(1); });
