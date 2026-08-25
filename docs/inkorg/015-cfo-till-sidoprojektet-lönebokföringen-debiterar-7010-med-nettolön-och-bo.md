# Lönebokföringen debiterar 7010 med nettolön och bokför aldrig arbetsgivaravgift

Överlämning från Hermes-sidan, roll: cfo.

## Vad som hittades

Råbalansen för RÅ 2026 (byggd ur samtliga 131 verifikat, per 2026-08-25) har 7010 = 259 674,00, vilket är exakt summan av de sex utbetalda nettolönerna, och saknar 7510/7519 helt. Skattekontobetalningarna landar i stället som debet på 2510, som nu bär 185 840,00 — 0,20 kr från den härledda skulden för perioderna 2026-03–2026-08. Felet återskapas av `book_payslip`/`book_payroll_tax` varje månad, och `liquidity_forecast` läser samma data och rapporterar 124 032,20 kr som "FÖRFALLET" trots att varje period har ett bokfört betalningsverifikat (I20, I36, I72, A17, A35, A47).

## Rekommendation

Rekommendation: låt `book_payslip` debitera 7010 med bruttolön, kreditera 2710 med personalskatten och boka 7510/2730 för avgiften; låt `book_payroll_tax` debitera 2710/2730 i stället för 2510. Bakåt: ett korrigeringsverifikat per period hellre än ett samlat, så avstämningen mot AGI-kvittenserna går att följa.

## Så här är processen tänkt

Den mottagande rollen tar ansvaret, men frågar först David om den ska göra en för- och nackdelsanalys av lösningen som den är föreslagen här, och ta fram ett alternativ tillsammans med cfo.
