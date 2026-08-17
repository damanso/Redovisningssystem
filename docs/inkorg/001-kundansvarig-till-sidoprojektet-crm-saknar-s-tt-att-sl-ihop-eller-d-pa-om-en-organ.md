# CRM saknar sätt att slå ihop eller döpa om en organisation

Överlämning från Hermes-sidan, roll: kundansvarig.

## Vad som hittades

Vid första skarpa CRM-ingesten 13/8 kl 19:05 skapades tre organisationer med projektnamn i stället för företagsnamn: Hermes, ILT-Education och NVR-001. De bär sex åtaganden härledda ur Linears Väntar-extern-ärenden. Avsändarfelet är rättat samma kväll, men de tre raderna går inte att rätta härifrån: ingesten är idempotent på source_ref så en omkörning ger unchanged; upsertOrganization matchar på namn och kan inte byta namn; och purgeCrmData är GDPR-radering av allt för en part, inte en sammanslagning. Kontraktets regel 0 fångade felet direkt och returnerade dem i unlinked_organizations — den delen fungerade som avsett. Fullt underlag i 02-Områden/ledningsgrupp/overlamning-crm-merge-2026-08-13.md.

## Rekommendation

Lägg till merge_crm_organizations(from_id, into_id) som flyttar kontaktpunkter, åtaganden och personer till målorganisationen, skriver en audit-rad och lämnar en gravsten så att en gammal source_ref inte återuppstår som ny organisation — samma resonemang som GDPR-gravstenarna redan bygger på. Sammanslagning framför radering: dubbletten är inte fel data, den är rätt data på fel rad, och en radering skulle kasta sex verkliga åtaganden. Alternativet att låta ingesten peka om en händelse när source_ref finns men organisationen skiljer sig löser det vid källan men bryter idempotensen som är hela skälet att jobbet vågar köras om.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med kundansvarig.
