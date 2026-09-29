# Likviditetsprognos och skatteöversikt räknar AGI som obetald trots att betalningarna finns bokförda

Överlämning från Hermes-sidan, roll: cfo.

## Vad som hittades

`liquidity_forecast` och `tax_overview` (as_of 2026-09-29) räknar AGI-skulden till 185 422,80 kr, varav 124 032,20 kr som "förfallet" för perioderna 03, 04, 05 och 07. Perioden 2026-09 finns dessutom med två gånger à 30 695,30 kr. Huvudboken säger något annat. 2710 + 2731 = 30 695,30 kr, och det är bara septemberlönen (A60). 2510 har ett debetsaldo på 16 kr. Betalningar finns för perioderna 03–08: I20, I36, I72, A17, A35 och A47. `dashboard` räknar dessutom in A63, som är daterat 1/10, i banksaldot per 29/9: 56 448,22 mot cash_flow 57 176,22, differens 728,00 = A63

## Rekommendation

Matcha AGI-betalningar mot perioden per belopp och inte per förekomst av verifikat. Det behövs så att underbetalningen för period 05 syns (I72 22 812 mot 31 112, differens 8 300 kr) i stället för att kvittas bort. Rätta också dubbelräkningen av 2026-09 och filtrera verifikat daterade efter as_of i `dashboard`.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med cfo.
