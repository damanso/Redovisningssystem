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

För kontaktpunkter från `gmail` och `calendar` är grundnyckeln delen före
första `#` i `source_ref`, och en organisation har högst en kontaktpunkt per
grundnyckel. Samma händelse med nyckeln `<grund>#<domän>` i stället för
`<grund>`, eller tvärtom, eller med ett annat domänsuffix, i samma organisation
är samma kontaktpunkt: den räknas som `interactions_unchanged` och behåller sin
första källnyckel. Det gäller också när samma nyckel redan finns i en annan
organisation: organisationens egen kontaktpunkt vinner. Samma grundnyckel i en
annan organisation blir en egen kontaktpunkt, med ett undantag: kommer exakt
samma `source_ref` för en organisation som saknar grunden, flyttas den
befintliga kontaktpunkten dit, eftersom mailet då har klassats om. Löften och
övriga källsystem jämförs på hela nyckeln.

**3. En trasig händelse stoppar inte batchen.** Varje händelse körs i en egen
savepoint. Det som inte gick igenom returneras i `skipped` med index och skäl.
Ett jobb som faller på rad 400 och rullar tillbaka de 399 första är värre än ett
som levererar 399 och säger vad som fattades.

**4. En raderad källa kan inte återuppspelas.** När en kund raderats enligt
GDPR sparas källnycklarna som gravstenar. Skickas samma historiska händelser om
avvisas de (`skipped` med skälet att källan är raderad enligt GDPR) i stället för
att återskapa personen och mailsammanfattningarna. Nya händelser — nya
`source_ref` — släpps igenom som vanligt: det är ny behandling med ny grund.

För kontaktpunkter från `gmail` och `calendar` gäller gravstenen per domän.
Raderingen sparar källnyckeln och `<grund>#<domän>`, där domänen är nyckelns
suffix eller annars domänen i personens e-post. Samma mail avvisas därför i
båda formerna, `<grund>` och `<grund>#<domän>`, med ett villkor för formen
`<grund>`: den avvisas när `<grund>` själv är gravsten eller när personens
e-post har den raderade domänen. Utan person, eller med en person på en annan
domän, släpps den igenom om raderingen bara sparade `<grund>#<domän>`. Samma
mail för en annan organisation släpps igenom i formen `<grund>#<domän>` med
organisationens egen domän. I formen `<grund>` avvisas det däremot när den
raderade kontaktpunkten hade nyckeln `<grund>`, eftersom den nyckeln då är en
exakt gravsten (kontaktpunkten behåller sin första källnyckel, regel 2). En
gravsten på en grundnyckel utan något sparat domänsuffix, till exempel en från
före regeln eller en kontaktpunkt utan person och utan suffix, avvisar mailet
för alla domäner. Ett enda sparat domänsuffix stänger av den regeln, också när
det sparades av en annan kunds radering, och då släpps mailet igenom för varje
domän som inte är sparad. Gravstenen bär ingen kund, bara källnyckeln. Löften
prövas mot exakt nyckel.

**5. Tidrapportering är inte en giltig källa.** `source_system` accepterar
`gmail`, `calendar`, `linear` och `manual`. Databasen avvisar allt annat.
Skälet är mätt, inte principiellt: två av tre aktiva projekt har noll loggade
minuter men betalda fakturor, så en "senaste kontakt" byggd på tidrapporter
hade visat den största kunden som kontaktlös.

**6. En projektkod är inget organisationsnamn.** Ett organisationsnamn som
efter trimning matchar `^[A-ZÅÄÖ]{2,6}-\d{3}$` (som *NVR-001*) avvisas.
Händelsen hamnar i `skipped` med sitt index och skälet att namnet är en
projektkod; ingenting skrivs för den och övriga händelser skrivs som vanligt.
`upsert_crm_organization` svarar 400 `project_code_as_name` för både människa
och agent. Regeln gäller före namngravstenen. Befintliga organisationer med
ett sådant namn rörs inte.

