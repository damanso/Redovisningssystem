// Fas A10: team & roller. Ägare/admin kan bjuda in befintliga användare (via
// e-post), ändra roll och ta bort medlemmar. Behörighet enforce:as i BÅDE
// tjänstelagret (tydliga fel) och RLS (databasen som sista linje). En invariant:
// ett bolag måste alltid ha minst en ägare — den siste ägaren kan varken
// degraderas eller tas bort.
import type { PoolClient } from 'pg';
import type { CompanyRole } from '../db/tx.js';
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError } from '../lib/errors.js';
import { writeAudit } from './auditService.js';
import { notify } from './notifications.js';

export type ManageableRole = 'admin' | 'member';

export interface Member { user_id: string; email: string; name: string; role: CompanyRole; created_at: string; is_you: boolean }

function assertAdmin(actorRole: CompanyRole): void {
  if (actorRole !== 'owner' && actorRole !== 'admin') {
    throw new ForbiddenError('not_admin', 'endast ägare eller admin kan hantera teamet');
  }
}

export async function listMembers(client: PoolClient, companyId: string, currentUserId: string): Promise<Member[]> {
  const r = await client.query<{ user_id: string; email: string; name: string; role: CompanyRole; created_at: string }>(
    `SELECT m.user_id, u.email, u.name, m.role, m.created_at::text
     FROM company_members m JOIN users u ON u.id = m.user_id
     WHERE m.company_id = $1
     ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 ELSE 2 END, u.name`,
    [companyId],
  );
  return r.rows.map((x) => ({ ...x, is_you: x.user_id === currentUserId }));
}

/**
 * Antal ägare i bolaget. LÅSER ägarraderna (FOR UPDATE) så två samtidiga
 * degraderingar/borttag av olika ägare inte båda kan passera siste-ägaren-kollen
 * och lämna bolaget utan ägare (TOCTOU/write-skew under READ COMMITTED). count(*)
 * kan inte kombineras med FOR UPDATE, så vi låser raderna och räknar dem i JS.
 */
async function lockedOwnerCount(client: PoolClient, companyId: string): Promise<number> {
  const r = await client.query(
    "SELECT user_id FROM company_members WHERE company_id = $1 AND role = 'owner' FOR UPDATE", [companyId],
  );
  return r.rowCount ?? 0;
}

/** Bjud in en BEFINTLIG användare (konto krävs) via e-post. Nyregistrering via
 *  inbjudningslänk kräver e-postutskick (Fas A12/SMTP) och är inte byggt än. */
export async function inviteMember(
  client: PoolClient, companyId: string, actorRole: CompanyRole, actorUserId: string,
  email: string, role: ManageableRole,
): Promise<Member> {
  assertAdmin(actorRole);
  const u = await client.query<{ id: string; name: string; email: string }>(
    'SELECT id, name, email FROM users WHERE lower(email) = lower($1)', [email],
  );
  if (!u.rows[0]) {
    // Ingen läcka av huruvida e-posten finns i systemet globalt — men för en
    // admin-driven inbjudan är ett tydligt fel rimligt och inte känsligt.
    throw new BadRequestError('user_not_found', 'ingen användare med den e-postadressen (inbjudningslänk kräver e-postutskick, ännu ej byggt)');
  }
  const targetId = u.rows[0].id;
  const existing = await client.query('SELECT 1 FROM company_members WHERE company_id = $1 AND user_id = $2', [companyId, targetId]);
  if (existing.rows[0]) throw new ConflictError('already_member', 'användaren är redan medlem');

  await client.query('INSERT INTO company_members (company_id, user_id, role) VALUES ($1, $2, $3)', [companyId, targetId, role]);
  await writeAudit(client, {
    companyId, userId: actorUserId, action: 'team.member_invited', entityType: 'company_member',
    entityId: targetId, details: { email: u.rows[0].email, role },
  });
  // Notifiera den inbjudna användaren (in-app + valfri e-post via outboxen).
  const co = await client.query<{ name: string }>('SELECT name FROM companies WHERE id = $1', [companyId]);
  const companyName = co.rows[0]?.name ?? 'ett bolag';
  await notify(client, {
    userId: targetId, companyId, kind: 'team_invite',
    title: `Du har lagts till i ${companyName}`,
    body: `Du är nu ${role === 'admin' ? 'administratör' : 'medlem'} i ${companyName}.`,
    link: `/app/c/${companyId}`,
    email: { toEmail: u.rows[0].email },
  });
  const members = await listMembers(client, companyId, actorUserId);
  return members.find((m) => m.user_id === targetId)!;
}

export async function setMemberRole(
  client: PoolClient, companyId: string, actorRole: CompanyRole, actorUserId: string,
  targetUserId: string, newRole: CompanyRole,
): Promise<Member> {
  assertAdmin(actorRole);
  const cur = await client.query<{ role: CompanyRole }>(
    'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2', [companyId, targetUserId],
  );
  if (!cur.rows[0]) throw new NotFoundError('member');
  const currentRole = cur.rows[0].role;
  // Endast en ägare får skapa/ändra ägarroller (befordra till/från owner).
  if ((newRole === 'owner' || currentRole === 'owner') && actorRole !== 'owner') {
    throw new ForbiddenError('owner_only', 'endast en ägare kan hantera ägarrollen');
  }
  // Skydda den siste ägaren: degradera inte bort den enda ägaren.
  if (currentRole === 'owner' && newRole !== 'owner' && (await lockedOwnerCount(client, companyId)) <= 1) {
    throw new ConflictError('last_owner', 'bolaget måste ha minst en ägare');
  }
  await client.query('UPDATE company_members SET role = $3 WHERE company_id = $1 AND user_id = $2', [companyId, targetUserId, newRole]);
  await writeAudit(client, {
    companyId, userId: actorUserId, action: 'team.role_changed', entityType: 'company_member',
    entityId: targetUserId, details: { from: currentRole, to: newRole },
  });
  const members = await listMembers(client, companyId, actorUserId);
  return members.find((m) => m.user_id === targetUserId)!;
}

export async function removeMember(
  client: PoolClient, companyId: string, actorRole: CompanyRole, actorUserId: string, targetUserId: string,
): Promise<{ removed: string }> {
  assertAdmin(actorRole);
  const cur = await client.query<{ role: CompanyRole }>(
    'SELECT role FROM company_members WHERE company_id = $1 AND user_id = $2', [companyId, targetUserId],
  );
  if (!cur.rows[0]) throw new NotFoundError('member');
  if (cur.rows[0].role === 'owner') {
    // En ägare får bara tas bort av en ägare, och aldrig den siste.
    if (actorRole !== 'owner') throw new ForbiddenError('owner_only', 'endast en ägare kan ta bort en ägare');
    if ((await lockedOwnerCount(client, companyId)) <= 1) throw new ConflictError('last_owner', 'bolaget måste ha minst en ägare');
  }
  await client.query('DELETE FROM company_members WHERE company_id = $1 AND user_id = $2', [companyId, targetUserId]);
  await writeAudit(client, {
    companyId, userId: actorUserId, action: 'team.member_removed', entityType: 'company_member',
    entityId: targetUserId, details: { role: cur.rows[0].role },
  });
  return { removed: targetUserId };
}
