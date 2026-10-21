-- Story 4.5 (FR-19): momsdeklarationens nollsatta rutor räknas ur bokföringen.
--
-- Rutorna 06, 07, 08, 20, 22, 23, 24, 37, 38 och 40 var alltid 0, och allt
-- underlag för omvänd skattskyldighet hamnade i ruta 21. Vilka konton som bär
-- rutorna är bolagets egen fråga: enligt Davids svar 2026-10-16 tar Hermes fram
-- kontona ur bolagets kontoplan och bokföring, och David godkänner listan i Att
-- göra. Listan är därför bolagets data och inte kod.
--
-- Tabellen har en enda skrivväg: setVatBoxAccounts i
-- services/vatDeclaration.ts, som körs av den känsliga åtgärden
-- set_vat_box_accounts först när en människa godkänt förslaget, och som ersätter
-- hela listan. Varje konto prövas mot bolagets kontoplan (assertAccountsExist) i
-- tjänsten vid godkännandet, innan något skrivs.
--
-- Ingen främmande nyckel mot `accounts`: standardkontona delas av alla bolag med
-- company_id NULL och har ingen nyckel (id, company_id), så husets sammansatta
-- nyckel går inte att använda (samma avvägning som 0075). Kontrollen görs i
-- tjänsten med husets assertAccountsExist.
--
-- Filen är additiv: en ny tabell som ingen tidigare release läser. En andra
-- körning ändrar ingenting.

CREATE TABLE IF NOT EXISTS vat_box_accounts (
  company_id     uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- Samma regler som åtgärdens schema, också för kod som inte går genom det:
  -- momskontona 2600–2699 bär rutorna 10–12, 30–32 och 48 genom sina intervall
  -- och kan inte stå i listan.
  account_number integer NOT NULL
    CHECK (account_number BETWEEN 1000 AND 9999 AND account_number NOT BETWEEN 2600 AND 2699),
  box            text NOT NULL
    CHECK (box IN ('06','07','08','20','21','22','23','24','37','38','40')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  -- Ett konto räknas i exakt en ruta.
  PRIMARY KEY (company_id, account_number)
);

-- Kategorin står först: ägandeprovet och Hermes agandegrans.py läser första ledet.
COMMENT ON TABLE vat_box_accounts IS
  'Kategori: ÄGD inställning. Bolagets kontolista för momsdeklarationens rutor 06–08, 20–24, 37–38 och 40. Skrivs bara av den känsliga åtgärden set_vat_box_accounts efter mänskligt godkännande, som ersätter hela listan. app har SELECT, INSERT och DELETE.';

ALTER TABLE vat_box_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE vat_box_accounts FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS vat_box_accounts_select ON vat_box_accounts;
CREATE POLICY vat_box_accounts_select ON vat_box_accounts FOR SELECT
  USING (app_has_company_access(company_id));

DROP POLICY IF EXISTS vat_box_accounts_insert ON vat_box_accounts;
CREATE POLICY vat_box_accounts_insert ON vat_box_accounts FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

DROP POLICY IF EXISTS vat_box_accounts_delete ON vat_box_accounts;
CREATE POLICY vat_box_accounts_delete ON vat_box_accounts FOR DELETE
  USING (app_has_company_access(company_id));

-- Ingen UPDATE: en ändrad lista är en ny lista, som ersätter den förra genom
-- DELETE och INSERT i godkännandets transaktion.
GRANT SELECT, INSERT, DELETE ON vat_box_accounts TO app;