**7. Kundkortets org.nr gäller för en kopplad relation.**
För en organisation med `customer_id` satt gäller kundkortets org.nr, enligt
Davids svar 2026-10-13 (FR-11). Ett `org_number` i en sådan händelse skrivs
inte; händelsen skrivs i övrigt som vanligt och hamnar inte i `skipped`.
Fältet redovisas i `kept_customer_fields` som `"<organisation>: org_number"`,
inte i `kept_human_fields`, eftersom ingen människa blockerade det.
För en okopplad organisation skrivs värdet som förut och används för kunduppslaget.
`upsert_crm_organization` med `org_number` för en kopplad organisation svarar
400 `org_number_on_customer` med `details.customer_id` och
`details.update_action` = `update_customer`. Rätta då org.nr med `update_customer`.

**8. En bolagsformsvariant blir ett sammanslagningsförslag, inte en ny relation.**

Ett organisationsnamn utan exakt träff och utan alias, som bara skiljer sig i
bolagsform från exakt en befintlig relation, skapar ingen relation om paret
inte har sparats som olika bolag. Händelsen hamnar i `skipped` med skälet
«bolagsformsvariant av Alliance Optikk — väntar på ditt beslut i Att göra».
Förslaget `merge_crm_name_variant` köas i Att göra en gång per namnpar och
redovisas i `merge_proposals`, även när det redan väntar på beslut eller
verkställighet. Godkänt ger ett alias: nästa synk tar emot de överhoppade
händelserna på relationen och redovisar `redirected_organizations`. Avvisat
med skäl låter nästa synk skapa en egen relation utan nytt förslag mot samma
relation. Flera möjliga relationer ger inget förslag och ingen relation:
`skipped` säger «bolagsformsvariant av flera relationer — slå ihop dem först».

Väntande förslag jämförs utan hänsyn till skiftläge i UUID och namn eller
omgivande blanktecken i namnet, även för äldre direktköade förslag.
Efter låsväntan läser synken alias och sparade besked på nytt innan den avgör
om ett förslag behövs.

**9. Ett löfte följer ärendets livscykel.**

En löfteshändelse får bära `status` (`open`, `done` eller `dropped`) och
`due_date` som datum eller `null`. Utelämnat `status` lämnar statusen
oförändrad, utelämnat `due_date` lämnar förfallodatumet oförändrat, och
`due_date: null` tar bort det. Ett annat statusvärde avvisar hela anropet med
400 `validation_error` innan något skrivs.

En ändrad status sätter `completed_at` (tomt vid `open`). En omsändning med
samma status ändrar det inte och räknas som `commitments_unchanged`. En
stängningshändelse för en okänd källnyckel skapar löftet stängt.

En status eller ett förfallodatum som en människa satt eller bekräftat skrivs
inte över och redovisas i `kept_human_fields`. En status `done` eller
`dropped` utan ursprungsrad räknas som satt av en människa, eftersom intaget
inte skrev status före den här regeln. Övriga fält följer källan, och
ingenting fryser hela löftet.

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
    "kept_customer_fields": [],
    "redirected_organizations": [],
    "merge_proposals": [],
    "skipped": []
  }
}
```

`*_unchanged` betyder att händelsen redan fanns och uppdaterades i stället för
att dubbleras. Ett jobb som körs om ska ge idel `unchanged` — det är kvittot på
att synken är idempotent.

`kept_human_fields` listar de fält som **inte** skrevs, för att en människa
bestämt dem. Se nästa avsnitt.

`kept_customer_fields` listar de fält som **inte** skrevs, för att kundregistret
äger dem (`"<organisation>: org_number"`); se regel 7.

`redirected_organizations` listar namn som styrts om till en organisation de
slagits ihop med (`"Hermes → Hermes Bevakning AB"`). Se *Ett hopslaget namn
återuppstår inte*.

`merge_proposals` listar namn som väntar på beslut enligt regel 8, i formen
"Alliance Optikk AS → Alliance Optikk (bolagsform)" eller
"<namn> (flera möjliga)". Samma post redovisas en gång per batch, också när
förslaget redan väntar; själva händelserna står var för sig i `skipped`.

## Människan vinner

Varje fält bär sitt ursprung: `human`, `sync`, `ai`, `accounting` eller
`import`. En skrivning från synken skriver **aldrig** över ett fält en människa
satt eller bekräftat. Det är inte artighet — utan regeln är det meningslöst att
rätta något, eftersom nästa körning sätter tillbaka gissningen i tysthet.

Filtreringen redovisas i `kept_human_fields` (`"Nordic Vision Retail AB:
org_number"`). En synk som tyst kastar bort en del av sin egen skrivning ser ut
som en synk som lyckades helt.

