# Bibliya ng Iglesia (Bible app)

> PERSONAL / church project. Hindi isasama sa work reports. Ginawa 2026-11-19.

- **Hosting (2026-11-19, utos ni Jack):** LOCAL lang sa PC / local network. Binura na ang claude.ai artifact.
- **Local build:** `Jarvis\outputs\bible-app-local\` — `start-bible.cmd` → `node server.js` (walang npm install, gzip, port 8080). PWA: `manifest.webmanifest`, `sw.js` (offline cache; i-bump ang `VERSION` kapag may binago), fonts naka-bundle. Gabay: `PAANO-GAMITIN.txt`.
- **Limitasyon ng LAN:** sa phone via `http://<IP>:8080`, gumagana pero hindi installable/offline (kailangan ng https). Sa PC (localhost) gumagana ang install at offline.
- **Lumang artifact source:** `Jarvis\outputs\bible-app\` (`index.html` = buildable output; `src.html` = template na may `/*VOTD*/[]` placeholder; `votd.txt` = 425 verse of the day; `data\*.json`).
- **Versions (public domain lang):** ADB = Ang Dating Biblia 1905 (scrollmapper/bible_databases `TagAngBiblia.json`), KJV 1769 (scrollmapper `KJV.json`), WEB (TehShrike/world-english-bible). Format: `[book][chapter][verse] = text`, isang libro bawat linya. Hindi pwede ang MBBTAG (copyrighted).
- **Features:** basa (pili ng aklat/kabanata, Tagalog na pangalan kapag ADB), compare ng 2 version, search (salita o reference gaya ng "Juan 3:16", "jn 3:16", "Awit 23"; hindi pansin ang gitling, kaya "pag-ibig" = "pagibig"), highlight (4 kulay), bookmark, notes, kopyahin, verse of the day, laki ng letra, light/dark.
- **Data ng user:** localStorage lang sa phone ng bawat member (walang login/server). Mawawala kapag binura ang browser data.
- **Phase 2 (mungkahi):** https sa LAN (hal. mkcert) para installable/offline din sa phones, reading plan, share bilang image card, sariling church logo/pangalan.

## Change log
- **2026-11-19 — Paliwanag / Sermon (AI) + Matthew Henry.** Kapag pumili ng talata: "Ipaliwanag" at "Gawan ng sermon" (Gemini, Tagalog/English), at "Matthew Henry" (public domain, English) bilang fallback. Backend: `server.js` (`/api/ai`, `/api/commentary`, `/api/status`; key mula sa `.env`; naka-block ang dotfiles; cache sa `ai-cache.json`; limit 200/araw at 15/device kada 10 min). Frontend: `index.html` (buttons sa verse sheet, AI sheet, i-save sa notes), `sw.js` → `bibliya-v2` (hindi kina-cache ang `/api/`). Bago: `download-commentary.js/.cmd` (offline Matthew Henry, `commentary\`), `env-example.txt`. Gabay: `PAANO-GAMITIN.txt`. Diff: `Jarvis\diffs\2026-11-19-bible-app-ai.diff`.
  - Status: **code done; na-test gamit ang mock** (API, rate limit, cache, offline commentary, UI sa Chrome headless). **Hindi pa na-test sa totoong Gemini key at totoong helloao data**: kailangan ni Jack maglagay ng key sa `.env`.
  - Default model: `gemini-flash-latest` (palitan sa `.env` ang `GEMINI_MODEL` kung kailangan).
- **2026-11-20 — Handa nang i-host online + APK via PWABuilder (go ni Jack).** Binago ang desisyong "local lang": iho-host na ang buong app (Render, https) para makagawa ng APK/AAB sa PWABuilder; Play Store sa susunod. Backend: `server.js` (`TRUST_PROXY=1` → totoong IP mula `X-Forwarded-For` para gumana ang limit kada phone sa likod ng proxy; bawal na ang anumang dot-folder gaya ng `.git/` maliban sa `/.well-known/assetlinks.json`; bawal din ang `package.json`). Bago: `package.json` (`npm start`, Node ≥18). Frontend: `manifest.webmanifest` (`id`, `description`), `sw.js` → `bibliya-v3`. Gabay: `PAANO-I-HOST-AT-GAWING-APK.txt`.
  - Status: **code done + na-test locally** (rate limit kada IP sa likod ng proxy, hindi ma-peke kapag naka-off, at file blocking). **Hindi pa naka-deploy**: si Jack ang mag-GitHub + Render + PWABuilder.
- **2026-11-20 — Ayos sa search.** Ang reference na may numero (hal. "2 Juan 1", "Juan 3", "Roma 8") ay hindi na rin naghahanap ng salita (dati, lumalabas lahat ng talatang may "juan"). Kapag walang ganoong kabanata o talata (hal. "Juan 22:1", "Juan 3:99"), may mensahe na kung hanggang saan lang. `sw.js` → `bibliya-v4`.
  - Status: **na-test locally** sa headless Chrome (phone size): 12 search, walang JS error.
