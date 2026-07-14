-- Fas E1 (grindfynd): GDPR-radering måste kunna ta bort dokument som innehåller
-- personuppgifter (t.ex. genererade faktura-PDF:er som bär kundens namn/adress).
-- files fick bara SELECT/INSERT (0004). Lägg till DELETE, RLS-skyddat per bolag,
-- så att anonymiseringen kan radera PDF:er för OBOKFÖRDA fakturor (bokförda
-- fakturors underlag är räkenskapsinformation och behålls).
CREATE POLICY files_delete ON files FOR DELETE USING (app_has_company_access(company_id));
GRANT DELETE ON files TO app;