Även kontaktpunktens `occurred_at`, `channel`, `direction` och `summary`,
och löftets `direction`, `body`, `due_date`, `status` och `occurred_at` bär
ursprung per fält. Synken skriver inte över ett fält som en människa satt.
Intaget skriver de fält som händelsen bär, också löftets `status` (regel 9),
och `set_crm_commitment_status` är människans och agentens väg. Äldre värden
utan ursprungsrad är oskyddade tills de skrivs på nytt, utom ett löftes
`status` `done` eller `dropped` (regel 9); ingen bakåtfyllnad görs.

Blockerade händelsefält redovisas i `kept_human_fields` med formen
`"<organisation>: <källnyckel> <fält>"`.
Exempel: `"Löftesbolaget AB: linear:LOC-1 body"`.
En händelse utan organisation får personens namn som prefix.

| Åtgärd | Gör |
| :---- | :---- |
| `get_crm_organization` | Returnerar `provenance` — ursprunget per fält, för organisationen och för varje person |
| `confirm_crm_value` | Bekräftar ett fält utan att ändra värdet: gissningen blir ett beslut och skyddas |

`upsert_crm_organization` tar `organization_id` när raden redan är känd. Utan den
matchas namnet, och då går namnet inte att rätta — en ändring hade lagt upp en ny
organisation bredvid den gamla. Krockar det nya namnet med en befintlig rad
avvisas skrivningen med `name_taken`; två rader för samma bolag ska slås ihop
(`merge_crm_organizations`), inte döpas om till varandra. Med `organization_id`
får `name` utelämnas och betyder då oförändrat. Ett `customer_id` som redan
hör till en annan organisation avvisas med 409 `customer_already_linked`
i stället för ett indexfel. Även automatisk kundmatchning tar samma kundlås
och prövar kopplingen på nytt efter eventuell väntan. Förlorar intaget denna
krock rullas händelsens savepoint tillbaka och texten redovisas i `skipped`;
vid omsändning ser uppslaget den upptagna kunden och relationen redovisas i
`unlinked_organizations`.
Namnkrockens `name_taken` är fortfarande 400 och bär `details: { organization_id, merge_action: 'merge_crm_organizations' }`, där `organization_id` är relationen som redan bär namnet och `merge_action` åtgärden som slår ihop dem (crm 2.1).
En människas rättelse med `organization_id` gör inget automatiskt kunduppslag:
utelämnat `customer_id` lämnar kopplingen, dess ursprung och en utelämnad status
orörda även vid matchande namn eller org.nr. Synkens uppslag är oförändrat.

En automatisk kundkoppling ändrar inte en status som en människa satt eller
bekräftat. `prospect` står kvar och redovisas i `kept_human_fields` som
`"<organisation>: status"`.
Utan människosatt status blir `prospect` i stället `customer` med kopplingens
ursprung (`accounting` med uppslagets skäl vid kunduppslag).

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

Statusen är undantaget som sammanslagningen kan ändra: flyttas kundkopplingen
från den inslagna relationen blir en `prospect` som inte är människosatt
`customer`, som förut. En människosatt eller bekräftad status står kvar och
svaret redovisar det med `kept_human_fields: ["status"]` (annars `[]`).
Statusens ursprung ändras inte av sammanslagningen.

