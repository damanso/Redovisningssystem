import { query } from '../config/database';
import {
  BASAccount,
  JournalEntry,
  CreateJournalEntryDto,
  JournalEntryFilters,
  AccountBalance,
  TrialBalance
} from '../types/accounting.types';

/**
 * Get all BAS accounts with optional filtering
 */
export const getBASAccounts = async (filters?: {
  account_type?: string;
  search?: string;
}): Promise<BASAccount[]> => {
  let queryText = 'SELECT * FROM bas_accounts WHERE 1=1';
  const params: any[] = [];
  let paramCount = 1;

  if (filters?.account_type) {
    queryText += ` AND account_type = $${paramCount}`;
    params.push(filters.account_type);
    paramCount++;
  }

  if (filters?.search) {
    queryText += ` AND (account_name ILIKE $${paramCount} OR CAST(account_number AS TEXT) LIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  queryText += ' ORDER BY account_number';

  const result = await query(queryText, params);
  return result.rows;
};

/**
 * Create a journal entry with validation
 * Ensures debit = credit (balanced entry)
 */
export const createJournalEntry = async (
  companyId: string,
  userId: string,
  data: CreateJournalEntryDto
): Promise<JournalEntry> => {
  // Validate balanced entry
  const totalDebit = data.lines.reduce((sum, line) => sum + (line.debit || 0), 0);
  const totalCredit = data.lines.reduce((sum, line) => sum + (line.credit || 0), 0);

  if (Math.abs(totalDebit - totalCredit) > 0.01) {
    throw new Error(`Journal entry must be balanced (debit ${totalDebit} ≠ credit ${totalCredit})`);
  }

  // Start transaction
  await query('BEGIN');

  try {
    // Create journal entry
    const entryResult = await query(
      `INSERT INTO journal_entries (
        company_id, entry_date, description, reference_type, reference_id, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        companyId,
        data.entry_date,
        data.description || null,
        data.reference_type || null,
        data.reference_id || null,
        userId
      ]
    );

    const entry = entryResult.rows[0];

    // Create journal entry lines
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      await query(
        `INSERT INTO journal_entry_lines (
          journal_entry_id, account_number, debit, credit, description, line_order
        ) VALUES ($1, $2, $3, $4, $5, $6)`,
        [
          entry.id,
          line.account_number,
          line.debit || 0,
          line.credit || 0,
          line.description || null,
          i + 1
        ]
      );
    }

    await query('COMMIT');

    return await getJournalEntryById(entry.id, companyId);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

/**
 * Book an invoice (create journal entry for invoice)
 * Debit: Kundfordringar (1510)
 * Credit: Försäljning (3000/3100) and Utgående moms (2610)
 */
export const bookInvoice = async (
  invoiceId: string,
  companyId: string,
  userId: string
): Promise<JournalEntry> => {
  const { getInvoiceById } = await import('./invoiceService');
  const invoice = await getInvoiceById(invoiceId, companyId);

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  return await createJournalEntry(companyId, userId, {
    entry_date: new Date(invoice.invoice_date).toISOString().split('T')[0],
    description: `Faktura ${invoice.invoice_number}`,
    reference_type: 'invoice',
    reference_id: invoiceId,
    lines: [
      {
        account_number: 1510, // Kundfordringar
        debit: invoice.total_amount,
        description: `Faktura ${invoice.invoice_number}`
      },
      {
        account_number: 3000, // Försäljning varor (or 3100 for services)
        credit: invoice.subtotal,
        description: 'Försäljning'
      },
      {
        account_number: 2610, // Utgående moms
        credit: invoice.vat_amount,
        description: 'Moms 25%'
      }
    ]
  });
};

/**
 * Book invoice payment
 * Debit: Bankkonto (1930)
 * Credit: Kundfordringar (1510)
 */
export const bookInvoicePayment = async (
  invoiceId: string,
  companyId: string,
  userId: string,
  paymentDate: string,
  amount: number
): Promise<JournalEntry> => {
  const { getInvoiceById } = await import('./invoiceService');
  const invoice = await getInvoiceById(invoiceId, companyId);

  if (!invoice) {
    throw new Error('Invoice not found');
  }

  return await createJournalEntry(companyId, userId, {
    entry_date: paymentDate,
    description: `Betalning faktura ${invoice.invoice_number}`,
    reference_type: 'invoice_payment',
    reference_id: invoiceId,
    lines: [
      {
        account_number: 1930, // Bankkonto
        debit: amount,
        description: 'Betalning'
      },
      {
        account_number: 1510, // Kundfordringar
        credit: amount,
        description: `Faktura ${invoice.invoice_number}`
      }
    ]
  });
};

/**
 * Book a receipt (expense)
 * Debit: Kostnadskonto and Ingående moms (1630)
 * Credit: Leverantörsskulder (2440)
 */
