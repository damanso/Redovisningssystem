// Fixtur: leveranskontraktets STRUKTUR (NVR-001, fryst v1).
//
// Originalet ligger i Drive (`Min enhet/01_Kunder/Nordic Vision Retail/Fas 2/
// Leveranskontrakt-NVR-001-FRYST-v1-2026-09-03.md`) och skickas som indata till
// `importera_leveranskontrakt` — redovisningen läser aldrig Drive själv
// (ADR-4/NFR-1). Den här fixturen kopierar formen och de tal kravspecen fäster:
// ramen 430 h / 47 300 000 öre, sex leverabler med 40/70/205/40/40/20 h under
// sina strömmar, styrningen på 15 h (415 + 15 = 430) och sju signalfraser.
//
// `L6` saknar MED FLIT sin läsväg: ett kontraktsburet fält som inte står i
// texten ska bli NULL hela vägen ner i kolumnen och redovisas som saknat —
// aldrig gissas fram. Provet hänger på just den luckan.
export const LEVERANSKONTRAKT_NVR001 = `# Leveranskontrakt NVR-001 — FRYST v1 (2026-09-03)

Parter: Locollabs AB (leverantör) och Nordic Vision Retail AB (beställare).

## 1. Uppdragets ram

| Fält | Värde |
| --- | --- |
| Takvolym | 430 h |
| Takbelopp | 473 000 kr |
| Timtaxa | 1 100 kr |

## 2. Leverabler

### L1 — Nulägeskartläggning

| Fält | Värde |
| --- | --- |
| Ström | S1 |
| Takvolym | 40 h |
| Klausul | 2.1 |
| Acceptanskriterium | Kartan genomgången med styrgruppen och protokollförd |
| Uppföljningsmått | Antal kartlagda flöden |
| Måttets läsväg | arenden |

### L2 — Målbild och lösningsdesign

| Fält | Värde |
| --- | --- |
| Ström | S1 |
| Takvolym | 70 h |
| Klausul | 2.2 |
| Acceptanskriterium | Designen godkänd skriftligt av beställaren |
| Uppföljningsmått | Antal beslutade designval |
| Måttets läsväg | arenden |

### L3 — Byggnation av integrationslagret

| Fält | Värde |
| --- | --- |
| Ström | S2 |
| Takvolym | 205 h |
| Klausul | 2.3 |
| Acceptanskriterium | Samtliga testfall gröna i acceptanstestmiljön |
| Uppföljningsmått | Andel gröna testfall |
| Måttets läsväg | register |

### L4 — Migrering av produktdata

| Fält | Värde |
| --- | --- |
| Ström | S2 |
| Takvolym | 40 h |
| Klausul | 2.4 |
| Acceptanskriterium | Avstämd datamängd utan differenser |
| Uppföljningsmått | Antal migrerade artiklar |
| Måttets läsväg | register |

### L5 — Utbildning av superanvändare

| Fält | Värde |
| --- | --- |
| Ström | S3 |
| Takvolym | 40 h |
| Klausul | 2.5 |
| Acceptanskriterium | Samtliga superanvändare genomförda och kvitterade |
| Uppföljningsmått | Antal utbildade superanvändare |
| Måttets läsväg | kalender |

### L6 — Överlämning till förvaltning

| Fält | Värde |
| --- | --- |
| Ström | S3 |
| Takvolym | 20 h |
| Klausul | 2.6 |
| Acceptanskriterium | Förvaltningsdokumentationen mottagen av beställaren |
| Uppföljningsmått | Antal överlämnade rutiner |

### STYRNING — Projektstyrning och rapportering

| Fält | Värde |
| --- | --- |
| Takvolym | 15 h |
| Klausul | 2.7 |

## 5. Omfattning

### 5.1 Innanför uppdraget

| Rad | Klausul |
| --- | --- |
| Integration mot beställarens befintliga affärssystem | 5.1 a |
| Migrering av produktdata från Navision | 5.1 b |
| Utbildning av upp till sex superanvändare | 5.1 c |
| Förvaltningsdokumentation på svenska | 5.1 d |

### 5.2 Utanför uppdraget

| Rad | Klausul |
| --- | --- |
| Löpande förvaltning efter överlämningen | 5.2 a |
| Licenskostnader hos tredje part | 5.2 b |
| Migrering av historik äldre än tre år | 5.2 c |
| Anpassningar av beställarens e-handelsplattform | 5.2 d |

### 5.3 Signalfraser

| Fras | Klausul |
| --- | --- |
| kan ni även | 5.4 |
| det borde väl gå att | 5.4 |
| en liten sak till | 5.4 |
| medan ni ändå är inne i systemet | 5.4 |
| vi antog att det ingick | 5.4 |
| bara en snabb | 5.4 |
| kan ni titta på det här också | 5.4 |

## 6. Rapportering och godkännande

| Fält | Värde |
| --- | --- |
| Godkännare | Styrgruppen |
| Eskalering | Eva Larsson |
| Rapporteringstakt | Varannan vecka |

## Bilaga 1 — Faser

| Kod | Ström | Start | Slut |
| --- | --- | --- | --- |
| S1 | Analys och design | 2026-09 | 2026-10 |
| S2 | Byggnation och migrering | 2026-10 | 2027-02 |
| S3 | Införande och överlämning | 2027-02 | 2027-03 |
`;