Två fall avvisas i stället för att gissas: organisationer som pekar på **olika**
kunder i redovisningen (`customer_conflict`) och personer med **olika**
e-postadresser (`email_conflict`). Det är då inte dubbletter.

Varje organisation bär `name_norm`, genererad av `crm.normalize_org_name`,
så att *Alliance Optikk AS* och *Alliance Optikk* har samma jämförelsenyckel.
Nyckeln använder gemener, trimmade och hopslagna blanktecken och tar bort en
avslutande bolagsform ur den slutna listan. Uppslaget på namn är fortfarande
skiftlägesokänsligt på hela namnet; bolagsformsvarianter slås inte ihop här.

### Ett hopslaget namn återuppstår inte

Avsändaren vet ingenting om att två rader slagits ihop här inne — mailindexet
fortsätter skicka det gamla namnet. Och eftersom organisationen slås upp på
**namn** innan `source_ref` ens konsulteras skapade nästa nattkörning raden igen:
ett **tomt skal** (åtagandena ligger kvar på rätt rad) som ändå syntes i
tystnadslistan och på dagsytan. Sammanslagningen var alltså giltig till nästa
natt, varje natt.

Sammanslagningen lämnar därför en **gravsten över namnet**
(`crm.organization_name_aliases`, migration 0059). Tre spärrar mot att den kapar
en framtida äkta organisation med samma namn:

1. Den riktiga organisationen slås upp **först** — finns namnet på riktigt rörs
   ingenting.
2. Bara skrivningar med ursprung `sync` styrs om. En människas uttryckliga
   `upsert_crm_organization` träffar alltid raden hon pekat ut.
3. Varje omstyrning **redovisas** i `redirected_organizations`
   (`"Hermes → Hermes Bevakning AB"`).

| Åtgärd | Gör |
| :---- | :---- |
| `remove_crm_name_alias` | Tar bort ett tidigare namn, så att det får en egen relation vid nästa körning |

Till skillnad från GDPR-gravstenarna (regel 4 ovan) **får** aliaset tas bort: en
sammanslagning är ett omdöme, inte en rättslig radering, och ett omdöme ska gå
att ändra den dag namnet blir ett riktigt bolag. Namnen syns på relationssidan
under **Tidigare namn**, med knapp — en spärr man inte kan läsa går inte att
ångra.

Kadensen finns för att en gemensam tystnadsgräns passar ingen: en kund på
månadsretainer och en kund vartannat år kan inte dela gräns. Klockan nollställs
av **kontakt**, aldrig av inställningen.

## Tidsförslag

`POST /api/companies/<company_id>/actions/propose_time_entries`

Samma riktning, samma auth och samma form som `ingest_crm_events`: avsändaren
(kalender- och mailspåret hos Hermes) skickar en batch, det här repot tar emot.
Skillnaden mot kontaktpunkterna är vad en dubblett kostar — en dubblerad
kontaktpunkt är brus, en dubblerad **tidpost är pengar på nästa faktura**.

```jsonc
{
  "events": [
    {
      "project_hint": "Nordic Vision Retail AB",   // kundnamn ELLER domän ("nvr.example")
      "part_hint": "2A",                            // avtalsdelens kod eller namn
      "work_date": "2026-09-02",
      "minutes": 90,
      "description": "Genomgång av testfall inför fas 2A.",
      "source": "kalender",
      "source_ref": "calendar:6f21ab90",
      "uncertainty": "lag",
      "reasoning": "Kalenderhändelse 90 min med kundens projektledare, rubriken nämner fas 2A."
    },
    {
      "project_id": "…uuid…",
      "work_date": "2026-09-02",
      "minutes": 0,                                 // mailspår: ATT något hände, inte hur länge
      "description": "Svar om leveransdatum.",
      "source": "mail",
      "source_ref": "gmail:18f2c9a1b7",
      "uncertainty": "hog",
      "reasoning": "Utgående mail i kundens tråd; ingen varaktighet går att härleda."
    }
  ]
}
```

Max 500 händelser per anrop. Allt som kommer in får status **`forslag`** och
kan aldrig hamna på en faktura utan att en människa godkänt det i vyn.

