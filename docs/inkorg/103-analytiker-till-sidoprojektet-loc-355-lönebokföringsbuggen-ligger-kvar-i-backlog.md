# LOC-355 (lönebokföringsbuggen) ligger kvar i Backlog — nästa lönekörning ~20/9 riskerar att upprepa felet

Överlämning från Hermes-sidan, roll: analytiker.

## Vad som hittades

`get_voucher` på "Lön 2026-07" (A14, 2026-07-24) och "Lön 2026-08" (A48, 2026-08-25) visar identiskt mönster två månader i rad: bara 7010 debet mot 1930 kredit, ingen skuldbokning. Augusti bokfördes samma dag som Davids beslut #49. Engångsrättningen (A53+A54, daterad 2026-08-31, 185 839,80 kr mot 2440) täcker mars–augusti och gör dagens böcker korrekta, men LOC-355 — som skulle ändra själva `book_payslip`/`book_payroll_tax` — är obehandlad.

## Rekommendation

Prioritera LOC-355 innan lönespecen körs runt 20/9 (rytm-kalendern), annars krävs ännu en manuell engångsrättning i oktober.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med analytiker.
