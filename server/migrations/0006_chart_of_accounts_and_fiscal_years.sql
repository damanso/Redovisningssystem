-- BAS-kontoplan och räkenskapsår.
--
-- accounts: standardkonton (company_id IS NULL) delas av alla bolag; ett bolag
-- kan lägga till egna konton (company_id satt). Standardkonton seedas av
-- migrationsägaren INNAN RLS aktiveras (annars skulle insert-policyn blockera
-- ägaren när FORCE RLS gäller).

CREATE EXTENSION IF NOT EXISTS btree_gist;

CREATE TABLE accounts (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id     uuid REFERENCES companies(id) ON DELETE CASCADE,
  account_number integer NOT NULL CHECK (account_number BETWEEN 1000 AND 9999),
  name           text NOT NULL,
  account_type   text NOT NULL CHECK (account_type IN ('asset', 'liability', 'equity', 'revenue', 'expense')),
  is_active      boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now()
);
-- Kontonummer är unikt bland standardkonton, respektive per bolag.
CREATE UNIQUE INDEX accounts_standard_uk ON accounts (account_number) WHERE company_id IS NULL;
CREATE UNIQUE INDEX accounts_company_uk ON accounts (company_id, account_number) WHERE company_id IS NOT NULL;

-- Standard-BAS (kurerat urval av de vanligaste kontona — klart mer än de 19 som
-- den gamla koden hade, och täcker samtliga flöden: kund/leverantör, moms,
-- intäkter, kostnader, personal, finansiellt).
INSERT INTO accounts (account_number, name, account_type) VALUES
-- Klass 1: Tillgångar
(1010, 'Utvecklingsutgifter', 'asset'),
(1220, 'Inventarier och verktyg', 'asset'),
(1229, 'Ackumulerade avskrivningar på inventarier', 'asset'),
(1510, 'Kundfordringar', 'asset'),
(1512, 'Belånade kundfordringar', 'asset'),
(1519, 'Nedskrivning av kundfordringar', 'asset'),
(1630, 'Avräkning för skatter och avgifter (skattekonto)', 'asset'),
(1650, 'Momsfordran', 'asset'),
(1680, 'Andra kortfristiga fordringar', 'asset'),
(1710, 'Förutbetalda hyreskostnader', 'asset'),
(1790, 'Övriga förutbetalda kostnader och upplupna intäkter', 'asset'),
(1910, 'Kassa', 'asset'),
(1920, 'PlusGiro', 'asset'),
(1930, 'Företagskonto / checkkonto', 'asset'),
(1940, 'Övriga bankkonton', 'asset'),
-- Klass 2: Eget kapital och skulder
(2010, 'Eget kapital', 'equity'),
(2013, 'Egna uttag', 'equity'),
(2018, 'Egna insättningar', 'equity'),
(2019, 'Årets resultat (enskild firma)', 'equity'),
(2081, 'Aktiekapital', 'equity'),
(2091, 'Balanserad vinst eller förlust', 'equity'),
(2099, 'Årets resultat', 'equity'),
(2110, 'Periodiseringsfonder', 'equity'),
(2350, 'Andra långfristiga skulder till kreditinstitut', 'liability'),
(2440, 'Leverantörsskulder', 'liability'),
(2510, 'Skatteskulder', 'liability'),
(2610, 'Utgående moms, ospecificerad', 'liability'),
(2611, 'Utgående moms på försäljning inom Sverige, 25 %', 'liability'),
(2614, 'Utgående moms omvänd skattskyldighet, 25 %', 'liability'),
(2621, 'Utgående moms på försäljning inom Sverige, 12 %', 'liability'),
(2631, 'Utgående moms på försäljning inom Sverige, 6 %', 'liability'),
(2640, 'Ingående moms', 'liability'),
(2641, 'Debiterad ingående moms', 'liability'),
(2645, 'Beräknad ingående moms på förvärv från utlandet', 'liability'),
(2650, 'Redovisningskonto för moms', 'liability'),
(2710, 'Personalskatt', 'liability'),
(2730, 'Lagstadgade sociala avgifter och särskild löneskatt', 'liability'),
(2820, 'Kortfristiga skulder till anställda', 'liability'),
(2890, 'Övriga kortfristiga skulder', 'liability'),
(2990, 'Övriga upplupna kostnader och förutbetalda intäkter', 'liability'),
-- Klass 3: Rörelsens intäkter
(3001, 'Försäljning varor inom Sverige, 25 % moms', 'revenue'),
(3002, 'Försäljning varor inom Sverige, 12 % moms', 'revenue'),
(3003, 'Försäljning varor inom Sverige, 6 % moms', 'revenue'),
(3004, 'Försäljning varor inom Sverige, momsfri', 'revenue'),
(3041, 'Försäljning tjänster inom Sverige, 25 % moms', 'revenue'),
(3042, 'Försäljning tjänster inom Sverige, 12 % moms', 'revenue'),
(3043, 'Försäljning tjänster inom Sverige, 6 % moms', 'revenue'),
(3105, 'Försäljning varor till annat EU-land', 'revenue'),
(3308, 'Försäljning tjänster till annat EU-land', 'revenue'),
(3740, 'Öres- och kronutjämning', 'revenue'),
(3900, 'Övriga rörelseintäkter', 'revenue'),
(3990, 'Övriga ersättningar och intäkter', 'revenue'),
-- Klass 4: Material- och varukostnader
(4010, 'Inköp av material och varor', 'expense'),
(4056, 'Inköp av varor från annat EU-land, 25 %', 'expense'),
(4415, 'Inköp av varor från annat EU-land, momsfritt', 'expense'),
(4531, 'Inköp av tjänster från annat EU-land, 25 %', 'expense'),
(4600, 'Legoarbeten och underentreprenader', 'expense'),
-- Klass 5-6: Övriga externa kostnader
(5010, 'Lokalhyra', 'expense'),
(5020, 'El för belysning', 'expense'),
(5060, 'Städning och renhållning', 'expense'),
(5410, 'Förbrukningsinventarier', 'expense'),
(5460, 'Förbrukningsmaterial', 'expense'),
(5611, 'Drivmedel för personbilar', 'expense'),
(5910, 'Annonsering', 'expense'),
(6071, 'Representation, avdragsgill', 'expense'),
(6072, 'Representation, ej avdragsgill', 'expense'),
(6110, 'Kontorsmateriel', 'expense'),
(6212, 'Mobiltelefon', 'expense'),
(6230, 'Datakommunikation', 'expense'),
(6250, 'Postbefordran', 'expense'),
(6310, 'Företagsförsäkringar', 'expense'),
(6540, 'IT-tjänster', 'expense'),
(6570, 'Bankkostnader', 'expense'),
(6910, 'Licensavgifter och royalties', 'expense'),
(6991, 'Övriga externa kostnader, avdragsgilla', 'expense'),
-- Klass 7: Personalkostnader
(7010, 'Löner till kollektivanställda', 'expense'),
(7210, 'Löner till tjänstemän', 'expense'),
(7220, 'Löner till företagsledare', 'expense'),
(7510, 'Lagstadgade sociala avgifter', 'expense'),
(7690, 'Övriga personalkostnader', 'expense'),
(7830, 'Avskrivningar på inventarier och verktyg', 'expense'),
-- Klass 8: Finansiella och andra poster
(8310, 'Ränteintäkter från omsättningstillgångar', 'revenue'),
(8410, 'Räntekostnader för långfristiga skulder', 'expense'),
(8420, 'Räntekostnader för kortfristiga skulder', 'expense'),
(8910, 'Skatt på årets resultat', 'expense'),
(8999, 'Årets resultat', 'equity');

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE accounts FORCE ROW LEVEL SECURITY;

