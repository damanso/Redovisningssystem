# Tid, story 4/9: rapporterna ofakturerad godkänd tid per kund + förbrukat mot tak per fas (F7), som action och som sida i vyn

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md §4 F7 (Rapport-punkten), §7 acceptans 10, §9.4. Bygger på story 1–3 (docs/byggen/): status/billable_minutes/invoice_id på time_entries, contracts/contract_parts med get_contract_usage. Davids beslut 1/9 (delegerat): rapporten ska finnas BÅDE som action (AI/MCP) och som JS-fri sida i /app — samma tjänstefunktion bakom, inga parallella vägar (ARKITEKTUR: ett flöde, tre ingångar).

VERKLIGHETEN: reports.ts bär dagens rapporter (monthly_revenue, top_customers, key_ratios m.fl.) som actions + vysidor i server/src/http/view/. Projektsidan i vyn visar tidposter per projekt (projects.ts rad 98–130) men ingen summering av vad som är fakturerbart och inte fakturerat.

VAD SOM BYGGS (samma mönster som befintliga rapporter i reports.ts + view/routes.ts):
1. Action unbilled_time_report (read): valfria filter customer_id, project_id, to (t.o.m. datum, default idag). Returnerar per kund → projekt → avtalsdel: antal poster, registrerade minuter, debiterbara minuter, belopp (billable_minutes/60 × gällande taxa i ören, samma taxaordning som story 3), äldsta work_date. Urval: status IN ('godkand','justerad') AND invoice_id IS NULL. Dessutom antal poster i status 'forslag' per projekt (obehandlade, räknas INTE i beloppet) så det syns när något väntar på beslut.
1b. Betalningsdimensionen (rådslaget 1/9, CFO): rapporten visar per kund tre kolumner bredvid varandra — godkänd men ofakturerad tid (belopp), fakturerad men obetald (öppna fakturor ur befintlig accounts_receivable_aging, med förfallodag), betald i perioden. Ingen ny beräkning: de två sista kommer ur befintliga fakturafunktioner.
1c. Stillhetsbevakning (rådslaget 1/9, CHRO — fel #3 i PRD §1, arbete som aldrig registrerades): action idle_projects_report (read): aktiva projekt utan registrerad tid (någon status) de senaste N dagarna (default 7, parameter). Rapportera ATT det ligger still, aldrig varför. Visas som egen tabell på sidan och ingår i unbilled_time_report-svaret som idle[].
2. Action contract_usage_report (read): alla aktiva avtal i bolaget med delar (och fasföräldrar): förbrukade timmar/belopp (godkand+justerad+fakturerad), tak, andel, status ('under 80 %', '80–100 %', 'över tak'), och ofakturerat inom delen. Återanvänder get_contract_usage (story 3) — ingen ny beräkning.
3. Vysida /app/c/:companyId/tid (ny toppnivå eller under Projekt enligt befintlig menygrammatik — följ den som finns i view/): två tabeller ur samma två tjänstefunktioner, med länk per rad till projektet. Poster i 'forslag' visas som en rad 'N förslag väntar' med länk (godkännandeytan kommer i story 8). Tomt läge med mänsklig copy som övriga sidor. Ingen JS.
4. docs/MCP_ACTIONS.md + STATUS.md sessionslogg. Tester: rapporten visar noll för en fakturerad period (acceptans 10), ignorerade poster syns aldrig i beloppet men räknas i registrerade minuter-kolumnen (Davids svar på öppen fråga 4: nedlagd tid ska synas i lönsamhetsvyn), fasförälderns andel, vysidan renderar (supertest, 200 + tabellrubriker).

UTANFÖR: redigering i vyn och bilagor (story 5), godkännandekön (story 8).

## Rekommendation

Bygg — steg 4 i PRD §9; rapporten är kontrollen som hade avslöjat både juli- och augustifelet, och den återanvänder story 3:s beräkning.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
