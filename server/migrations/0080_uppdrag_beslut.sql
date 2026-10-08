-- B-1, FR-41, FR-26 och NFR-12 (Story 1.7): beslutsraden. Det förslag David såg
-- och hans ja eller nej, fryst i ögonblicket. Raden skrivs bara av
-- verkställigheten (verkstallBeslut) efter mottagandet på köposten (0077), i
-- samma transaktion som domänhandlingen. Den ändras aldrig och räknas aldrig om.
-- Ingen vagrar_skrivning_pa_avslutat (architecture.md B-1, ”Avslutstriggern”):
-- avslutets ja skrivs efter stängningen, och ett nej på en köpost som väntade
-- när uppdraget stängdes ska ändå registreras. Skrivskyddet vid avslut ligger
-- på tabellerna som bär sakläget.

-- Beslutsraden knyts till sin köpost med sammansatt FK, så att den aldrig kan
-- hänga på ett annat bolags köpost (husmönstret, 0011/0053/0064). Nyckeln
-- (id, company_id) är det enda som läggs på action_approvals.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'action_approvals_id_company_uk') THEN
    ALTER TABLE action_approvals ADD CONSTRAINT action_approvals_id_company_uk UNIQUE (id, company_id);
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS uppdrag_beslut (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id    uuid NOT NULL REFERENCES companies(id) ON DELETE CASCADE,
  -- NULL bara för avslut: avslutet gäller hela projektet och bär inget
  -- godtyckligt valt avtal (samma regel som undantagsvyns uppslag, Story 1.6).
  contract_id   uuid,
  kalla_typ     text NOT NULL,
  kalla_id      uuid NOT NULL,
  approval_id   uuid NOT NULL,
  utfall        text NOT NULL,
  alternativ    text,
  underlag      jsonb NOT NULL,
  skal          text,
  handling      jsonb,
  utkast        jsonb,
  beslutad_av   uuid NOT NULL REFERENCES users(id),
  beslutad_nar  timestamptz NOT NULL,
  forslag_hash  text NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uppdrag_beslut_contract_fk FOREIGN KEY (contract_id, company_id)
    REFERENCES contracts (id, company_id),
  CONSTRAINT uppdrag_beslut_kopost_fk FOREIGN KEY (approval_id, company_id)
    REFERENCES action_approvals (id, company_id),
  CONSTRAINT uppdrag_beslut_kalla_typ
    CHECK (kalla_typ IN ('anteckning', 'kvitto', 'scopesignal', 'baselineforslag', 'avslut', 'koforslag')),
  CONSTRAINT uppdrag_beslut_avtal_utom_avslut CHECK ((contract_id IS NULL) = (kalla_typ = 'avslut')),
  CONSTRAINT uppdrag_beslut_utfall CHECK (utfall IN ('ja', 'nej')),
  CONSTRAINT uppdrag_beslut_alternativ CHECK (alternativ IS NULL OR alternativ IN ('tillagg', 'ryms')),
  CONSTRAINT uppdrag_beslut_skal_vid_nej CHECK (
    (utfall = 'nej' AND skal IS NOT NULL AND btrim(skal) <> '') OR (utfall = 'ja' AND skal IS NULL)),
  CONSTRAINT uppdrag_beslut_handling_vid_ja CHECK ((utfall = 'ja') = (handling IS NOT NULL)),
  CONSTRAINT uppdrag_beslut_utkast_vid_nej CHECK (utkast IS NULL OR utfall = 'nej'),
  CONSTRAINT uppdrag_beslut_underlag_objekt CHECK (jsonb_typeof(underlag) = 'object'),
  CONSTRAINT uppdrag_beslut_forslag_hash_form CHECK (forslag_hash ~ '^[0-9a-f]{64}$'),
  -- Idempotensen (B-1): ett förslag avgörs en gång per källa, och en köpost ger
  -- högst en rad. Indexen är sista försvarslinjen; ingen kod fångar krocken.
  CONSTRAINT uppdrag_beslut_en_per_kalla UNIQUE (company_id, kalla_typ, kalla_id, forslag_hash),
  CONSTRAINT uppdrag_beslut_en_per_kopost UNIQUE (approval_id)
);

CREATE INDEX IF NOT EXISTS uppdrag_beslut_avtal_idx
  ON uppdrag_beslut (company_id, contract_id, beslutad_nar, id);

COMMENT ON TABLE uppdrag_beslut IS
  'Kategori: FRYST HISTORIK, append-only. Det förslag David såg och hans ja eller nej, fryst i ögonblicket — räknas aldrig om (FR-41, B-1).';

ALTER TABLE uppdrag_beslut ENABLE ROW LEVEL SECURITY;
ALTER TABLE uppdrag_beslut FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS uppdrag_beslut_select ON uppdrag_beslut;
CREATE POLICY uppdrag_beslut_select ON uppdrag_beslut FOR SELECT
  USING (app_has_company_access(company_id));
DROP POLICY IF EXISTS uppdrag_beslut_insert ON uppdrag_beslut;
CREATE POLICY uppdrag_beslut_insert ON uppdrag_beslut FOR INSERT
  WITH CHECK (app_has_company_access(company_id));

GRANT SELECT, INSERT ON uppdrag_beslut TO app;