-- Standardkonton (company_id IS NULL) är läsbara för alla inloggade; egna konton
-- endast för medlemmar.
CREATE POLICY accounts_select ON accounts FOR SELECT
  USING (company_id IS NULL OR app_has_company_access(company_id));
CREATE POLICY accounts_insert ON accounts FOR INSERT
  WITH CHECK (company_id IS NOT NULL AND app_has_company_access(company_id));
CREATE POLICY accounts_update ON accounts FOR UPDATE
  USING (company_id IS NOT NULL AND app_has_company_access(company_id))
  WITH CHECK (company_id IS NOT NULL AND app_has_company_access(company_id));

GRANT SELECT, INSERT, UPDATE ON accounts TO app;

-- Räkenskapsår med periodlås. Överlappande år per bolag förhindras av en
-- exclusion-constraint.
CREATE TABLE fiscal_years (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  label      text NOT NULL,
  start_date date NOT NULL,
  end_date   date NOT NULL,
  is_locked  boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (end_date >= start_date),
  UNIQUE (company_id, label),
  EXCLUDE USING gist (
    company_id WITH =,
    daterange(start_date, end_date, '[]') WITH &&
  )
);

ALTER TABLE fiscal_years ENABLE ROW LEVEL SECURITY;
ALTER TABLE fiscal_years FORCE ROW LEVEL SECURITY;

CREATE POLICY fiscal_years_select ON fiscal_years FOR SELECT
  USING (app_has_company_access(company_id));
CREATE POLICY fiscal_years_insert ON fiscal_years FOR INSERT
  WITH CHECK (app_has_company_access(company_id));
CREATE POLICY fiscal_years_update ON fiscal_years FOR UPDATE
  USING (app_has_company_access(company_id))
  WITH CHECK (app_has_company_access(company_id));

GRANT SELECT, INSERT, UPDATE ON fiscal_years TO app;
