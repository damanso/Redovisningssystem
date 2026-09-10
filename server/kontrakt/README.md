# Navigationskontraktet — den här kodbasens EGNA kopia

`navigation.v1.json` är produktens destinations- och adressregister: grupper,
destinationer, navigationsytor, ruttägarskap och beslutstillståndet för #157.

**Redigera aldrig filen här.** Den är genererad. Källan är
`02-Områden/hermes/navigation.v1.json` i Davids valv, som i sin tur skrivs av
`03-Resurser/scripts/navigation_kontrakt.py` ur Astras tabeller. Distributionen
görs av `~/.hermes/bin/sprid_kontraktet.sh`.

## Varför tre likadana filer

K-9: de tre kodbaserna ska förbli självständiga och utbytbara var för sig.
Ingen delad fil, ingen delad sökväg, ingen symlänk. Det som delas måste
dupliceras **medvetet** och bevakas av ett prov.

`~/.hermes/prov/adresskontraktet.py` gör bevakningen. Så snart en kopia finns
kräver provet alla tre, byte för byte, och jämför dessutom hela registret mot
vad källkoden faktiskt registrerar — ruttmönster plus monteringspunkt, läst ur
respektive språks syntaxträd.

Ändrar någon den här filen för hand blir provet rött med en gång, och det är
meningen. Vägen till en ändring går genom generatorn.

## Vad grönt inte säger

Provet läser de app- och routerfiler det räknar upp i sin egen utskrift. Rutter
som monteras någon annanstans ligger utanför dess räckvidd, och grönt säger
ingenting om dem.
