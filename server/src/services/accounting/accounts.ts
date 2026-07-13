import type { PoolClient } from 'pg';
import { BadRequestError, ConflictError } from '../../lib/errors.js';
import { writeAudit } from '../auditService.js';

/**
 * Kontrollerar att alla kontonummer finns för DETTA bolag (standard eller
 * bolagets egna) och är aktiva. Bolagsscopat: ett konto som bara finns i ett
 * annat bolag (som användaren råkar vara medlem i) accepteras inte här.
 */
export async function assertAccountsExist(
  client: PoolClient,
  companyId: string,
  accountNumbers: number[],
): Promise<void> {
  const unique = [...new Set(accountNumbers)];
  if (unique.length === 0) return;
  const result = await client.query<{ account_number: number }>(
    `SELECT DISTINCT account_number FROM accounts
     WHERE account_number = ANY($1::int[]) AND is_active
       AND (company_id IS NULL OR company_id = $2)`,
    [unique, companyId],
  );
  const found = new Set(result.rows.map((r) => r.account_number));
  const missing = unique.filter((n) => !found.has(n));
  if (missing.length > 0) {
    throw new BadRequestError('unknown_account', `okända/inaktiva konton: ${missing.join(', ')}`);
  }
}

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';

export interface Account {
  account_number: number;
  name: string;
  account_type: AccountType;
  is_active: boolean;
  is_custom: boolean;
}

/**
 * Listar bolagets kontoplan: standard-BAS + företagsspecifika konton, där ett
 * företagskonto med samma nummer skuggar standardkontot.
 */
export async function listAccounts(client: PoolClient, companyId: string): Promise<Account[]> {
  const result = await client.query<Account>(
    `SELECT DISTINCT ON (account_number)
        account_number, name, account_type, is_active,
        (company_id IS NOT NULL) AS is_custom
     FROM accounts
     WHERE company_id IS NULL OR company_id = $1
     ORDER BY account_number, company_id NULLS LAST`,
    [companyId],
  );
  return result.rows;
}

export async function createCompanyAccount(
  client: PoolClient,
  companyId: string,
  userId: string,
  input: { account_number: number; name: string; account_type: AccountType },
): Promise<Account> {
  if (!Number.isInteger(input.account_number) || input.account_number < 1000 || input.account_number > 9999) {
    throw new BadRequestError('invalid_account', 'kontonummer måste vara 1000–9999');
  }
  let row;
  try {
    const result = await client.query<Account>(
      `INSERT INTO accounts (company_id, account_number, name, account_type)
       VALUES ($1, $2, $3, $4)
       RETURNING account_number, name, account_type, is_active, true AS is_custom`,
      [companyId, input.account_number, input.name, input.account_type],
    );
    row = result.rows[0]!;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      throw new ConflictError('account_exists', 'kontot finns redan för bolaget');
    }
    throw err;
  }
  await writeAudit(client, {
    companyId,
    userId,
    action: 'account.created',
    entityType: 'account',
    entityId: String(input.account_number),
    details: { name: input.name, account_type: input.account_type },
  });
  return row;
}
