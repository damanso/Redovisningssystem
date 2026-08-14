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

**0. Kopplingen till kundregistret sker här, inte hos avsändaren.** Organisationen
knyts automatiskt till en kund i redovisningen när organisationsnumret eller
namnet matchar exakt. Det är avgörande: omsättning och koncentration hämtas via
just den kopplingen, så utan den räknar styrvyn noll — utan att något ser fel ut.
Går uppslaget inte att göra entydigt (flera kunder matchar, eller kunden hör
redan till en annan organisation) lämnas kopplingen tom **och namnet returneras i
`unlinked_organizations`**. En gissning vore värre än en tom koppling; ett tyst
nollresultat vore värst.

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
    "organizations_linked": 1,
    "unlinked_organizations": [],
    "kept_human_fields": [],
    "skipped": []
  }
}
```

`*_unchanged` betyder att händelsen redan fanns och uppdaterades i stället för
att dubbleras. Ett jobb som körs om ska ge idel `unchanged` — det är kvittot på
att synken är idempotent.

`kept_human_fields` listar de fält som **inte** skrevs, för att en människa
bestämt dem. Se nästa avsnitt.

## Människan vinner

Varje fält bär sitt ursprung: `human`, `sync`, `ai`, `accounting` eller
`import`. En skrivning från synken skriver **aldrig** över ett fält en människa
satt eller bekräftat. Det är inte artighet — utan regeln är det meningslöst att
rätta något, eftersom nästa körning sätter tillbaka gissningen i tysthet.

Filtreringen redovisas i `kept_human_fields` (`"Nordic Vision Retail AB:
org_number"`). En synk som tyst kastar bort en del av sin egen skrivning ser ut
som en synk som lyckades helt.

| Åtgärd | Gör |
| :---- | :---- |
| `get_crm_organization` | Returnerar `provenance` — ursprunget per fält, för organisationen och för varje person |
| `confirm_crm_value` | Bekräftar ett fält utan att ändra värdet: gissningen blir ett beslut och skyddas |

`upsert_crm_organization` tar `organization_id` när raden redan är känd. Utan den
matchas namnet, och då går namnet inte att rätta — en ändring hade lagt upp en ny
organisation bredvid den gamla. Krockar det nya namnet med en befintlig rad
avvisas skrivningen med `name_taken`; två rader för samma bolag ska slås ihop
(`merge_crm_organizations`), inte döpas om till varandra.

## Kadens, dubbletter och sökning

| Åtgärd | Gör |
| :---- | :---- |
| `set_crm_relation_nudge` | Skjut upp, tysta — och sätt `cadence_days` (egen tystnadsgräns; `null` = bolagets standard) |
| `merge_crm_organizations` | Slår ihop två organisationer. **Känslig** — går inte att ångra |
| `merge_crm_people` | Slår ihop två personer. **Känslig** |
| `search_crm` | Söker i relationer, personer, kundregistret och leverantörsregistret på en gång |

Sammanslagningen följer två regler: **ingenting kastas** (kontaktpunkter, löften
och personer flyttas över) och **tomma fält fylls, ifyllda rörs inte** — annars
vore sammanslagningen en väg runt regeln att människan vinner.

Två fall avvisas i stället för att gissas: organisationer som pekar på **olika**
kunder i redovisningen (`customer_conflict`) och personer med **olika**
e-postadresser (`email_conflict`). Det är då inte dubbletter.

Kadensen finns för att en gemensam tystnadsgräns passar ingen: en kund på
månadsretainer och en kund vartannat år kan inte dela gräns. Klockan nollställs
av **kontakt**, aldrig av inställningen.

## Gallring

`set_crm_retention` / `get_crm_retention` sätter och läser perioden i månader;
`purge_crm_data` kör gallringen (**känslig** — hamnar i Att göra). Allt tre går
också att sköta i vyn, under Relationer.

Gallringen körs **aldrig på en gissad period**: utan satt policy och utan
`older_than_months` avvisas anropet med `no_retention_period`.

Perioden är ett **verksamhetsbeslut, inte en följd av lagen.** Relationsdata är
inte räkenskapsinformation — det var hela skälet till ett eget schema — så
bokföringslagens sjuårskrav gäller verifikaten, inte mailhistoriken. Här styr
GDPR:s lagringsminimering. Locollabs har valt **84 månader (7 år)**.

Gallringen tar kontaktpunkter och stängda löften, och rensar dessutom
`source_ref`/`source_system` ur `crm.field_provenance` när källan de pekar på
gallrats bort — en pekare till ett raderat mail får inte överleva sin egen
gallring. Klassificeringen (`human`/`sync`/`ai`) beskriver värdet som står kvar
och behålls.

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
