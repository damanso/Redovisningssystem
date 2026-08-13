-- Ej avdragsgilla kostnader ska HÄRLEDAS ur bokföringen, inte matas in för hand.
--
-- Vissa konton är ej avdragsgilla till sin natur (6072 representation ej
-- avdragsgill, 6992 övriga externa kostnader ej avdragsgilla). Bokför man en
-- kostnad där är den skattemässiga återläggningen i INK2S ruta 4.3 c en
-- FÖLJD av konteringen — men systemet krävde ändå en manuell tax_adjustment,
-- som var lätt att glömma. Flaggan nedan gör att INK2S kan räkna fram beloppet
-- direkt ur huvudboken.
--
-- Manuella justeringar finns kvar för det som INTE syns på ett eget konto
-- (t.ex. en ej avdragsgill del av en blandad kostnad). De två källorna
-- redovisas separat i INK2S så att inget dubbelräknas oupptäckt.

ALTER TABLE accounts ADD COLUMN is_non_deductible boolean NOT NULL DEFAULT false;

UPDATE accounts SET is_non_deductible = true
WHERE company_id IS NULL AND account_number IN (6072, 6992);
