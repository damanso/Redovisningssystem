# Bygge beslut #174 — En append-only anteckningslogg per uppdrag: panelen **Övrigt** på Läget med datumrader, kryssrutan *

Datum: 2026-09-21 11:33 · Branch: cto/en-append-only-anteckningslogg-per-uppdr-174 · Overlamning: #268

## Mal
En append-only anteckningslogg per uppdrag: panelen **Övrigt** på Läget med datumrader, kryssrutan *utanför avtalet* och räkning i panelhuvudet, skriven via en ny åtgärd — `contracts.notes` rörs inte.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget stämmer mot koden: `kravManniska` fälls i `execute.ts:56` med 403 `human_required`, 0068:s RLS/GRANT-husmönster och sammansatta FK finns, Läget-rutten ligger på `routes.ts:4070`, 0072 bär formuleringen "människans egna ord", nästa lediga migrationsnummer är 0073, och inget `uppdrag_anteckning` finns sedan tidigare. Här är kravspecen:

---

MAL | Panelen **Övrigt** på Läget: en append-only anteckningslogg per uppdrag där David fyller på en rad i taget om småuppdrag (ILT), kan bocka *utanför avtalet* och ser räkning i panelhuvudet — så att uppdrag utanför avtalet får en plats i systemet i stället för mejl och huvud, som underlag när tillägg en dag skrivs.
KALLA | Överlämning #268 (Davids ord 18/9), CTO-underlag + Davids ja 21/9 med kravet KRÄVA MÄNNISKA (inte kö), samt 0072:s princip om notering: "människans egna ord, aldrig härledd av systemet".
ARKITEKTUR | Enbart befintliga mönster: mutation via `executeAction` → `actions/registry.ts` → tjänst i `withTenantTransaction` (auditlogg i samma transaktion); zod-strict-schema ur `lib/validation.ts`; migration i kedjan med 0068:s RLS/GRANT-husmönster (`app_has_company_access`, sammansatt FK `contracts(id, company_id)`); `kravManniska`-spärren i `execute.ts` (403 `human_required`); JS-fri vy i `http/view/routes.ts`; vitest mot riktig Postgres.
KRAV-1 | Migration `0073` (additiv, idempotent): tabell `uppdrag_anteckning` med `id`, `company_id`, `contract_id` (sammansatt FK `contracts(id, company_id)`), `text` (CHECK: aldrig tom, ≤ 2 000 tecken), `utanfor_avtal boolean NOT NULL DEFAULT false`, `skriven_av` (FK `users`), `created_at`; tabellkommentar ÄGD; index `(company_id, contract_id, created_at)`; RLS SELECT/INSERT via `app_has_company_access`; `GRANT SELECT, INSERT` till `app` — aldrig UPDATE/DELETE.
KRAV-2 | Åtgärd `skriv_uppdragsanteckning` i registret: indata `contract_id`, `text`, `utanfor_avtal` (strict zod); `sensitivity: 'write'` + `kravManniska: true` — ett agentanrop (t.ex. MCP) fälls med 403 `human_required` FÖRE varje skrivning; tom/blank text ger 400, aldrig en tyst tom rad; handlern anropar en liten tjänst (`services/`), ingen SQL i registret; raden bär avsändaren ur inloggad användare, aldrig ur indata.
KRAV-3 | Panelen **Övrigt** på Läget (`/c/:companyId/projects/:projectId/laget`, avtalet slås upp ur uppdragsläget som rutten redan gör), JS-fri: rader nyast överst med datum, avsändare och markering *Utanför avtalet* på flaggade rader; panelhuvudet räknar dem ("2 rader gäller arbete utanför avtalet"); under listan formulär med textarea, kryssruta *Gäller arbete utanför avtalet* och knapp *Lägg till* — fälten FÖRE knappen; posten går via `executeAction` (actor `human`) och landar tillbaka på Läget med raden synlig.
KRAV-4 | Prov (`uppdragsytan-*.test.ts`, riktig Postgres): UPDATE och DELETE som rollen `app` nekas; annat bolag ser ingenting; rundtur skriv → ladda om → raden kvar med datum och markering; 400 på tom text; räkningen i panelhuvudet stämmer; agentanrop får 403 `human_required`; `contracts.notes` är oförändrat efter en skrivning.
ACCEPTANS | `npm run migrate`, `npm test`, `npm run build` gröna med faktisk, inklistrad utdata; rundturen ur #268:s "Klart när" håller: en rad skriven under Övrigt står kvar med datum efter omladdning, kan inte ändras eller raderas, *Anteckningar* på avtalsformuläret är orört, ingen annan yta ändrad.
AVGRANSNING | Endast migration 0073, en åtgärd + en tjänst, panelen på Läget och proven. Inga befintliga tabeller, åtgärder eller ytor ändras; `contracts.notes` och `projects.notes` rörs inte; vägen scopesignal → tillägg (S5.2) är orörd; ingen ändring i `docs/ARKITEKTUR.md` behövs — kräver något ändå det: stanna och fråga.
uteslutet: återanvändning av CRM:s `party_notes` (0033: DELETE-rätt för GDPR, nycklad på part) — källan kräver det inte
uteslutet: automatik som gör en rad till tillägg eller scopesignal — källan kräver det inte
uteslutet: AI-härledda eller agentskrivna rader (MCP) — källan kräver det inte
uteslutet: redigering eller radering av rader (nästa rad rättar) — källan kräver det inte
uteslutet: godkännandekö/Att göra-post för anteckningar (`sensitive`-kodning) — källan kräver det inte
uteslutet: notiser eller larm på utanför-avtalet-rader — källan kräver det inte
uteslutet: nytt fält på avtalsdelarna (har redan *Beskrivning*) — källan kräver det inte

---

Två val värda att nämna: felkoden i specen är `human_required` (kodens faktiska konstant i `execute.ts:57`), inte underlagets "kraver_manniska" — samma spärr, rätt namn. Och räkningen avser flaggade rader totalt, som överlämningens exempel; någon "behandlad"-status finns inte och ska inte finnas (append-only, ingen automatik), vilket är precis riskhanteringen i CTO-underlaget.
```

## Utfall
Tester: 140 passed (140) · Granskning: GODKANT | Bygget följer kravspecen punkt för punkt (0073 med 0068:s husmönster, en åtgärd + en tjänst med `kravManniska`, JS-fri panel via `executeAction`, prov i alla fyra lager) utan nya beroenden,  · Byggforsok: 1

## Modellkedja (Davids krav 17/8, reservvag 7/9)

* krav: **claude-fable-5**
* utveckling: **claude-opus-5**
* granskning: **claude-fable-5**

Granskaren ar inte forfattaren: claude-fable-5 granskade claude-opus-5s arbete.

Allt pa Davids abonnemang - inga API-tokens.
