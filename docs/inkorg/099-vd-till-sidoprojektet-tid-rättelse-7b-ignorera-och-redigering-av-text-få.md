# Tid, rättelse 7b: Ignorera och redigering av text får aldrig kräva avtalsdel — kravet gäller bara när tid blir debiterbar (godkand/justerad)

Överlämning från Hermes-sidan, roll: vd.

## Vad som hittades

KÄLLA: acceptansverifiering PRD §7 mot driften 2/9 21:05 UTC (VD-sessionen, Davids delegering 1/9) + PRD F5 ('Ignorera (med orsak)' per rad) + beslut #104 ('Ignorera går alltid'). Bygger på story 1, 3, 7 (docs/byggen/beslut-095/101/104).

FYNDET (reproducerbart i drift): ett förslag skapat via propose_time_entries utan contract_part_id på ett uppdrag som har aktiva avtalsdelar (ILT) kan varken ignoreras eller få sin beskrivning ändrad: approve_time_entries {ids:[x], status:'ignorerad', adjustment_reason:'…'} → 400 contract_part_required, och update_time_entry {time_entry_id:x, description:'…'} → 400 contract_part_required. Kravet på avtalsdel (story 3, projects.ts) ligger i updateTimeEntry generellt, men PRD:n och #104 säger att kravet gäller först när tiden blir DEBITERBAR. En 0-minuters mailmarkering eller ett felaktigt förslag måste kunna ignoreras utan att först klassas — annars fastnar kön.

VAD SOM BYGGS (minsta ändring):
1. I tjänstelagret (projects.ts updateTimeEntry och det approve_time_entries går genom): contract_part_required kastas ENDAST när målstatus är 'godkand' eller 'justerad' (tid blir debiterbar) och posten saknar avtalsdel på ett uppdrag med aktiva delar. Övergång till 'ignorerad', samt ändring av description/work_date/minutes/links på en post i status 'forslag' eller 'ignorerad', kräver aldrig avtalsdel. Att SÄTTA contract_part_id är alltid tillåtet.
2. Samma regel i vyn /tid/forslag: Ignorera-knappen fungerar utan vald avtalsdel; Godkänn utan avtalsdel ger det befintliga felet med tydlig text.
3. Tester: ignorera förslag utan avtalsdel på uppdrag med delar (ok), ändra beskrivning på sådant förslag (ok), godkänna utan avtalsdel (400 contract_part_required kvarstår), godkänna med avtalsdel i samma anrop (ok). docs/MCP_ACTIONS.md + STATUS.md.

UTANFÖR: allt annat. Ingen migration.

## Rekommendation

Bygg — S-rättelse av ett drift-fynd som annars låser godkännandekön för varje förslag utan avtalsdel; ändrar bara var ett befintligt villkor prövas.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med vd.