export const bookReceipt = async (
  receiptId: string,
  companyId: string,
  userId: string
): Promise<JournalEntry> => {
  const { getReceiptById } = await import('./receiptService');
  const receipt = await getReceiptById(receiptId, companyId);

  if (!receipt) {
    throw new Error('Receipt not found');
  }

  // Determine expense account based on category
  let expenseAccount = 6980; // Default: Övriga externa kostnader

  if (receipt.category) {
    const categoryMap: { [key: string]: number } = {
      'Lokaler': 5010,
      'Representation': 5800,
      'Personal': 6071,
      'Personalkostnader': 6071,
      'Bank': 6570,
      'Bankkostnader': 6570,
      'Inköp': 4000,
      'IT': 6980,
      'Kontorsmaterial': 6980,
      'Mat': 6980,
      'Transport': 6980
    };
    expenseAccount = categoryMap[receipt.category] || 6980;
  }

  // Build journal entry lines
  const lines: any[] = [
    {
      account_number: expenseAccount,
      debit: receipt.amount,
      description: receipt.description || 'Kostnad'
    }
  ];

  // Add VAT line if applicable
  if (receipt.vat_amount && receipt.vat_amount > 0) {
    lines.push({
      account_number: 1630, // Ingående moms
      debit: receipt.vat_amount,
      description: 'Moms'
    });
  }

  // Credit line (payable)
  lines.push({
    account_number: 2440, // Leverantörsskulder
    credit: receipt.total_amount,
    description: receipt.supplier_name || 'Att betala'
  });

  return await createJournalEntry(companyId, userId, {
    entry_date: new Date(receipt.receipt_date).toISOString().split('T')[0],
    description: `Kvitto${receipt.supplier_name ? ' - ' + receipt.supplier_name : ''}`,
    reference_type: 'receipt',
    reference_id: receiptId,
    lines
  });
};

/**
 * Get journal entries with optional filters
 */
export const getJournalEntries = async (
  companyId: string,
  filters?: JournalEntryFilters
): Promise<JournalEntry[]> => {
  let queryText = 'SELECT * FROM journal_entries WHERE company_id = $1';
  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.start_date) {
    queryText += ` AND entry_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND entry_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  if (filters?.reference_type) {
    queryText += ` AND reference_type = $${paramCount}`;
    params.push(filters.reference_type);
    paramCount++;
  }

  queryText += ' ORDER BY entry_date DESC, created_at DESC';

  const result = await query(queryText, params);

  // Get lines for each entry
  for (const entry of result.rows) {
    const linesResult = await query(
      `SELECT jel.*, ba.account_name
       FROM journal_entry_lines jel
       LEFT JOIN bas_accounts ba ON jel.account_number = ba.account_number
       WHERE jel.journal_entry_id = $1
       ORDER BY jel.line_order`,
      [entry.id]
    );
    entry.lines = linesResult.rows;
  }

  return result.rows;
};

/**
 * Get a single journal entry by ID
 */
export const getJournalEntryById = async (
  entryId: string,
  companyId: string
): Promise<JournalEntry> => {
  const result = await query(
    'SELECT * FROM journal_entries WHERE id = $1 AND company_id = $2',
    [entryId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Journal entry not found');
  }

  const entry = result.rows[0];

  // Get lines
  const linesResult = await query(
    `SELECT jel.*, ba.account_name
     FROM journal_entry_lines jel
     LEFT JOIN bas_accounts ba ON jel.account_number = ba.account_number
     WHERE jel.journal_entry_id = $1
     ORDER BY jel.line_order`,
    [entryId]
  );

  entry.lines = linesResult.rows;

  return entry;
};

/**
 * Get trial balance (råbalans) for a company
 */
export const getTrialBalance = async (
  companyId: string,
  startDate?: string,
  endDate?: string
): Promise<TrialBalance> => {
  let queryText = `
    SELECT
      ba.account_number,
      ba.account_name,
      ba.account_type,
      COALESCE(SUM(jel.debit), 0) as debit_total,
      COALESCE(SUM(jel.credit), 0) as credit_total,
      COALESCE(SUM(jel.debit), 0) - COALESCE(SUM(jel.credit), 0) as balance
    FROM bas_accounts ba
    LEFT JOIN journal_entry_lines jel ON ba.account_number = jel.account_number
    LEFT JOIN journal_entries je ON jel.journal_entry_id = je.id
    WHERE (je.company_id = $1 OR je.company_id IS NULL)
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (startDate) {
    queryText += ` AND je.entry_date >= $${paramCount}`;
    params.push(startDate);
    paramCount++;
  }

  if (endDate) {
    queryText += ` AND je.entry_date <= $${paramCount}`;
    params.push(endDate);
    paramCount++;
  }

  queryText += `
    GROUP BY ba.account_number, ba.account_name, ba.account_type
    HAVING COALESCE(SUM(jel.debit), 0) != 0 OR COALESCE(SUM(jel.credit), 0) != 0
    ORDER BY ba.account_number
  `;

  const result = await query(queryText, params);

  const accounts: AccountBalance[] = result.rows.map(row => ({
    account_number: row.account_number,
    account_name: row.account_name,
    account_type: row.account_type,
    debit_total: parseFloat(row.debit_total),
    credit_total: parseFloat(row.credit_total),
    balance: parseFloat(row.balance)
  }));

  // Calculate totals by type
  const assets_total = accounts
    .filter(a => a.account_type === 'asset')
    .reduce((sum, a) => sum + a.balance, 0);

  const liabilities_total = accounts
    .filter(a => a.account_type === 'liability')
    .reduce((sum, a) => sum - a.balance, 0); // Negative balance for liabilities

  const equity_total = accounts
    .filter(a => a.account_type === 'equity')
    .reduce((sum, a) => sum - a.balance, 0);

  const revenue_total = accounts
    .filter(a => a.account_type === 'revenue')
    .reduce((sum, a) => sum - a.balance, 0);

  const expense_total = accounts
    .filter(a => a.account_type === 'expense')
    .reduce((sum, a) => sum + a.balance, 0);

  return {
    assets_total,
    liabilities_total,
    equity_total,
    revenue_total,
    expense_total,
    accounts
  };
};
