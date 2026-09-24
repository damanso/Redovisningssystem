# Bygge beslut #184 — Privatekonomi som egen yta (/privat): sida i Ytor-servern ur privat/hushall.json med hemskärmsgenväg

Datum: 2026-09-24 21:36 · Branch: cto/privatekonomi-som-egen-yta-privat-sida-i-184 · Overlamning: #291

## Mal
Privatekonomi som egen yta (/privat): sida i Ytor-servern ur privat/hushall.json med hemskärmsgenväg, linsen privatekonomi och sektionen Hushållet i morgonbriefen, och ett prov som fäller om /privat syns i Ytor

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Kravspecen är klar och står på verifierad verklighet: jag har läst kravfilen i vaulten (`02-Områden/hermes/byggen/privat-yta-krav.md`), överlämning #291, och kontrollerat koden — `ytor_server.py` (port 8650, `FORBJUDET`/R5-kommentaren från Davids beslut 2026-08-24, `_prov_override`-mönstret), `brief_underlag.py` (linstupeln och `HERMES_ARENDEKUNSKAP`-mönstret), ikonerna i `statisk/`, fixturkatalogen och att adresskontraktets fyra `/privat`-rutter redan är synkade i `server/kontrakt/navigation.v1.json` (commit bf782ce).

En observation utanför specen: bygget verkar redan pågå — det finns säkerhetskopior `ytor_server.py.fore-privat-20260924-2116` och en kandidatkatalog `~/.hermes/privat-bygge/` med varv 1–2. Specen nedan är ändå skriven mot källan, inte mot kandidatens nuläge.

---