### Reglerna

**1. `source_ref` är idempotensnyckeln.** `(company_id, source_ref)` är unikt i
databasen. Ett källid som redan finns hoppas över och räknas i `duplicates` —
det **uppdateras aldrig**. Ett förslag är ett påstående vid en tidpunkt, inte
ett fält synken äger; ändrar sig kalendern är det en ny händelse med ett nytt
id. Samma batch två gånger ska ge idel `duplicates` och noll nya rader.

**2. `minutes` får vara 0.** Ett mailspår säger att något hände, inte hur
länge. Nollan kan aldrig godkännas — mottagaren måste sätta en tid eller
markera posten som "faktureras ej". Skicka aldrig en gissad varaktighet för att
slippa nollan: en påhittad kvart blir en påhittad faktura.

**3. En ledtråd som inte träffar tappar aldrig posten.** `project_hint` utan
entydig träff landar på bolagets uppdrag `Osorterat` och redovisas i
`unresolved`. Där kan posten inte bli fakturerbar tid förrän en människa flyttat
den (409 `unsorted_project`) — posten finns, men den kan inte bli pengar förrän
någon sagt vems arbetet var. `part_hint` utan träff lämnar avtalsdelen tom.

**4. En trasig händelse stoppar inte batchen.** Savepoint per händelse; det som
inte gick igenom returneras i `skipped` med index och skäl.

**5. `reasoning` är EN mening om varför — aldrig innehållet.** Max 500 tecken.
**Aldrig ordagrann mailtext, aldrig ett citat, aldrig tredje parts namn utöver
kundens organisation.** Skriv varför posten föreslogs och lämna `source_ref` som
pekare till underlaget; den som vill läsa mailet läser mailet där det bor. Det
här är samma regel som gäller `crm.audit_log.details` och av samma skäl:
motiveringen gallras (se *Gallring*), och det som lagts in som fritext överlever
annars sin egen gallring.

### Svaret

```jsonc
{
  "status": "ok",
  "action": "propose_time_entries",
  "result": {
    "received": 2,
    "created": 2,
    "duplicates": 0,
    "unresolved": [],
    "unsorted": 0,
    "overlaps_manual": 1,
    "skipped": []
  }
}
```

`unresolved` listar ledtrådarna som inte gick att slå upp (`"kund: Acme AB"`,
`"avtalsdel: Fas 2A"`) — av samma skäl som `unlinked_organizations`: raden
skrevs, inget fel returnerades, men den ligger i `Osorterat`. Ett tomt fält är
kvittot. `overlaps_manual` räknar de förslag där det redan fanns manuellt
registrerad tid samma dag på samma uppdrag; kön frågar då "redan registrerad?"
i stället för att lägga en tyst andra rad.

### Komplettering av ett obeslutat tidsförslag

Hermes komplettering använder `update_time_entry` (Story 10.2) med det
valfria `expected` (Story 10.5): postens listade
`{minutes, billable_minutes, adjustment_reason, status}`. Alla fyra nycklar
krävs och inga andra får finnas (400 `validation_error`). Minuterna är heltal
0–1440, skälet högst 300 tecken eller `null`, och statusen en giltig tidstatus.
`null` jämförs som ett eget värde.

Tjänsten låser raden med `SELECT … FOR UPDATE` och prövar först fakturerad
tid (409 `time_entry_locked`), sedan de fyra värdena (409
`time_entry_changed` vid skillnad), sedan statusbytet och övriga regler.
Vid `time_entry_changed` skrivs varken posten eller någon auditrad. REST och
MCP får `{ "error": "time_entry_changed" }`; det svenska meddelandet stannar
på servern. Utan `expected` är beteendet oförändrat. `work_date`, `duration`,
`description` och `contract_part_id` jämförs inte. Vyn skickar inte fältet.
Batchens `propose_time_entries` ändras inte: en dubblett där skriver ingenting.

## Affärerna

