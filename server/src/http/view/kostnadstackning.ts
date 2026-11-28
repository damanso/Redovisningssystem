// Story 6.1, FR-20/FR-41, UX K10: kostnadstäckningen i styrvyn, märkt för vad
// den är — en schablon. Tre källor summeras till Schablon, tre månaders kostnad
// dras av, och sista raden säger med tecknet som text vad som blir över eller
// saknas. Talet är periodlöst och får aldrig läsas som täckning de närmaste tre
// månaderna; det ersätter den gamla täckningstabellen. Gapet räknas i tjänsten
// och läses här, så att vyn aldrig kan räkna ett gap mot noll. Två kolumner med
// förklaringen under radnamnet, så att tabellen ryms på telefonbredd utan att
// staplas eller rulla i sidled. Ren: ingen databas, ingen klocka, ingen egen
// CSS-klass och inget skript.
import type { SteeringOverview } from '../../services/steering.js';
import { amount, html, type Raw } from './html.js';

/** Okänt i ord, i husets nollfärg — aldrig 0 kr och aldrig bara ett streck. */
const OKANT = html`<span class="amount amount--nil">Okänt</span>`;

/** En rad: radnamnet med förklaringen under, och beloppet högerställt. */
const rad = (namn: Raw | string, forklaring: Raw | string, belopp: Raw): Raw =>
  html`<tr><td>${namn}<br><span class="muted">${forklaring}</span></td><td class="num">${belopp}</td></tr>`;

/**
 * Kostnadstäckningen som schablon ur styrvyns svar. Raderna går jämnt: de tre
 * källorna summerar till Schablon, och Schablon plus Kostnad tre månader är
 * gapet. Vyn räknar bara de två visningsbeloppen gånger tre; gapet, schablonen
 * och månaderna läses ur svaret. Utan bokförd kostnad är gapet okänt och står
 * som Okänt, med egen förklaring.
 */
export function kostnadstackning(s: Pick<SteeringOverview, 'as_of' | 'cost' | 'coverage'>): Raw {
  const c = s.coverage;
  const gap = c.gap_ore;
  const slutrad = gap === null
    ? rad(html`<strong>Täckningsgap</strong>`, 'Inga bokförda kostnader att jämföra med ännu — gapet räknas inte mot noll',
      html`<strong>${OKANT}</strong>`)
    : rad(html`<strong>${gap < 0 ? 'Saknas' : 'Överskott'}</strong>`, 'Positivt är överskott, negativt är vad som saknas',
      html`<strong>${amount(gap, { signed: true, unit: false })}</strong>`);
  const manader = c.months_covered === null
    ? 'Inga bokförda kostnader att jämföra med ännu.'
    : `Räcker till ca ${String(c.months_covered).replace('.', ',')} månaders kostnader.`;
  return html`<h2 style="margin-top:18px">Kostnadstäckning (schablon)</h2>
    <div class="table-wrap"><table style="min-width:0"><thead><tr><th scope="col">Post</th><th scope="col" class="num">Belopp</th></tr></thead><tbody>
      ${rad('Obetalda bokförda fakturor', 'Fakturerat men ej betalt — utan hänsyn till förfallodatum', amount(c.receivables_ore, { unit: false }))}
      ${rad('Ofakturerad fakturerbar tid', 'Utfört arbete till i dag', amount(c.unbilled_time_ore, { unit: false }))}
      ${rad('Abonnemang × 3',
        html`${amount(c.recurring_month_ore)} per månad × 3 — tre månader av varje aktivt abonnemang, även de som slutar tidigare`,
        amount(c.recurring_month_ore * 3, { unit: false }))}
      ${rad(html`<strong>Schablon</strong>`, 'Inte belagd täckning under en period — se Likviditet nedan',
        html`<strong>${amount(c.known_next_3_months_ore, { unit: false })}</strong>`)}
      ${rad('Kostnad tre månader', 'Bokförd kostnad 12 mån ÷ 12 × 3', gap === null ? OKANT : amount(-(s.cost.avg_month_ore * 3), { unit: false }))}
      ${slutrad}
    </tbody></table></div>
    <p class="harledning">Räknat ur bokförda verifikat, obetalda fakturor, aktiva abonnemang och ofakturerad tid per ${s.as_of}. ${manader}</p>
    <p class="muted" style="font-size:12.5px;margin-top:10px">Öppna affärer räknas inte in i täckningen.</p>`;
}
