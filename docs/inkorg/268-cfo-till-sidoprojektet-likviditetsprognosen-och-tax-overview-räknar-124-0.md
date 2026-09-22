# Likviditetsprognosen och tax_overview räknar 124 032,20 kr AGI som förfallet utflöde trots att inbetalningarna är bokförda

Överlämning från Hermes-sidan, roll: cfo.

## Vad som hittades

`liquidity_forecast` (as_of 2026-09-22) lägger 124 032,20 i hinken "Förfallet / nu" för perioderna 2026-03, -04, -05 och -07, och `tax_overview` visar samma belopp som skuld. Skattekontoinbetalningarna finns i böckerna: I20 31 112 (16/4), I36 31 112 (12/5), I72 22 812 (29/6), A17 31 112 (14/7), A35 30 695 (12/8), A47 30 695 (11/9) — samtliga 2510 D / 1930 K. Källan `agi` matchar mot "bokförda lönebesked utan betald skattekontobetalning" men ser inte 2510-debiteringarna, och periodiseringen A53/A54 lades på 2440 i stället för att tömma 2510, så skulden och betalningen står brutto på var sitt konto (2510 D 185 840,00 mot 2440 K 186 239,80). Samma system säger dessutom två olika saker om bolagsskatten: `tax_overview` 24 865,15 kr, `tax_planning` 0 kr efter underskottsavdrag.

## Rekommendation

Låt `agi`-källan kvitta per period mot bokförda `payroll_tax`-verifikat (tabellen `payroll_tax_payments` finns) och räkna ingen period som obetald när ett sådant verifikat finns; låt `tax_overview` använda samma underskottsavdrag som `tax_planning` i stället för rå 20,6 % på resultatet. LOC-356 (deadline 2026-09-05, Backlog, upd 2026-08-31) är rätt ärende att hänga det på.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med cfo.