De öppna affärerna bor i ärendeplattformen, som ärenden med affärsetiketten.
Hermes skickar en ögonblicksbild av dem hit varje natt med `sync_crm_deals`, och
relationsdelen läser den ur en cache. Riktningen är densamma som för
händelserna: redovisningssystemet ringer aldrig ärendeplattformen. Affärsobjektet
`crm.deals` används inte — cachen är en spegel av ärendena, inget eget
affärsobjekt, och den skrivs om i sin helhet varje gång.

`POST /api/companies/<company_id>/actions/sync_crm_deals`

```jsonc
{
  "observed_at": "2026-11-22T02:00:00Z",
  "deals": [
    {
      "source_ref": "linear:LOC-412",
      "title": "Pilot för lagerprognosen",
      "organization": { "name": "Nordic Vision Retail AB" },
      "stage": "proposal",
      "value_ore": 12500000,
      "next_step": "Skicka offerten",
      "last_activity_at": "2026-11-18T14:05:00Z"
    }
  ]
}
```

`observed_at` är ögonblicksbildens tidpunkt och `last_activity_at` ärendets
senaste aktivitet, båda ISO 8601 med zon. `source_ref` är ärendets källnyckel i
husets form `<system>:<id>`, som `linear:LOC-412`: samma nyckel som ärendet bär
i händelserna. Mottagaren jämför hela nyckeln, så en nyckel utan systemet är en
annan nyckel, och då spärrar en gravsten för ärendet inte affären. Nyckeln är
unik per bolag och trimmas, så en nyckel med blanktecken runt är samma nyckel.
`stage` är `idea`, `dialogue`, `proposal` eller `negotiation` och får utelämnas
eller vara `null`, liksom `value_ore` (heltal i ören) och `next_step`. Högst 500
affärer per anrop. En okänd nyckel på någon nivå ger 400 `validation_error`, och
då skrivs ingenting.

Ingen tidpunkt får ligga mer än fem minuter före mottagarens klocka. Ett
`observed_at` längre fram ger 400 `observed_at_in_future` och skriver
ingenting: sparad hade ögonblicksbilden räknats som aktuell långt efter att
nattjobbet slutat gå. En affär vars `last_activity_at` ligger längre fram hoppas
över, eftersom den hade dolt sitt stillestånd.

**Hela mängden ersätter cachen.** En affär som inte finns med i nästa
ögonblicksbild försvinner — det är så en vunnen, förlorad eller stängd affär
lämnar listan. Skicka därför alltid alla öppna affärer, aldrig bara de som
ändrats. En tom mängd betyder «inga öppna affärer» och tömmer cachen;
tidpunkten sparas ändå.

Organisationen slås upp eller skapas ur sitt namn med samma regler som i
*De fyra reglerna*: kopplingen till kundregistret, projektkodsspärren, aliaset
efter en sammanslagning och bolagsformsvarianten. En variant hoppas över med
samma skäl och köar samma förslag som en händelse, ett per namnpar. En titel
eller en `source_ref` av bara blanktecken och en upprepad `source_ref` i samma
ögonblicksbild hoppas också över. En trasig rad stoppar inte resten.

Regel 4 gäller också affärerna. När en kund raderats enligt GDPR försvinner
kundens affärer ur cachen och deras källnycklar sparas som gravstenar. Skickas
samma `source_ref` igen hoppas affären över (`skipped` med skälet att källan är
raderad enligt GDPR), och ingen relation skapas för den. Gravstenen är paret
källsystem och nyckel, samma som för händelserna, så ett löfte eller en
kontaktpunkt ur samma ärende som raderats med kunden spärrar också affären. En
ny `source_ref` släpps igenom som vanligt: det är ny behandling med ny grund.

```jsonc
{
  "status": "ok",
  "action": "sync_crm_deals",
  "result": {
    "observed_at": "2026-11-22T02:00:00Z",
    "received": 1,
    "cached": 1,
    "organizations_created": 0,
    "organizations_linked": 1,
    "unlinked_organizations": [],
    "redirected_organizations": [],
    "merge_proposals": [],
    "skipped": []
  }
}
```

