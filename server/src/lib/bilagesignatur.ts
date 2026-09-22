// Signerade engångslänkar för kvittobilagor.
//
// Varför en egen HMAC och inte ett JWT: länken är INGEN session. Den ger rätt
// att skriva (eller läsa) exakt ett objekt, under några minuter, och ingenting
// annat. Ett JWT som råkar hamna i en Authorization-header hade varit ett
// inloggningsbevis; en HMAC över (operation, fil, bolag, användare, utgång) kan
// aldrig bli det. Nyckeln härleds ur JWT_SECRET med en egen domänsträng, så att
// en bilagelänk och ett sessionstoken aldrig kan bytas mot varandra.
//
// Bolags- och användar-id ligger i länken (och under signaturen) därför att
// PUT-vägen saknar JWT: utan dem finns ingen tenant-kontext att sätta, och
// RLS — som är husets hårda spärr — hade inte kunnat prövas alls.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { BadRequestError, ForbiddenError } from './errors.js';

export type Bilageoperation = 'put' | 'get';

export interface Bilagelank {
  url: string;
  expires_at: string;
}

export interface SignaturInnehall {
  companyId: string;
  userId: string;
}

function nyckel(): Buffer {
  return createHmac('sha256', config.JWT_SECRET).update('kvittobilaga-lank-v1').digest();
}

function signatur(op: Bilageoperation, fileId: string, innehall: SignaturInnehall, exp: number): string {
  return createHmac('sha256', nyckel())
    .update([op, fileId, innehall.companyId, innehall.userId, String(exp)].join('\n'))
    .digest('hex');
}

/**
 * Den publika basen. Saknas PUBLIC_API_URL ges ett TYDLIGT fel — aldrig en
 * localhost-URL: uppladdaren sitter någon annanstans än servern, och en länk
 * som tyst inte går att nå är värre än ett nej.
 *
 * Basen tas som argument (med config som förval) så att regeln går att pröva
 * utan att starta om processen — `config.ts` är fortfarande den enda som läser
 * process.env.
 */
export function publikApiBas(bas: string | undefined = config.PUBLIC_API_URL): string {
  if (!bas) {
    throw new BadRequestError(
      'public_api_url_saknas',
      'signerade bilagelänkar är inte konfigurerade (PUBLIC_API_URL saknas) — ' +
        'sätt den till den publikt nåbara bas-URL:en för API:t',
    );
  }
  return bas.replace(/\/+$/, '');
}

export function signeraBilagelank(params: {
  op: Bilageoperation;
  fileId: string;
  companyId: string;
  userId: string;
  ttlSekunder: number;
}): Bilagelank {
  const bas = publikApiBas();
  const exp = Date.now() + params.ttlSekunder * 1000;
  const sig = signatur(params.op, params.fileId, params, exp);
  const fraga = new URLSearchParams({ cid: params.companyId, uid: params.userId, exp: String(exp), sig });
  return {
    url: `${bas}/api/receipt-files/${params.fileId}/content?${fraga.toString()}`,
    expires_at: new Date(exp).toISOString(),
  };
}

const UUID_MONSTER = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Prövar signaturen och dess giltighetstid. Kastar 403 — aldrig 404 — så att
 * en felaktig signatur inte kan användas för att räkna ut vilka fil-id som
 * finns. Vad raden innehåller avgörs först efteråt, under RLS.
 */
export function verifieraBilagelank(params: {
  op: Bilageoperation;
  fileId: string;
  query: Record<string, unknown>;
  nu?: number;
}): SignaturInnehall {
  const { cid, uid, exp, sig } = params.query as Record<string, string | undefined>;
  if (
    typeof cid !== 'string' || !UUID_MONSTER.test(cid) ||
    typeof uid !== 'string' || !UUID_MONSTER.test(uid) ||
    typeof exp !== 'string' || !/^\d{1,15}$/.test(exp) ||
    typeof sig !== 'string' || !/^[0-9a-f]{64}$/.test(sig) ||
    !UUID_MONSTER.test(params.fileId)
  ) {
    throw new ForbiddenError('invalid_signature', 'länken är ofullständig eller felformad');
  }

  const vantad = Buffer.from(signatur(params.op, params.fileId, { companyId: cid, userId: uid }, Number(exp)), 'hex');
  const given = Buffer.from(sig, 'hex');
  if (vantad.length !== given.length || !timingSafeEqual(vantad, given)) {
    throw new ForbiddenError('invalid_signature', 'signaturen stämmer inte');
  }
  // Utgången prövas EFTER signaturen: annars kunde en osignerad gissning skilja
  // "fel signatur" från "utgången länk".
  if ((params.nu ?? Date.now()) > Number(exp)) {
    throw new ForbiddenError('signature_expired', 'länken har gått ut — begär en ny');
  }
  return { companyId: cid, userId: uid };
}
