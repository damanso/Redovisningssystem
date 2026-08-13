import type { NextFunction, Request, Response } from 'express';
import { fetchMembership, withUserTransaction } from '../../db/tx.js';
import { ForbiddenError, NotFoundError } from '../../lib/errors.js';
import { UuidSchema } from '../../lib/validation.js';
import { getUserId } from './authenticate.js';

/**
 * Förtroendegränsen på HTTP-nivå: verifierar att den inloggade användaren är
 * medlem i bolaget i URL:en INNAN någon handler körs. Saknas medlemskap → 404
 * (aldrig 200, och inte 403 som skulle läcka att bolaget finns).
 *
 * Detta är lager 1. Handlers använder withTenantTransaction som verifierar
 * medlemskapet igen i samma transaktion som datafrågorna (lager 1b), och
 * RLS-policyerna i Postgres är lager 2.
 */
export async function requireCompanyAccess(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  const userId = getUserId(req);
  const parsed = UuidSchema.safeParse(req.params.companyId);
  if (!parsed.success) throw new NotFoundError('company');
  // Normalisera till gemener så att fil-lagrets gemen-baserade sökvägsmönster
  // matchar det zod/Postgres (skiftlägesokänsligt) accepterar.
  const companyId = parsed.data.toLowerCase();

  // Ett agent-token är låst till sitt bolag: neka allt annat (404, läcker inte
  // existens) även om användaren bakom token är medlem i fler bolag.
  if (req.auth?.actor === 'agent' && req.auth.scopedCompanyId?.toLowerCase() !== companyId) {
    throw new NotFoundError('company');
  }

  const membership = await withUserTransaction(userId, (client) =>
    fetchMembership(client, userId, companyId),
  );

  if (!membership) throw new NotFoundError('company');

  // Underkonsulten (rollen 'contractor') har ingen bolagsåtkomst: RLS räknar
  // inte rollen som medlemskap (migration 0053), så varje tabell är stängd.
  // Utan spärren HÄR svarade REST-lagret ändå 200 med tom lista — vilket en
  // agent läser som "det finns inga kunder" — och skrivförsök blev obegripliga
  // 500-fel ur RLS i stället för ett tydligt nej. Ytan för rollen byggs i E7b
  // och får öppna det den behöver, uttryckligen.
  if (membership.role === 'contractor') {
    throw new ForbiddenError('contractor_not_permitted', 'underkonsulter har ännu ingen åtkomst till bolagets data');
  }

  req.companyId = companyId;
  req.companyRole = membership.role;
  next();
}
