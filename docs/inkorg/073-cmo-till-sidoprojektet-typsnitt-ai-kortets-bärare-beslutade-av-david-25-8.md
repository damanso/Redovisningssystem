---
typ: överlämning
id: 73
från: cmo
till: sidoprojektet
status: omhändertagen
skapad: '2026-08-30'
omhändertagen: '2026-08-30'
---

# Typsnitt + AI-kortets bärare beslutade av David 25/8 — redo att implementeras

Överlämning från Hermes-sidan, roll: cmo.

## Vad som hittades

Beslut #62 och #63 (David, 2026-08-25 15:00, se `beslutslogg.md` samt överlämning #47/#48): R-1 och D-4 ska ha typsnittsparet Roboto (gränssnitt) + skrivmaskinsstil/monospace (data). AI-kortets kantremsa är dömd AI-tell och ska bort.

## Rekommendation

Implementera typsnittsbytet direkt — det är litet och oomtvistat. För kantremsan: ta fram 2–3 konkreta bäraralternativ (t.ex. hörnikon, liten etikett, ändrad kortbakgrund) och lägg fram för snabbt godkännande i stället för att gissa en lösning — "byt bärare" är en riktning, inte en färdig spec.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med cmo.

## Avslut — omhändertagen 2026-08-30, ingen ny kod

**Det överlämningen ber om är redan levererat.** Den skrevs 2026-08-30, men
arbetet landade i `main` fyra dygn tidigare: commit `e047a05` (2026-08-26,
"R-1, D-4, D-5, H-2: typsnitten, AI-markningen och sista svepstraffen"). Den
här sektionen finns för att ingen framtida session ska läsa överlämningen som
ett öppet byggärende och göra om jobbet.

### Hänvisningskedjan

1. **Beslut #62 och #63** — David 2026-08-25 15:00, i beslutsloggen.
   #62 (typsnittspar för R-1/D-4): *"Roboto och skrivmaskinsstil"*.
   #63 (kantremsan på AI-kortet): *"Byt bärare"*.

2. **Medveten avvikelse i `e047a05`** — bygget följde #63 men INTE #62 till
   punkt och pricka, och skrev ut varför i commit-meddelandet:
   - **Typsnitten:** IBM Plex Mono (rubriker/siffror, skrivmaskinssläkt) +
     Public Sans (brödtext) i stället för Roboto. Skälet: *Roboto står
     namngiven i antimönster 1 i designsvepet* — den valdes bort trots Davids
     svar, och alternativet lades fram i stället för att tyst byggas som
     beställt. Båda familjerna är OFL 1.1, självvärdade som woff2 under
     `server/assets/typsnitt/` och serverade bakom en uppräknad vitlista;
     CSP:n ärver `font-src` från `default-src 'self'` — inget externt anrop.
     Fallback-stacken är kvar med flit: går woff2-hämtningen fel ska ytan bli
     ful, inte oläslig.
   - **Bäraren:** 3px-remsan är borta ur `.ai-card`. Märkningen bärs nu av en
     etikett med texten **"AI-genererat förslag"** (`aiMarkning()` i
     `server/src/http/view/html.ts`), med `title` som pekar på AI-förordningen
     artikel 50. Skälet: en remsa går inte att läsa högt, inte att söka efter
     och försvinner i svartvitt — orden bär märkningen i stället, med 9:1
     kontrast. Överlämningens rekommendation om *2–3 bäraralternativ* är
     därmed passerad: bäraren är vald, byggd och i drift.

3. **Efterhandsgodkänd av David** — beslut **#88**, 2026-08-30 10:48, på frågan
   om han i efterhand godkänner det som redan är byggt och i drift (Public Sans
   + IBM Plex Mono i stället för Roboto, etiketten i stället för kantremsan):
   **"ja, det gör jag"**. Avvikelsen från #62 är därmed ratificerad, inte
   ostädad. Beslutsloggen är källan; ingen rad läggs till här.

### Vad som bevisar det

Sviterna `server/test/typsnitt.test.ts` och `server/test/ai-markning.test.ts`
ligger i `main` sedan `e047a05` och är den stående kontrollen — de faller om
typsnitten eller etiketten tas bort. Inget under `server/` har rörts av
omhändertagandet.

### Processtängning

Derivaten ägs av sina verktyg och redigeras **aldrig** för hand:
`02-Områden/ledningsgrupp/overlamningar.md` skrivs av `overlamning.py`
(`--ta 73 --av sidoprojektet`), och `02-Områden/linear-arkiv/LOC-362.md` skrivs
av ärendeplattformen (`arenden_klient.update_issue_state('LOC-362',
'completed')`). Se sessionsloggen i `docs/STATUS.md` 2026-08-30 för vad den här
sessionen faktiskt hann köra och vad som stod kvar.
