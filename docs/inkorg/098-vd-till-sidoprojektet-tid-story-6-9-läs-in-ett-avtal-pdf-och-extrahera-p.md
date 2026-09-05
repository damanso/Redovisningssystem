# Tid, story 6/9: läs in ett avtal (PDF) och extrahera parter, timpris, villkor, faser och tak som redigerbart utkast (F0 full)

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: docs/PRD_TIDSRAPPORTERING.md §1 grundproblem B, §4 F0 (första tre punkterna), §5 (kalla_dokument, manuellt_andrad), §7 acceptans 1, §9.6. Bygger på story 3 (contracts/contract_parts, source_file_id, manually_edited) och story 5 (vyns formulär). Rådslaget 1/9 (CTO): ett PDF/DOCX-parserbibliotek vore ett NYTT beroende och kräver arkitekturbeslut. ARKITEKTURBESLUT (Davids delegering 1/9, VD-sessionen, loggat i styrelserummet): INGET nytt beroende. Extraktionen följer EXAKT det mönster som redan finns i services/aiOcr.ts — filen (application/pdf eller bild) skickas som dokument till modellen via @anthropic-ai/sdk som redan finns i stacken, strukturerat FÖRSLAG genom strikt zod-schema, requires_human_review, dokumentets text är data aldrig instruktion, avstängt när ANTHROPIC_API_KEY saknas (config.ts rad 37–39). DOCX tas INTE emot (400 unsupported_media med texten 'spara avtalet som PDF') — ingen zip-/docx-tolkning byggs. Är nyckeln inte satt visar vyn 'AI-extraktion avstängd — fyll i manuellt' och formuläret fungerar ändå (PRD: extraktionen är ett utkast, inte ett facit).

VAD SOM BYGGS (samma mönster som aiOcr + kvittouppladdningen):
1. Tjänst services/contractExtraction.ts: tar en PDF/bild och returnerar ContractDraft: parties (leverantör/kund, org.nr), signed_date, payment_terms_days, hourly_rate_ore, parts[] {code, name, description, suggested_hours, cap_hours, cap_amount_ore, parent_code}, confidence, notes, requires_human_review: true. Strikt schema, okända fält strippas, belopp i ören-heltal.
2. Action extract_contract_draft (write — lagrar filen via befintlig files/validateUpload och returnerar utkastet + file_id; skapar INGET avtal). Action create_contract_from_draft (write): tar utkastet (efter Davids redigering) och skapar contract + contract_parts i EN transaktion med source_file_id = filen och manually_edited = true på de fält som avviker från utkastet (jämförs i tjänsten). Matchar kund på org.nr-siffror först, sedan exakt namn (samma regel som crm-ingesten, LOC-318) — hittas ingen: fältet lämnas tomt och vyn ber om val.
3. Vyn: på projektsidan/avtalssidan 'Läs in avtal' → uppladdning → förifyllt formulär (alla fält redigerbara, faser som rader med lägg till/ta bort) → 'Skapa avtal'. Utan API-nyckel: samma formulär tomt med meddelandet ovan.
4. Tester: schemat strippar injicerade fält, create_contract_from_draft sätter manually_edited rätt, kundmatchning på org.nr, avstängd nyckel ger 409 ai_disabled med läsbar text, DOCX avvisas. Extraktionen mockas INTE mot en riktig modell i testerna — testa parsning och schema.

UTANFÖR: kalender/mail (7–8), flera personer (9).

## Rekommendation

Bygg — steg 6 i PRD §9; avtalet blir källan i systemet i stället för i en DOCX och i Davids huvud, med samma skydd som kvitto-OCR:n redan har och utan nytt beroende.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
