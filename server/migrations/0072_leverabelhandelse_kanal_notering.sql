-- Uppdragsytan S2.1, våg 1 (PRD FR-12): statusflödets två saknade övergångar får
-- sina två fält.
--
-- 0068 gav `uppdrag_leverabel` fem lägen men `bekrafta_statusbyte` (S3.2) kunde
-- bara flytta `pagar` vidare. `ej_paborjad → pagar` och `levererad → godkand`
-- saknade skrivväg helt — alltså kunde ett uppdrag aldrig nå ett avslut med TOM
-- öppna-lista, hur färdigt det än var. Åtgärderna `paborja_leverabel` och
-- `godkann_leverabel` är den vägen, och de behöver två fält som händelsetabellen
-- inte hade:
--
--   * `kanal` — HUR godkännandet kom. Ett godkännande är ett besked från
--     motparten, och beskedets form är hela dess bevisvärde: "sa ja på telefon"
--     och "skrev på i protokollet" är två olika saker den dag någon frågar. Fältet
--     är NULLBART med flit: `paborja_leverabel` är ingen överlämning och har ingen
--     kanal, och de rader S3.2 redan skrivit har ingen heller.
--   * `notering` — människans egna ord om steget. Fri text, aldrig obligatorisk:
--     ett tvingande fält lär den som har bråttom att skriva ".".
--
-- Filen är ADDITIV och gör exakt två saker: lägger de två nullbara kolumnerna och
-- villkoret som håller `kanal` inom sina fyra värden. Inget befintligt ändras —
-- ingen ny tabell, ingen ny trigger, ingen GRANT-ändring (0068 gav `app` SELECT +
-- INSERT på tabellen, och append-only står orört), ingen backfill: alla
-- befintliga rader får NULL i båda kolumnerna, vilket är sant om dem. Andra
-- körningen är ett no-op.
--
-- Varför ett CHECK-villkor och inte fri text: kanalen är en sluten uppräkning som
-- speglar zod-enumen i `paborja_leverabel`/`godkann_leverabel`. Två stavningar av
-- samma kanal ("mote" och "möte") är två kanaler för den som räknar dem, och
-- villkoret är den enda spärr som gäller även för kod som inte går genom
-- tjänstelagret — samma skäl som append-only ligger i rättigheterna.

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS kanal text;

ALTER TABLE uppdrag_leverabel_handelse
  DROP CONSTRAINT IF EXISTS uppdrag_leverabel_handelse_kanal_check;
ALTER TABLE uppdrag_leverabel_handelse
  ADD CONSTRAINT uppdrag_leverabel_handelse_kanal_check
  CHECK (kanal IS NULL OR kanal IN ('telefon', 'mejl', 'mote', 'protokoll'));

ALTER TABLE uppdrag_leverabel_handelse
  ADD COLUMN IF NOT EXISTS notering text;

COMMENT ON COLUMN uppdrag_leverabel_handelse.kanal IS
  'Hur godkännandet kom: telefon, mejl, mote eller protokoll. NULL = steget var ingen överlämning (påbörjande, retur) eller skrevs före 0072. Sätts bara av godkann_leverabel — mottagaren och kanalen hör ihop.';

COMMENT ON COLUMN uppdrag_leverabel_handelse.notering IS
  'Människans egna ord om steget. Fri text, aldrig obligatorisk, aldrig härledd av systemet. NULL = ingenting skrevs.';
