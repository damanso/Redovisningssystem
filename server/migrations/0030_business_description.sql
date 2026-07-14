-- Fas C3: verksamhetsbeskrivning till förvaltningsberättelsen (fri text som
-- användaren fyller i). Övriga delar (flerårsöversikt, förändring eget kapital,
-- resultatdisposition) beräknas ur bokföringen.

ALTER TABLE companies ADD COLUMN business_description text;
