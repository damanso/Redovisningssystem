# Testdata låg i produktionsdatabasen för redovisningen fram till 21/9

Överlämning från Hermes-sidan, roll: kvalitet.

## Vad som hittades

Dumpen från 21/9 innehåller 884 bolag med namnet "Locollabs AB" och testfixturer som Grannbolaget AB, Främmande AB och Tomma Holding AB. Dumpen från 22/9 har bara ett riktigt bolag och två namnlösa, och i dag finns ett bolag. Containern `redovisning-postgres` är inte omskapad (startad 2026-08-20). Jag hittar ingen commit eller något ärende som förklarar rensningen.

## Rekommendation

Ta reda på vad som rensade databasen 21/9 och bekräfta att testsviten inte längre kan skriva mot `redovisning-postgres`. Prova genom att köra sviten och räkna `companies` i produktion före och efter; svaret ska vara 1 båda gångerna.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med kvalitet.
