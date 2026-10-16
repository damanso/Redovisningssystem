// SYNTETISK formfixtur i v3:s form. Detta är INTE NVR-001:s kontrakt och inget belägg för vad det innehåller.
// Texten är skriven för formprov: samma markdownform som `leveranskontrakt-nvr-001-v3.ts`
// men andra koder, månadsintervall, fyra leverabler, annan ram och annan styrning
// (Story 2.1, kriterium 2 och 8). Ändras den, ändras proven som läser den i samma ändring.
export const LEVERANSKONTRAKT_SYNTETISK_V3FORM = `---
typ: leveranskontrakt
projekt: TEST-002
kontrakt_tillstand: fryst
---

# Leveranskontrakt TEST-002 - syntetiskt

**Kund:** Provbolaget AB · **Period:** 1 jan till 30 jun 2027 · **Ram:** 120 000 SEK exkl moms · **Timmar:** ca 100 · **Beläggning:** ca 20 %

## 2. Leveranskartan

| Id | Leverabel | Klausul | Acceptanskriterium (förslag) | Uppföljningsmått |
|---|---|---|---|---|
| L1 | Kartläggning av nuläget | §1.1 | Kartan godkänd av beställaren | Datum för godkännandet |
| L2 | Kravspecifikation | §1.2 | Specifikationen signerad | Antal signerade avsnitt |
| L3 | Upphandlingsunderlag | §1.3 | Underlaget publicerat | Publiceringsdatum |
| L4 | Slutrapport | §1.4 | Rapporten mottagen | Mottagen, binärt |

### Timfördelning per leverabel

| Fas (Bilaga 1) | Veckor | Timmar | Andel | Går till |
|---|---|---|---|---|
| 1 Analys | v.1-8 | ~70 | 70 % | L1, L2 |

| Id | Leverabel | Timmar | Härledd ur |
|---|---|---|---|
| L1 | Kartläggning av nuläget | 30 | fas 1 |
| L2 | Kravspecifikation | 40 | fas 1 |
| L3 | Upphandlingsunderlag | 20 | fas 2 |
| L4 | Slutrapport | 5 | fas 3 |
| - | Veckomöten med beställaren | 5 | ej leverabel |
| | **Summa** | **100** | |

## 8. Delarna som strömmar

| Kod | Ström | Veckor (Bilaga 1) | Start | Slut |
|---|---|---|---|---|
| DEL1 | Analys | - | 2027-01 | 2027-02 |
| DEL2 | Upphandling | - | 2027-03 | 2027-05 |
| DEL3 | Avslut | - | 2027-06 | 2027-06 |

| Leverabel | Ström | Skäl |
|---|---|---|
| L1 | DEL1 | analys |
| L2 | DEL1 | analys |
| L3 | DEL2 | upphandling |
| L4 | DEL3 | avslut |
| Veckomöten med beställaren (STYRNING) | - | inte en leverabel |
`;
