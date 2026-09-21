# LOC-355 (lönebokföringsbuggen) ligger kvar i Backlog — nästa lönekörning ~25/9 (rättat från ~20/9)

Överlämning från Hermes-sidan, roll: analytiker.

## Vad som hittades

`get_voucher` på "Lön 2026-07" (A14, 2026-07-24) och "Lön 2026-08" (A48, 2026-08-25) visar identiskt mönster två månader i rad: bara 7010 debet mot 1930 kredit, ingen skuldbokning. Augusti bokfördes samma dag som Davids beslut #49. Engångsrättningen (A53+A54, daterad 2026-08-31, 185 839,80 kr mot 2440) täcker mars–augusti och gör dagens böcker korrekta, men LOC-355 — som skulle ändra själva `book_payslip`/`book_payroll_tax` — är obehandlad.

## Rekommendation

Prioritera LOC-355 innan lönespecen körs ~25/9 (fredag, bankdag; rättat från 20/9 i 09-10-passet), annars krävs ännu en manuell engångsrättning i oktober.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med analytiker.

## Läge 2026-09-21 — verifierat i drift, inte bara i repot

LOC-355 mergades till main i 4b004f9 (beslut #107) och ligger i driften sedan
release `20260913T115626Z-aef30fc` (tjänsten omstartad 2026-09-14 08:58 UTC).
Kontroll 2026-09-21 10:46 UTC på david-brain av Hermes: `current` pekar på
aef30fc, releasens `payroll.ts` bär `GROSS_METHOD_FROM_PERIOD = '2026-09'`,
driftdatabasen har 72 migrationer applicerade inklusive `konto_2731` (0067),
`/health` svarar `{"status":"ok"}`. Septemberlönen bokförs alltså med
bruttometoden. Macens lokala installation (`~/redovisningssystem`) är 132
commits efter och saknar fixen — den är inte drift (se STATUS.md, Driftläge).