`received` är antalet Hermes skickade och `cached` antalet som ligger i cachen
efteråt. `skipped` bär index och skäl för varje överhoppad affär,
`merge_proposals` de bolagsformsvarianter som väntar på beslut, och
`unlinked_organizations` de organisationer som inte gick att knyta till
kundregistret — samma fält och samma former som i händelsernas svar.

Läsningen är `crm_open_deals` (`{}`). Svaret bär `status` med ett av tre
utfall, `observed_at` och `received` från den senaste ögonblicksbilden, och
`deals`. Har ingen ögonblicksbild kommit är `observed_at` och `received` `null`;
annars bär de ögonblicksbildens tidpunkt och antal, också när utfallet är
`unknown`.

- `ok` — den senaste ögonblicksbilden är högst 26 timmar gammal och Hermes
  skickade minst en affär. `deals` listar affärerna med relationen, `stage`,
  `value_ore`, `next_step` (`null` när affären saknar dem), `last_activity_at`
  och stilleståndet i hela dygn, längst stillestånd först.
- `empty` — den senaste ögonblicksbilden är högst 26 timmar gammal och var tom.
- `unknown` — ingen ögonblicksbild har kommit, eller den senaste är äldre än 26
  timmar (en missad nattkörning och marginalen) eller ligger mer än fem minuter
  fram i tiden. `deals` är då alltid tom: en gammal lista visas aldrig som
  aktuell, och okänt visas aldrig som tomt.

En ögonblicksbild där varje affär hoppades över är `ok` utan affärer, aldrig
`empty`: tomt betyder att Hermes skickade en tom mängd.

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

Samma körning nollställer **`reasoning` på ignorerade tidsförslag äldre än 90
dagar** (`time_entry_reasoning_cleared` i svaret). Perioden är fast och styrs
inte av `older_than_months`: relationsdatans period är ett verksamhetsbeslut, en
AI-motivering är ett arbetsmaterial. Motiveringen nollställs dessutom i samma
transaktion som posten blir **fakturerad** — då är bedömningen gjord och
underlaget är fakturan. `source_ref` behålls som spår i båda fallen.

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

## Leveranskontraktets import (uppdragsytan)

`POST /api/companies/<company_id>/actions/importera_leveranskontrakt` tar
strikt `{ contract_id, kontraktstext }` (UUID och högst 200 000 tecken).
Texten skickas av källsystemet; redovisningen läser aldrig filer eller Drive.
Svaret är HTTP 200 med `status: 'ok'` och `result` som innehåller
`contract_id`, textens `kontrakt_tillstand` (`fryst`, `utkast` eller `null`)
och `forslag`: `uppdrag` med ram och ytterdatum, `strommar` med intervall,
`leverabler` med `strom_kod` och `saknade_falt`. Saknade eller otolkbara
fält är `null`; belopp är heltal i ören.

Endast text med exakt `kontrakt_tillstand: fryst` och ett avtal med
`signed_date` köar ett förslag för `satt_baseline`; svaret innehåller då
också `approval_id`. Importanropet skriver ingen baseline. Fryst text utan
signeringsdatum ger HTTP 400 `valid_from_required`. Utkast och okänt
tillstånd ger bara förhandsvisningen, även utan signeringsdatum, och skriver
inga domänrader, godkännandeposter eller köposter för registerkopian.

`satt_baseline` är känslig och har samma strikta indata. Den exekveras genom
det befintliga mänskliga godkännandet
`POST /api/companies/<company_id>/approvals/<approval_id>/approve`.
Godkännandet skriver UPPDRAG med ytterdatum, strömmarna med sina intervall
och leverablerna under sina strömmar med egna datum `null`; intervallet ärvs.
Text som inte är fryst avvisas med HTTP 400 `kontrakt_not_frozen` vid
godkännandet. Att göra visar datumen och placeringarna samt länken till
avtalets `/app/c/<company_id>/projects/<project_id>/kontraktet`.
