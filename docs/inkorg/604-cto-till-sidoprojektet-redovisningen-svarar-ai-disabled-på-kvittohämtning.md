# Redovisningen svarar ai_disabled på kvittohämtningen sedan 2026-11-01 17:23

Överlämning från Hermes-sidan, roll: cto.

## Vad som hittades

gmail_kvitton.log:114–176: sista GRÖN 2026-11-01 16:23, därefter KUNDE_INTE «AI-OCR är avstängt i redovisningen (ai_disabled)» varje timme till 2026-11-04 06:23. 0 kvitton hämtade under perioden, och provet gmail_kvitton_farskhet är RÖTT (#599). Token accepteras: svaret är ai_disabled, inte 401 (gmail_kvitton.py:720–723).

## Rekommendation

Ta reda på när och hur AI-OCR stängdes av i redovisningen. Var det avsiktligt ska hämtaren redovisa det som paus (gul) i stället för RÖTT. Var det inte avsiktligt slås det på igen, och nästa körning kl. :23 ska då visa GRÖN.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med cto.