MAL | En egen läsyta `/privat` i Ytor-servern som visar hushållets månad ur `~/brain/privat/hushall.json` i helskärm från en hemskärmsgenväg på telefonen, plus sektionen Hushållet i morgonbriefen och ett prov som vaktar gränsen — så David följer budgeten (främst mat ute) dagligen utan att privatekonomin någonsin syns i Ytor.
KALLA | Överlämning #291 (beslut #184, Davids ja 24/9 18:49 och 22:4x), kravfilen `02-Områden/hermes/byggen/privat-yta-krav.md` som förtydligar beställningen `06-Inbox/handelser/2026-09-24-184900-bestallning-cto-privatekonomi-yta.md` (styrande).
ARKITEKTUR | Bygget bor helt i Hermes (`~/.hermes/services/ytor_server.py`, `~/.hermes/skills/brief_underlag.py` + `morgonbrief.py`, `~/.hermes/prov/`) — samma hemvist som svepet och provvakten enligt ARKITEKTUR.md; redovisningen berörs inte och inga nya beroenden, API:er eller tabeller införs (stacklistan är sluten).
KRAV-1 | `/privat` är en egen sidfunktion i `ytor_server.py`: designkontraktets tokens/typsnitt/komponenter (kort, chip, eyebrow), JS-fri, mobil-först i 390 px, fungerar i mörkt läge, utan produktmeny och utan länkar till andra ytor; innehållsordning: (1) rörligt kvar + kr/dag, (2) mat ute i kr av budget — huvudmålet, syns tydligast, (3) ett mätarkort per rörlig kategori med markering när den ligger före tempot, (4) månadens köp (datum, text, belopp, kategori), (5) senaste bankavstämning.
KRAV-2 | Filen läses vid varje anrop utan cache; sökvägen sätts om med miljövariabeln `HERMES_HUSHALL_FIL` enligt husets `_prov_override`-mönster (prov och kandidat använder samma); saknad eller oläsbar fil ger 200 med en förklarande mening (t.ex. "Ingen hushållsfil än — Claude fyller den från Cowork"), aldrig 500; ytan skriver aldrig filen.
KRAV-3 | Beräkningar i hela kronor, månad = innevarande i Europe/Stockholm med nyckel `YYYY-MM` (saknad månad = noll köp): köpt per kategori = summan av `manader[mån].kop[].belopp` där `kategori` = budgetpostens `id`; rörligt kvar = Σ(budget − köpt) för poster med `rorlig: true`; kr/dag = rörligt kvar delat med återstående dagar (dagen i dag inräknad) avrundat nedåt, negativt visas negativt; mat ute = köpt av budget för posten `matute`, aldrig hårdkodat; en kategori ligger före tempot när köpt/budget − dag/månadsdagar > 0,15; köp med okänd kategori listas men räknas inte in i någon mätare.
KRAV-4 | Hemskärmsgenväg: sidan har `<link rel="manifest" href="/privat/manifest.webmanifest">`, `<link rel="apple-touch-icon" href="/privat/ikon-180.png">`, `apple-mobile-web-app-capable=yes`, `apple-mobile-web-app-title=Hushåll` och `theme-color`; manifestet serveras som `application/manifest+json` med `name`/`short_name` "Hushåll", `start_url` och `scope` `/privat`, `display: standalone` och ikoner 180+512; ikonerna är de befintliga `statisk/hushall-180.png`/`-512.png` på `/privat/ikon-180.png` och `/privat/ikon-512.png` — bara de två.
KRAV-5 | Integritet: `privat/` stängs för `/fil` och `/katalog` via en egen lista `EJ_I_YTOR = ("privat",)` som `tillaten()` och katalogvyn respekterar — samma svar som andra förbjudna sökvägar ("Finns inte") och `/katalog/` listar inte `privat`; posten läggs INTE i `FORBJUDET` (R5-gränsen — Davids beslut 2026-08-24 säger att privatekonomin inte är R5, och R5-proven härleder skyddade strängar ur listan så ordet "privat" på Hem skulle fälla `startsida_prov` och `r5_yta_acceptans`); ingen sida länkar `/privat` och inget värde ur filen visas någon annanstans.
KRAV-6 | Adresskontraktet: de fyra rutterna (`/privat`, manifestet, två ikoner) står i `navigation.v1.json` med kategori `e` utan ägare (som `/vy/logga-in`) och är synkade av kravställaren — byggaren rör inte kontraktet; rutterna skrivs som vanliga `if v == "..."` i `do_GET` och ingen rutt döljs för kontraktsprovets tolk.
KRAV-7 | Linsen `privatekonomi` i `brief_underlag.py`: status OK och antal = antalet köp i månaden när filen går att läsa, annars ej OK med orsak; skriver avsnittet `## Hushållet` med exakt tre maskinellt satta rader — `Rörligt kvar: X kr (Y kr/dag)`, `Mat ute: A kr av B kr`, samt en varningsrad som namnger kategorier mer än 15 procentenheter före tempot eller `Inget ligger före månadens tempo`; `morgonbrief.py` tar in avsnittet ordagrant i briefen — ingen modell räknar om siffrorna.
KRAV-8 | Allt i KRAV-7 gäller bara när `HERMES_PRIVATEKONOMI=1` är satt (samma mönster som `HERMES_ARENDEKUNSKAP` i båda filerna); utan flaggan är linsblock, underlag och brief exakt som i dag, tecken för tecken, och proven som låser de åtta befintliga linsraderna passerar oförändrade.
KRAV-9 | Provet `privatgransen.py` (ny fil i kandidatkatalogen, flyttas till `~/.hermes/prov/` vid driftsättning) fäller om: Hem eller någon menylänkad sida innehåller `/privat` eller ett fixturvärde; `/fil/privat/hushall.json` eller `/katalog/privat` serveras; `/privat` saknar manifest-/ikonlänkarna; manifestet saknar `name`, `start_url` eller `display: standalone`; linsen ger fel status på fixturen (ska ge OK och rätt antal) eller på saknad fil (ska inte ge OK) — bas-URL ur `HERMES_YTAN` (standard `http://127.0.0.1:8650`), fixtur via `HERMES_HUSHALL_FIL`, skriver `GRON`/`ROD` med orsak som husets andra prov.
ACCEPTANS | Genvägen på telefonen öppnar `/privat` i helskärm; ytans 27 befintliga prov ger baslinjens utfall utan att något prov skrivits om, och `privatgransen.py` är GRÖN mot fixturen `~/.hermes/privat-bygge/fixtur/hushall.json` (påhittade belopp — riktiga filen läses eller citeras aldrig av byggare/granskare, inga riktiga belopp i kod, prov eller commit); briefen med flaggan har Hushållet med underlagets exakta siffror, utan flaggan är den tecken för tecken som i dag.
AVGRANSNING | Minsta möjliga ändring: inget nytt API, inga nya tabeller, inga nya MCP-verktyg, inga nya beroenden; `/opt/redovisning` rörs inte (enda undantag: kontraktskopian `server/kontrakt/navigation.v1.json`, redan synkad av kravställaren — ingen kod, ingen driftsättning där); ytan skriver aldrig filen; flytten av köpen från budgetartefakten till filen och seedningen gör Claude i Cowork-projektet "Hantera min bokföring", inte bygget; Nordea-avläsningen gör David själv.
uteslutet: inloggning eller egen autentisering på /privat — kallan kraver det inte
uteslutet: skrivfunktioner i ytan (registrera eller rätta köp) — kallan kraver det inte
uteslutet: obligatorisk visning av fasta_avvikelser, netto_lon och fore — kallan kraver det inte
uteslutet: cache eller lokal lagring av hushållsdata — kallan kraver det inte
uteslutet: service worker eller offlineläge för genvägen — kallan kraver det inte
uteslutet: notiser eller larm när en kategori ligger före tempot — kallan kraver det inte
```

## Utfall
Tester: 142 passed (142) · Granskning: GODKANT | Koden i Hermes uppfyller KRAV 1–9 som skrivna (egen sidfunktion utan meny/JS/länkar, `EJ_I_YTOR` skild från `FORBJUDET`, `_prov_override` för `HERMES_HUSHALL_FIL`, golvdivision för kr/dag, o · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
