-- Fas B3: ingående skattemässigt underskott (underskottsavdrag från tidigare år,
-- t.ex. inrullat från ett tidigare system). Systemet adderar sedan resultat från
-- räkenskapsår som redan finns i bokföringen. Belopp i heltal ören (>= 0).

ALTER TABLE companies
  ADD COLUMN opening_tax_loss_ore bigint NOT NULL DEFAULT 0
    CHECK (opening_tax_loss_ore >= 0);
