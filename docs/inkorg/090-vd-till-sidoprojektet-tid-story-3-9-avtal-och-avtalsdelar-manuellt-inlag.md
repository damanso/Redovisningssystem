# Tid, story 3/9: avtal och avtalsdelar (manuellt inlagda) på tidsposten + takbevakning 80 %/spärr (F0 minimal)

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md §1 rad 6, §3.2, §4 F0 (utom automatisk extraktion), F6 (avtalsdelar som kategorier), F7 (förbrukat mot tak), §5 Avtal/avtalsdel, §7 acceptans 2–3 och 11, §9.3. Bygger på story 1–2 (docs/byggen/). Davids beslut 1/9 (delegerat): avtalet MODELLERAS NU, extraktionen ur PDF/DOCX kommer i story 6; David lägger in ILT-avtalets struktur (§3.2) manuellt via actions när bygget är deployat.

VERKLIGHETEN: projects har hourly_rate_ore/budget_ore (0017) men ingen avtalsnivå; taket i PRD §1 rad 6 (Fas 2A 32 h/35 200 kr, passerat utan varning) kan inte uttryckas. Bilagan (0047) är rader per datum.

VAD SOM BYGGS (samma mönster som projects/work_actors: tjänstefil, actions i registret, migration i kedjan, RLS som 0017):
1. Migration: tabell contracts (id, company_id, project_id NOT NULL → projects, customer_id, name, signed_date, payment_terms_days, hourly_rate_ore, source_file_id → files (nullbar, för story 6), notes, created_by, created_at/updated_at) och contract_parts (id, company_id, contract_id, parent_part_id (ingar_i, självreferens, nullbar), code (t.ex. '2A'), name, description, billable boolean default true, hourly_rate_ore override nullbar, cap_hours numeric(8,2) nullbar, cap_amount_ore bigint nullbar, valid_from date (tilläggsavtal/ändrad omfattning: ny rad med senare valid_from ersätter takvärdena, historiken består), manually_edited boolean default false, sort_order, active). time_entries.contract_part_id uuid nullbar med komposit-FK. RLS + GRANT som 0017. Unik (contract_id, code, valid_from).
2. Actions: create_contract, update_contract, upsert_contract_part (skapar eller ändrar; manuellt ändrad sätts true vid ändring), list_contracts (med delar och förbrukning), get_contract_usage (per del: godkända+justerade+fakturerade billable_minutes, belopp, andel av tak, andel för föräldern när delar ingår i en fas). Alla sensitivity write/read enligt registrets mönster.
3. log_time och update_time_entry tar contract_part_id. Har projektet aktiva avtalsdelar KRÄVS contract_part_id (400 contract_part_required) — PRD F1 minimum är projekt + avtalsdel. Postens taxa: postens override, annars delens, annars avtalets, annars projektets (befintlig ordning bevaras i botten).
4. Takbevakning (F0 sista punkten, acceptans 3) — RÅDSLAGETS BESLUT 1/9 (VD, CLO, CFO, KVALITET): spärra ALDRIG registrering, spärra fakturering; varna aldrig på ett oläst tal. Därför: contract_parts får cap_confirmed boolean default false (taket är avläst ur avtalshandlingen av en människa) — ett tak som är NULL eller inte bekräftat visas som 'vet ej' med förbrukningen bredvid, utan varning. Vid log_time/update_time_entry beräknas delens förbrukning EFTER posten: bekräftat tak och ≥80 % → svaret bär warning {part, used, cap, share}; >100 % → warning med texten att avtalet kräver skriftligt besked till kunden om ändrad omfattning — posten sparas ändå, överskridandet loggas i auditloggen. Spärren ligger i create_invoice_from_time (story 2): en post över ett BEKRÄFTAT tak fakturerass bara med confirm_over_cap: true (409 cap_exceeded annars). Föräldradelens tak (Fas 1) räknas över barnen.
5. create_invoice_from_time (story 2) får appendix_layout: 'per_datum' (default — behåll formatet från faktura 0000027, rådslagets rekommendation för NVR-fakturan 30/9; bilageformatet per kund är Davids beslut) | 'per_avtalsdel' (PRD F6/acceptans 11: en rad per del, description = delens namn, minutes = summa, entry_date = periodens slutdatum, inga enskilda poster, inga datum). Fakturaraderna grupperas alltid per avtalsdel (beskrivning = delens code + name, quantity = timmar). Poster utan del (äldre) hamnar under 'Övrigt'.
6. docs/MCP_ACTIONS.md + STATUS.md. Tester: avtalsdel krävs när delar finns, taxaordningen, 80 %-varningen, spärren utan/med confirm_over_cap, föräldratak, bilagan per del utan datum, historik via valid_from.

UTANFÖR: rapportvyer (story 4), vyn för redigering (story 5), extraktion ur avtalsfil (story 6).

## Rekommendation

Bygg — steg 3 i PRD §9; ger takvarningen som saknades när Fas 2A passerades och gör bilagans kategorier till det avtalet säger.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
