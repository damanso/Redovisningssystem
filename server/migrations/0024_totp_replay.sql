-- Fas A11-fix (grindfynd): TOTP-koder kunde återanvändas inom sitt ±1-stegsfönster
-- (~90 s), i strid med RFC 6238 §5.2. Vi lagrar det senast accepterade tidssteget
-- per användare och avvisar koder vars steg <= det senast använda (engångsbruk).

ALTER TABLE users ADD COLUMN totp_last_step bigint;
