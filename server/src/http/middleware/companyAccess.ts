import type { NextFunction, Request, Response } from 'express';
import { fetchMembership, withUserTransaction } from '../../db/tx.js';
import { NotFoundError } from '../../lib/errors.js';
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

  const membership = await withUserTransaction(userId, (client) =>
    fetchMembership(client, userId, companyId),
  );

  if (!membership) throw new NotFoundError('company');
  req.companyId = companyId;
  req.companyRole = membership.role;
  next();
}
