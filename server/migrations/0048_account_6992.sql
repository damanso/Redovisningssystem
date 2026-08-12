-- 6992 saknades i standardkontoplanen: bolaget kunde bokföra avdragsgilla
-- övriga kostnader (6991) men inte de EJ avdragsgilla, trots att 6072
-- (representation, ej avdragsgill) redan fanns. Utan 6992 hamnade sådana
-- kostnader på ett avdragsgillt konto, vilket döljer dem i deklarations-
-- underlaget.
--
-- OBS: kontot bokför bara kostnaden. Den skattemässiga återläggningen i INK2S
-- (ruta 4.3 c) registreras fortfarande separat via tax_adjustments — systemet
-- härleder den medvetet inte automatiskt ur kontonumret.

INSERT INTO accounts (account_number, name, account_type)
VALUES (6992, 'Övriga externa kostnader, ej avdragsgilla', 'expense')
ON CONFLICT DO NOTHING;
