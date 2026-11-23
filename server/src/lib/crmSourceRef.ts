// Story 3.13 (FR-4, FR-43): källnyckelns grund och gravstenens nycklar.
//
// Avsändaren (Hermes intag, story 3.10) ger ett mail eller möte nyckeln
// `<grund>` när det har en organisation och `<grund>#<domän>` per organisation
// när det har flera. Hermes klassar om hela fönstret varje natt, så formen
// skiftar när domänkartan ändrar antalet organisationer i ett äldre mail.
// Mottagaren är den enda platsen som ser både sina rader och gravstenarna,
// och därför bildas grunden och gravstenens nycklar här, utan databas.
// Mottagaren, raderingen och spärren anropar samma funktioner, så att
// skrivningen och prövningen inte kan glida isär (architecture.md K-5).

/**
 * Källsystemen där grundnyckeln gäller: mail och möten, de enda som avsändaren
 * delar per organisation. Löften, ärenden och anteckningar jämförs alltid på
 * hela nyckeln. Listan är sluten och står bara här.
 */
export const GRUNDNYCKEL_SYSTEM = ['gmail', 'calendar'] as const;

interface Kallnyckel {
  source_system: string;
  source_ref: string;
  email: string | null | undefined;
}

/**
 * Grundnyckeln för en kontaktpunkt: delen före första `#` i källnyckeln, för
 * `gmail` och `calendar`. En nyckel utan `#` är sin egen grund. Ger `null` för
 * andra källsystem, utan källnyckel och när delen före `#` är tom, så att
 * anroparen bara gör det andra uppslaget där regeln gäller. Delningen görs bara
 * här; SQL-sidans `split_part(source_ref, '#', 1)` ger samma del.
 */
export function sourceRefBase(sourceSystem: string, sourceRef: string | null | undefined): string | null {
  if (!sourceRef || !(GRUNDNYCKEL_SYSTEM as readonly string[]).includes(sourceSystem)) return null;
  const grund = sourceRef.split('#', 1)[0] ?? '';
  return grund === '' ? null : grund;
}

// Domänform: icke-tom, minst en punkt, ingen punkt först eller sist och varken
// blanktecken, @, # eller /. Svenska tecken släpps igenom. Kravet på punkt gör
// att löftets `#commit-1` och `#c1` aldrig läses som en domän.
function domanform(text: string): string | null {
  const doman = text.trim().toLowerCase();
  if (doman === '' || !doman.includes('.') || doman.startsWith('.') || doman.endsWith('.')) return null;
  return /[\s@#/]/.test(doman) ? null : doman;
}

/**
 * Domänen i en e-postadress: delen efter sista `@`, trimmad och med gemener.
 * Ger `null` utan `@` eller när delen inte har domänform. Lokaldelen lämnar
 * aldrig funktionen, så en gravsten bär aldrig personens namn.
 */
export function emailDomain(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.lastIndexOf('@');
  return at < 0 ? null : domanform(email.slice(at + 1));
}

/**
 * Domänsuffixet i en källnyckel: delen efter första `#`, trimmad och med
 * gemener, när den har domänform. Avsändaren skriver domänen med gemener; här
 * jämförs den likadant oavsett hur den kom.
 */
export function suffixDomain(sourceRef: string): string | null {
  const i = sourceRef.indexOf('#');
  return i < 0 ? null : domanform(sourceRef.slice(i + 1));
}

// Skrivningen och prövningen bygger på den här funktionen och ingen annan.
function domannycklar(k: Kallnyckel): string[] {
  const nycklar = [k.source_ref];
  const grund = sourceRefBase(k.source_system, k.source_ref);
  const doman = grund ? suffixDomain(k.source_ref) ?? emailDomain(k.email) : null;
  if (grund && doman) {
    const syskon = `${grund}#${doman}`;
    if (syskon !== k.source_ref) nycklar.push(syskon);
  }
  return nycklar;
}

/**
 * Nycklarna som GDPR-raderingen skriver som gravstenar för en kontaktpunkt:
 * källnyckeln först och, för `gmail` och `calendar`, domänsyskonet
 * `<grund>#<domän>`. Domänen är nyckelns suffix, annars domänen i personens
 * e-post. Utan syskonet hade samma mail i den andra formen återskapat kunden.
 */
export function erasureKeys(k: Kallnyckel): string[] {
  return domannycklar(k);
}

/**
 * Nycklarna som spärren prövar för en inkommande kontaktpunkt. Samma regel som
 * `erasureKeys`, med eget namn så att raderingen och spärren läses var för sig.
 */
export function erasureCheckKeys(k: Kallnyckel): string[] {
  return domannycklar(k);
}

/**
 * Avgör om gravstenarna spärrar händelsen. `tombstones` är gravstenarna i samma
 * bolag och källsystem som spärren läst. Sant när en av `checkKeys` är en
 * gravsten, eller när grunden själv är en gravsten utan något domänsyskon
 * `<base>#<domän>`: en gravsten från före domänsyskonen vet inte vilken kund
 * den gällde, och då spärras mailet för alla domäner, den säkra sidan.
 */
export function erasureBlocks(p: { checkKeys: readonly string[]; base: string | null; tombstones: readonly string[] }): boolean {
  const gravstenar = new Set(p.tombstones);
  if (p.checkKeys.some((nyckel) => gravstenar.has(nyckel))) return true;
  if (!p.base || !gravstenar.has(p.base)) return false;
  const prefix = `${p.base}#`;
  return !p.tombstones.some((t) => t.startsWith(prefix) && suffixDomain(t) !== null);
}
