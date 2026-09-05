# Bygge beslut #111 — En additiv migration (0068_uppdragsytan.sql) enligt 1E §3.1–3.4: fjorton kolumner i contracts/contra

Datum: 2026-09-05 23:08 · Branch: cto/en-additiv-migration-0068-uppdragsytan-s-111 · Overlamning: #109

## Mal
En additiv migration (0068_uppdragsytan.sql) enligt 1E §3.1–3.4: fjorton kolumner i contracts/contract_parts/receipts, sju nya uppdrag_*-tabeller med RLS/sammansatta FK:er, fyra triggerfunktioner (versionstvång, frysspärr, avfrysningsförbud, avslutsskydd) samt backfill kontrakt_tillstand='fryst' för signerade avtal.

## Kravspec (claude-fable-5) — sjalvbarande, med KALLA och ARKITEKTUR
```
(kravspecen sparades inte av den ursprungliga korningen — overlamningen ar kallan)
---
typ: överlämning
id: 109
från: vd
till: sidoprojektet
status: öppen
skapad: '2026-09-05 19:00'
---

# Uppdragsytan S1.1 (våg 1): migration 0068 — fjorton kolumner i tre befintliga tabeller, sju nya tabeller, fyra triggerfunktioner, backfill av kontrakt_tillstand

> Överlämnad av **vd** till **sidoprojektet** 2026-09-05. Mottagaren svarar antingen *tar över* eller ställer **en** fråga till David i beslutskön.

## Vad som hittades

KÄLLA: Uppdragsytan BMAD 1E — /home/hermes/brain/02-Områden/hermes/uppdragsytan-1e-arkitektur.md, Del 3 (3.1 tilläggen och triggrarna: SQL:en står där ordagrant; 3.2 dom sju nya tabellerna; 3.4 regler i schemat inkl. avslutsskyddet i fyra räckvidder och GRANT exakt per tabell), 1F story S1.1 (uppdragsytan-1f-epics-stories.md), 1H våg 1 (uppdragsytan-1h-vagor.md). Granskad av fable i åtta pass, körning 10 den 5/9, 1G GODKÄND samma dag. Davids mandat 3/9 och 5/9: bygg hela vägen. docs/ARKITEKTUR.md är lag — det här är en additiv migration, ingen arkitekturändring.

VERKLIGHETEN: högsta migration är 0067_konto_2731.sql; db/migrate.ts är framåt-enbart utan DOWN, BEGIN/COMMIT per fil. contracts och contract_parts finns sedan 0064 (contracts.project_id NOT NULL → projects; contract_parts_id_company_uk UNIQUE (id, company_id) gör en sammansatt FK från receipts byggbar). receipts (0010) saknar project_id och contract_part_id. services/contracts.ts upsertContractPart uppdaterar cap_hours in-place på en befintlig (contract, code, valid_from)-rad — det flödet får INTE brytas: triggern får bara frysa ramen på rader där cap_confirmed redan är true. Husmönster för RLS/GRANT: 0003, 0047, 0065 (GRANT bara det som behövs, aldrig REVOKE); RLS-policyn i 34 migrationer är USING (app_has_company_access(company_id)).

VAD SOM BYGGS — server/migrations/0068_uppdragsytan.sql, exakt enligt 1E §3.1–3.4:
1. contract_parts: start_date date, end_date date, date_precision text CHECK IN ('ar','halvar','kvartal','manad','dag'), change_reason text.
2. contracts: kontrakt_tillstand text NOT NULL DEFAULT 'utkast' CHECK IN ('utkast','fryst'); avslutat_med_oppna text[]; troskel_procent numeric(5,2) NOT NULL DEFAULT 5.00; troskel_golv_ore bigint NOT NULL DEFAULT 2200000; troskel_golv_timmar numeric(8,2) NOT NULL DEFAULT 20.00; troskel_dagar integer NOT NULL DEFAULT 5; godkannare text; godkannare_eskalering text.
3. receipts: contract_part_id uuid, oplanerad boolean NOT NULL DEFAULT false, CONSTRAINT receipts_contract_part_fk FOREIGN KEY (contract_part_id, company_id) REFERENCES contract_parts (id, company_id) — INGEN ON DELETE-klausul.
4. FYRA triggerfunktioner, definierade FÖRE sina triggrar: (a) kraver_orsak_vid_ny_version() med TG_OP-grenar — INSERT: andra rad med samma (contract_id, code) utan change_reason fälls, med "AND id <> NEW.id"; UPDATE: om OLD.cap_confirmed och (cap_hours/cap_amount_ore/valid_from/start_date/end_date/date_precision/parent_part_id/hourly_rate_ore ändras — IS DISTINCT FROM — eller NOT NEW.cap_confirmed) → RAISE 'bekräftad baseline för avtalsdel % ändras inte in-place — skriv en ny version med change_reason'; obekräftad rad får ändras; name/description/sort_order/active får alltid ändras. (b) vagrar_baseline_i_utkast(): NEW.cap_confirmed på kontrakt i 'utkast' → RAISE 'bekräftat tak kräver fryst kontrakt'. (c) vagrar_avfrysning() på contracts BEFORE UPDATE: fryst→utkast → RAISE 'ett fryst kontrakt går inte tillbaka till utkast'. (d) vagrar_skrivning_pa_avslutat(): vägrar skrivning när projects.status='closed' — i FYRA räckvidder: dom sju uppdrag_*-tabellerna (via contract_id→contracts.project_id), contract_parts (via contracts.project_id), receipts när contract_part_id ändras, och time_entries när contract_part_id ändras (via contract_parts→contracts→projects; assignContractPart i services/contracts.ts:749 kollar aldrig projects.status, därför sitter spärren i schemat). Använd TG_TABLE_NAME för att hitta contract_id per tabell. Triggrar: contract_parts BEFORE INSERT OR UPDATE för (a), (b), (d); contracts BEFORE UPDATE för (c); receipts BEFORE UPDATE OF contract_part_id för (d); time_entries BEFORE UPDATE OF contract_part_id för (d); dom sju modultabellerna BEFORE INSERT OR UPDATE OR DELETE för (d).
5. Kantkontroll FÖRE backfillen: DO $$ ... IF EXISTS (contract_parts p JOIN contracts c ... WHERE p.cap_confirmed AND c.signed_date IS NULL) THEN RAISE EXCEPTION 'osignerat avtal har bekraftade tak — avgor manuellt fore 0068'. Backfill, den enda: UPDATE contracts SET kontrakt_tillstand='fryst' WHERE signed_date IS NOT NULL.
6. Sju nya tabeller med kolumner enligt 1E §3.2: uppdrag_leverabel (contract_id, kod, klausul, acceptanskriterium, uppfoljningsmatt, matt_lasvag CHECK IN ('redovisning','arenden','register','kalender'), status CHECK IN ('ej_paborjad','pagar','levererad','godkand','avvisad'); UNIQUE (contract_id, kod); INGEN status_sedan-kolumn), uppdrag_leverabel_handelse (leverabel_id, fran, till, bekraftat_av, bekraftat_nar, revision, mottagare — append-only), uppdrag_bedomning (contract_id, period_start, period_slut, handelse_ref_ids uuid[], lage CHECK IN ('pa_spar','risk','ur_spar'), satt_av_manniska NOT NULL, kommentar, frysta_siffror jsonb — oföränderlig), uppdrag_scopelinje (contract_id, sort CHECK IN ('innanfor','utanfor','fras'), text, klausul, ordning), uppdrag_scopesignal (contract_id, fras, klausul, tand_av, tand_nar, avgjord CHECK IN ('innanfor','utanfor') NULL, underlag_ref_id, ledde_till_part_id), uppdrag_referens (contract_id, sort CHECK IN ('drive','kalender','mejl'), extern_id, extern_nyckel, extern_kalla, titel_vid_lankning, hash_vid_lankning, senast_verifierad, status CHECK IN ('levande','drift','trasig'), ko_status CHECK IN ('koad','skriven') NULL), uppdrag_svepvarde (contract_id, nyckel, varde jsonb, kalla, last_nar). Alla sju: id uuid PK DEFAULT gen_random_uuid(), company_id uuid NOT NULL, created_at; contract_id med sammansatt FK (contract_id, company_id) → contracts (id, company_id); ENABLE ROW LEVEL SECURITY + policy USING (app_has_company_access
```

## Utfall
Tester: 110 passed (110) · Granskning: GODKANT | Båda tidigare fynden är rättade i sak och i text: ingressen namnger nu `uppdragSvep.ts` som enda services-ändringen med #109-motiveringen, och grindstycket avser branchens slutläge — rättels · Byggforsok: ateruppning

## Modellkedja (Davids krav 17/8)
Krav+granskning: claude-fable-5 · Utveckling: claude-opus-5 · Claude Code pa Davids abonnemang — inga API-tokens
