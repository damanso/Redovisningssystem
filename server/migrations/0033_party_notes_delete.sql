-- Fas E1: GDPR-radering kräver att kontaktpersoner OCH anteckningar kan tas bort.
-- party_contacts hade redan DELETE-policy + grant (0013), men party_notes fick bara
-- SELECT/INSERT. För rätten till radering (GDPR art. 17) måste appen kunna ta bort
-- anteckningar (rena personuppgifter i CRM-lagret, utan bokföringsrättslig
-- bevarandegrund). Läggs till här, RLS-skyddat per bolag.
CREATE POLICY party_notes_delete ON party_notes FOR DELETE USING (app_has_company_access(company_id));
GRANT DELETE ON party_notes TO app;
