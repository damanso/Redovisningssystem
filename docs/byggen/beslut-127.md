# Bygge beslut #127 — Ett "Skapa tillägg"-flöde på en signal avgjord "utanför": formulär som köar `andra_baseline` (ny `co

Datum: 2026-09-06 19:43 · Branch: cto/ett-skapa-till-gg-fl-de-p-en-signal-avgj-127 · Overlamning: #127

## Mal
Ett "Skapa tillägg"-flöde på en signal avgjord "utanför": formulär som köar `andra_baseline` (ny `contract_parts`-version med `valid_from` och orsak) och vid godkännandet fyller signalens redan befintliga men oskrivna kolumn `ledde_till_part_id`.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
Underlaget är komplett — jag har läst 1E Del 4:s tabellrad, kömekaniken i `execute.ts`, `andra_baseline`/`avgor_scopesignal` i registret, tjänsterna och 0068:s kolumn. Kravspecen nedan följer Davids korrigering: tillägget köas **inuti** `avgor_scopesignal`, inget femte handgrepp.

---

MAL | Ett "utanför"-avgörande kan i samma anrop köa tillägget: `avgor_scopesignal` skapar en `andra_baseline`-köpost (handgrepp 2), och först vid Davids godkännande föds den nya `contract_parts`-versionen och signalens `ledde_till_part_id` fylls — spåret från sagd fras till avtalad del blir helt, utan att något skrivs före godkännandet.
KALLA | Överlämning #127 (story S5.2 ur 1F, bär FR-2/FR-4) + Davids svar 6/9 19:04: följ 1E Del 4:s tabellrad ("skapar tillägg via `andra_baseline` när 'utanför'"), inget eget handgrepp efteråt — människans godkännande i kön ÄR handgrepp 2; 0068 bär redan `ledde_till_part_id`, versionsnyckeln och orsakstriggern; S0.1/S1.3/S5.1 gröna.
ARKITEKTUR | Ett flöde tre ingångar (`executeAction`); sensitive-kön (`createApproval` → handlern körs först i `approveAction`, `execute.ts`); zod-strict ur `lib/validation.ts` (`AvtalsdelFalt`, `OrsakSchema` finns); tjänstelager med `client`+`companyId` i `withTenantTransaction`, audit i samma transaktion; RLS + sammansatt FK `(ledde_till_part_id, company_id)` ur 0068. Inga nya mönster, inga nya beroenden.
KRAV-1 | `avgor_scopesignal` (`registry.ts`) får valfritt objekt `tillagg` med samma fält och krav som `andra_baseline` (`AvtalsdelFalt` + obligatorisk `change_reason` (OrsakSchema) + `valid_from`), tillåtet ENDAST med `avgjord: 'utanfor'` — `'innanfor'` + `tillagg` ⇒ 400 `validation_error`. Ingen ny åtgärd i registret.
KRAV-2 | Med `tillagg` skapar handlern (`uppdragSignal.ts`), i SAMMA transaktion som avgörandet, köposten via `createApproval(..., 'andra_baseline', { ...tillagg, signal_id })` plus auditraden `action.approval_requested` — aldrig via ett nytt `executeAction`-anrop. Utan `tillagg` avgörs signalen exakt som idag.
KRAV-3 | `andra_baseline` (`registry.ts`) får valfritt `signal_id: UuidSchema`; handlern kör som idag `upsertContractPart` och sätter därefter, i samma transaktion (= `approveAction`-transaktionen), `uppdrag_scopesignal.ledde_till_part_id` till den `contract_parts`-rad som (contract_id, code, valid_from) pekar ut.
KRAV-4 | Länkningen validerar före UPDATE att signalen finns i bolaget (annars `NotFoundError`, jfr `kravAvtal`) och att signalens `contract_id` är köpostens `contract_id` (annars 400) — fel avtal eller grannbolag skriver ingenting.
KRAV-5 | Signalsidan (`http/view/routes.ts`): utanför-vägen i avgör-formuläret får fälten kod, namn, `valid_from`, orsak samt valfritt tak; lämnas de tomma avgörs utan köpost. JS-fri serverrenderad HTML, befintliga komponentklasser och tokens ur `html.ts`, ingen ny stil.
KRAV-6 | vitest i `server/test/`: (a) avgör med `tillagg` ⇒ `pending_approval`, INGEN `contract_parts`-rad, `ledde_till_part_id` NULL; (b) `approveAction` ⇒ ny version + länk satta i samma transaktion och den tidigare versionen fortfarande läsbar; (c) `rejectApproval` ⇒ varken rad eller länk; (d) `signal_id` mot annat avtal ⇒ 400, ingen länk; (e) grannbolags signal ⇒ not found; (f) `innanfor` + `tillagg` ⇒ 400.
KRAV-7 | Båda nya fälten dokumenteras under modulsektionen Uppdragsytan i `docs/MCP_ACTIONS.md`; `docs/STATUS.md` får en sessionsrad.
ACCEPTANS | `npm run build` och `npm test` gröna med inklistrad utdata; testerna visar att "inget skrivs förrän godkännandet" bärs av befintlig sensitive-mekanik (ingen ny spärrkod); registret har oförändrat antal åtgärder — handgreppen är fyra och förblir fyra.
AVGRANSNING | Rör inte `execute.ts`, `approvals.ts`, migrationer, `upsertContractPart`:s skrivväg, sensitivity/`kravManniska` på någon åtgärd, eller andra vyer än signalsidan — minsta möjliga ändring.
uteslutet: egen skapa tillägg-åtgärd eller eget handgrepp efter avgörandet — kallan kraver det inte
uteslutet: ny migration eller schemaändring — kallan kraver det inte
uteslutet: förifyllt eller gissat tak i köposten — kallan kraver det inte
uteslutet: obligatoriskt tillägg vid varje utanför-avgörande — kallan kraver det inte
uteslutet: visning av `ledde_till_part_id` på signalsidan — kallan kraver det inte
uteslutet: spärr mot omavgörande av redan avgjord signal — kallan kraver det inte

---

Specen är 18 rader. Bärande val, för läsbarheten: Davids svar fäller CTO:ts fråga (eget handgrepp), så tillägget köas i `avgor_scopesignal`-anropet via `createApproval` direkt i handlerns transaktion — 1E:s eget mönster ("inte `executeAction`", tabellradens not för `andra_baseline`). `tillagg` är valfritt eftersom alla utanför-signaler inte blir tillägg och ett tomt/gissat tak vore ett fabricerat förslag; länken skrivs uteslutande i `andra_baseline`-handlern som per kömekaniken aldrig kör före `approveAction`.
```

## Utfall
Tester: 123 passed (123) · Granskning: GODKANT | Alla sju krav är uppfyllda med befintliga mönster (createApproval + writeAudit i samma transaktion, superRefine som `confirm_crm_value`, `form`-attribut utan skript, länken skriven enbart i  · Byggforsok: 1

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
