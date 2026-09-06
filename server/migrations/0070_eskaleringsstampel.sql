-- Uppdragsytan, våg 3 (story S5.1): eskaleringen får ett spår.
--
-- 0068 gav `uppdrag_scopesignal` allt utom en sak. Signalen bär vem som tände
-- den, när, ur vilken klausul, vilket underlag den vilar på och vad den till
-- slut avgjordes till — men INTE att den eskalerades. 1E Del 7 säger att
-- `eskalera: true` är ett giltigt anrop med tomt motiv, och utan den här
-- kolumnen hade det anropet inte lagrats någonstans: knappen i vyn hade varit
-- en knapp utan spår, och FR-7:s "eskalera direkt utan motivering" hade i
-- praktiken varit "eskalera direkt utan att det syns".
--
-- Filen är ADDITIV och gör exakt en sak: EN kolumn på EN befintlig tabell.
-- Ingen ny tabell, ingen ny trigger, ingen ny rättighet (0068:s
-- `GRANT SELECT, INSERT, UPDATE` på tabellen räcker), ingen backfill — det
-- finns ingen historik att härleda en eskalering ur, och en gissad stämpel vore
-- värre än ingen. Andra körningen är ett no-op.
--
-- Varför en TIDSSTÄMPEL och inte en boolean: NULL/NOT NULL bär samma ja/nej,
-- men tidpunkten svarar dessutom på "hur länge har det legat hos Eva?" — och
-- det är den frågan man faktiskt ställer om en eskalering. En boolean hade
-- behövt en andra kolumn för samma sak.
--
-- Varför INGEN motivkolumn: FR-7 säger att eskaleringen sker UTAN motivering.
-- En kolumn för ett motiv som ingen väg in kan fylla blir en tom kolumn som ser
-- ut som ett underlag — och nästa läsare skulle tro att tomheten betyder att
-- ingen skrev något, inte att fältet aldrig fanns.

ALTER TABLE uppdrag_scopesignal
  ADD COLUMN IF NOT EXISTS eskalerad_nar timestamptz;

COMMENT ON COLUMN uppdrag_scopesignal.eskalerad_nar IS
  'När signalen eskalerades. NULL = inte eskalerad. Utan motiv med flit (FR-7): eskaleringen ska kunna ske direkt, och ett obligatoriskt motiv hade gjort tröskeln till det som inte eskaleras.';
