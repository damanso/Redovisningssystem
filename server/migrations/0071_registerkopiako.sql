-- Uppdragsytan, våg 3 (story S7.2): kön till registrets frysta kopia får ett
-- fel-läge.
--
-- 0068 gav `uppdrag_referens` kolumnen `ko_status` med två lägen: 'koad' och
-- 'skriven' (NULL = inget köat). Det räcker så länge Drive alltid svarar. Gör
-- den inte det — filen delad om, kvoten slut, mappen flyttad — har Hermes
-- (S7.5) ingenstans att lägga sitt nej. Den enda kvarvarande utvägen hade varit
-- att lämna posten som 'koad', och då står ett fel som "väntar": exakt det tysta
-- fel NFR-3 finns för att förbjuda. Ett fel som inte lagras är ett fel som
-- ingen kan se, och en kö som ser tom ut töms aldrig.
--
-- Filen är ADDITIV och gör exakt två saker: utökar CHECK-villkoret med 'fel'
-- och lägger EN kolumn för feltexten. Ingen ny tabell, ingen ny trigger, ingen
-- GRANT-ändring (0068 gav redan `app` SELECT, INSERT och UPDATE på tabellen),
-- ingen backfill — befintliga rader har antingen NULL, 'koad' eller 'skriven',
-- och alla tre är fortsatt giltiga. Andra körningen är ett no-op.
--
-- Varför en TEXTKOLUMN och inte en felkod: den som läser uppdragssidan ska
-- kunna se VAD Drive sa. En kod hade krävt en översättningstabell i repot för
-- fel som uppstår i ett system repot aldrig ringer (ADR-4), och en kod utan
-- tabell är bara en sträng med sämre läsbarhet.
--
-- Varför ingen försöksräknare: repot provar aldrig om av sig självt (ingen
-- scheduler, inga externa anrop). Hermes hämtar kön vid nästa svep, och en
-- 'fel'-post ingår i hämtningen just därför — annars kunde kön aldrig tömmas
-- automatiskt när Drive svarar igen. Åldern på en fastnad post bevakas av
-- provvakten (`svepfarskhet.py`), inte av en kolumn här.

ALTER TABLE uppdrag_referens
  DROP CONSTRAINT IF EXISTS uppdrag_referens_ko_status_check;
ALTER TABLE uppdrag_referens
  ADD CONSTRAINT uppdrag_referens_ko_status_check
  CHECK (ko_status IS NULL OR ko_status IN ('koad', 'skriven', 'fel'));

ALTER TABLE uppdrag_referens
  ADD COLUMN IF NOT EXISTS ko_fel text;

COMMENT ON COLUMN uppdrag_referens.ko_status IS
  'NULL = inget köat. koad = väntar på att skrivas ut till källsystemet. skriven = klar. fel = försöket misslyckades och ko_fel bär texten; posten ingår ändå i hämtningen så att kön töms när källsystemet svarar igen.';

COMMENT ON COLUMN uppdrag_referens.ko_fel IS
  'Varför den senaste utskrivningen misslyckades, med källsystemets egna ord. NULL = inget fel. Nollställs när posten köas om eller rapporteras som skriven — ett gammalt fel bredvid ett lyckat försök är en lögn med tidsstämpel.';
