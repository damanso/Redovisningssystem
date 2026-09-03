-- LOC-355: bruttometoden för lön behöver ett skuldkonto för arbetsgivar-
-- avgiften som `book_payroll_tax` sedan kan tömma. 2710 (personalskatt) och
-- 7510 (kostnaden) finns sedan 0006 — det som saknades är avräkningskontot.
--
-- 2730 finns redan i 0006 som samlingskonto. 2731 är BAS underkonto för just
-- de lagstadgade avgifterna och är det konto bruttometodens verifikat
-- krediterar vid utbetalningen och debiterar vid skattekontobetalningen; att
-- blanda in 2730 hade lagt två metoders skuld på samma rad.
--
-- Idempotent som kedjans övriga kontotillägg (0048): standardkonto,
-- company_id IS NULL, ON CONFLICT DO NOTHING mot accounts_standard_uk.

INSERT INTO accounts (account_number, name, account_type)
VALUES (2731, 'Avräkning lagstadgade sociala avgifter', 'liability')
ON CONFLICT DO NOTHING;
