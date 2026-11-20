// I-download ang buong Matthew Henry commentary (public domain) para gumana kahit walang internet.
// Patakbuhin minsan lang: node download-commentary.js   (o i-double-click ang download-commentary.cmd)
// Pwedeng ihinto at ituloy ulit; nilalaktawan ang na-download na.
const fs = require("fs"), path = require("path");
const BASE = process.env.COMMENTARY_BASE || "https://bible.helloao.org/api/c/matthew-henry";
const DIR = path.join(__dirname, "commentary");
const USFM = "GEN EXO LEV NUM DEU JOS JDG RUT 1SA 2SA 1KI 2KI 1CH 2CH EZR NEH EST JOB PSA PRO ECC SNG ISA JER LAM EZK DAN HOS JOL AMO OBA JON MIC NAM HAB ZEP HAG ZEC MAL MAT MRK LUK JHN ACT ROM 1CO 2CO GAL EPH PHP COL 1TH 2TH 1TI 2TI TIT PHM HEB JAS 1PE 2PE 1JN 2JN 3JN JUD REV".split(" ");
if (typeof fetch !== "function") { console.error("Kailangan ng Node 18 o mas bago."); process.exit(1); }
const adb = JSON.parse(fs.readFileSync(path.join(__dirname, "data", "adb.json"), "utf8"));
const jobs = [];
USFM.forEach((code, b) => { for (let c = 1; c <= adb[b].length; c++) jobs.push([code, c]); });
fs.mkdirSync(DIR, {recursive: true});
let done = 0, got = 0, skip = 0, fail = 0;
async function one([code, c]) {
  const file = path.join(DIR, code + "_" + c + ".json");
  if (fs.existsSync(file)) { skip++; return; }
  for (let tries = 0; tries < 3; tries++) {
    try {
      const r = await fetch(BASE + "/" + code + "/" + c + ".json", {signal: AbortSignal.timeout(30000)});
      if (r.status === 404) { fail++; return; }
      if (!r.ok) throw new Error("HTTP " + r.status);
      fs.writeFileSync(file, JSON.stringify(await r.json())); got++; return;
    } catch (e) { await new Promise(r => setTimeout(r, 1500 * (tries + 1))); }
  }
  fail++;
}
(async () => {
  console.log("Dina-download ang Matthew Henry (" + jobs.length + " kabanata)...");
  let i = 0;
  const worker = async () => { while (i < jobs.length) { await one(jobs[i++]); if (++done % 50 === 0) console.log("  " + done + "/" + jobs.length); } };
  await Promise.all([worker(), worker(), worker(), worker()]);
  console.log("\nTapos! Bago: " + got + ", dati nang meron: " + skip + ", hindi nakuha: " + fail);
  if (fail) console.log("May hindi nakuha. Patakbuhin ulit mamaya para subukan ang mga iyon.");
})();
