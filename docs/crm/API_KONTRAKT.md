# API-kontrakt: kontaktpunkter och åtaganden in i CRM-ytan

Det här dokumentet beskriver gränssnittet mellan **redovisningssystemet** (det
här repot) och **källsystemen** för relationsdata: mailindexet, kalendern och
Linear, som ligger hos Hermes på VPS:en.

Riktningen är enkelriktad och det är avsiktligt:

> **Redovisningssystemet ringer aldrig Hermes.** Det tar emot. All integration,
> all polling och all tolkning av mail bor på andra sidan kontraktet. Det här
> repot äger relationsdatan när den väl kommit in — inte vägen dit.

Skälet är att en integration som det här repot äger blir ännu en sak som kan gå
sönder i tysthet, i ett system vars huvuduppgift är bokföring. Kontraktet
flyttar den risken dit den hör hemma.

## Anropet

`POST /api/companies/<company_id>/actions/ingest_crm_events`

Auth: `Authorization: Bearer <token>` — antingen en användares token eller ett
agent-token som är låst till bolaget. `company_id` härleds ur medlemskapet;
det som står i anropskroppen kan aldrig flytta data till ett annat bolag.

```jsonc
{
  "events": [
    {
      "kind": "interaction",
      "organization": { "name": "Nordic Vision Retail AB" },
      "person": { "name": "Eva Larsson", "email": "eva@nvr.example", "role_title": "Ekonomichef" },
      "occurred_at": "2026-08-12T09:14:00Z",
      "channel": "email",
      "direction": "inbound",
      "summary": "Svar om pilotens omfattning.",
      "source_system": "gmail",
      "source_ref": "gmail:18f2c9a1b7"
    },
    {
      "kind": "commitment",
      "organization": { "name": "Nordic Vision Retail AB" },
      "person": { "name": "Eva Larsson", "email": "eva@nvr.example" },
      "commitment_direction": "we_owe",
      "body": "Skicka tidplan för pilotens fas 2.",
      "due_date": "2026-08-20",
      "occurred_at": "2026-08-12T09:20:00Z",
      "source_system": "gmail",
      "source_ref": "gmail:18f2c9a1b7#commit-1"
    }
  ]
}
```

Max 500 händelser per anrop.

## De fyra reglerna

**1. Naturliga nycklar, inte våra id:n.** Avsändaren känner inte systemets
uuid:n och ska inte behöva göra det. Organisationen slås upp på namn,
personen på e-post när den finns och annars på namn. Saknas de skapas de.
Det är själva poängen: ingen människa ska behöva lägga upp en kontakt i förväg
för att ett mail ska kunna registreras.

**2. `source_ref` är inte valfri i praktiken.** Den är formellt frivillig, men
utan den kan samma händelse inte kännas igen vid nästa körning, och ett
nattjobb som körs om lägger då en dubblett varje gång. Databasen har ett unikt
index på `(company_id, source_system, source_ref)`. Skicka källans eget id —
mail-id, kalenderhändelse, ärendenyckel.

**3. En trasig händelse stoppar inte batchen.** Varje händelse körs i en egen
savepoint. Det som inte gick igenom returneras i `skipped` med index och skäl.
Ett jobb som faller på rad 400 och rullar tillbaka de 399 första är värre än ett
som levererar 399 och säger vad som fattades.

**4. En raderad källa kan inte återuppspelas.** När en kund raderats enligt
GDPR sparas källnycklarna som gravstenar. Skickas samma historiska händelser om
avvisas de (`skipped` med skälet att källan är raderad enligt GDPR) i stället för
att återskapa personen och mailsammanfattningarna. Nya händelser — nya
`source_ref` — släpps igenom som vanligt: det är ny behandling med ny grund.

**5. Tidrapportering är inte en giltig källa.** `source_system` accepterar
`gmail`, `calendar`, `linear` och `manual`. Databasen avvisar allt annat.
Skälet är mätt, inte principiellt: två av tre aktiva projekt har noll loggade
minuter men betalda fakturor, så en "senaste kontakt" byggd på tidrapporter
hade visat den största kunden som kontaktlös.

## Svaret

```jsonc
{
  "status": "ok",
  "action": "ingest_crm_events",
  "result": {
    "received": 2,
    "interactions_created": 1,
    "interactions_unchanged": 0,
    "commitments_created": 1,
    "commitments_unchanged": 0,
    "organizations_created": 1,
    "people_created": 1,
    "skipped": []
  }
}
```

`*_unchanged` betyder att händelsen redan fanns och uppdaterades i stället för
att dubbleras. Ett jobb som körs om ska ge idel `unchanged` — det är kvittot på
att synken är idempotent.

## Vad som räknas fram på den här sidan

Ingenting av det nedanstående ska skickas in — det härleds ur det som kommit in
och ur bokföringen, vid läsning, så att det aldrig kan bli inaktuellt:

| Åtgärd | Svarar på |
| :---- | :---- |
| `crm_relation_state` | Senaste kontakt, öppna och förfallna åtaganden, omsättning 12 mån och andel av total, per organisation |
| `crm_silence_report` | Vilka vi varit tysta mot längre än gränsen (standard 30 dagar, parameter) |
| `crm_contact_suggestions` | Vilka som bör kontaktas och **varför**, sorterat efter vad relationen är värd |

Senaste kontakt räknas på organisationen **och** dess personer: ett mail till
kundens beställare är kontakt med kunden.

## Det systemet aldrig gör

`crm_contact_suggestions` är en läsning. Systemet föreslår; människan skriver
och skickar. Det finns ingen väg härifrån ut till en kund — inte mail, inte
påminnelser, ingenting. Den spärren är inte en inställning som kan slås på.
