-- Fas A11: användarkonto & tvåfaktor (TOTP). Hemligheten lagras base32-kodad;
-- totp_enabled sätts först när användaren bekräftat en giltig kod. users har
-- avsiktligt ingen RLS (inloggning måste slå upp e-post innan identitet finns) —
-- åtkomst sker via explicita nyckelfiltrerade frågor i tjänstelagret.

ALTER TABLE users ADD COLUMN totp_secret text;
ALTER TABLE users ADD COLUMN totp_enabled boolean NOT NULL DEFAULT false;
