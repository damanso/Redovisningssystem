import { query } from '../config/database.js';
import {
  RecurringInvoice,
  RecurringInvoiceLine,
  RecurringInvoiceHistory,
  CreateRecurringInvoiceDto,
  UpdateRecurringInvoiceDto,
  RecurringInvoiceFilters,
  RecurringInvoiceListResponse,
  RecurringInvoiceStats,
  GenerateInvoiceFromRecurringDto,
  RecurringFrequency
} from '../types/recurringInvoice.types.js';
import * as invoiceService from './invoiceService.js';
import * as auditService from './auditService.js';

// Calculate next generation date based on frequency and interval
export const calculateNextGenerationDate = (
  currentDate: Date,
  frequency: RecurringFrequency,
  intervalCount: number = 1
): Date => {
  const next = new Date(currentDate);

  switch (frequency) {
    case 'daily':
      next.setDate(next.getDate() + intervalCount);
      break;
    case 'weekly':
      next.setDate(next.getDate() + (7 * intervalCount));
      break;
    case 'monthly':
      next.setMonth(next.getMonth() + intervalCount);
      break;
    case 'quarterly':
      next.setMonth(next.getMonth() + (3 * intervalCount));
      break;
    case 'yearly':
      next.setFullYear(next.getFullYear() + intervalCount);
      break;
  }

  return next;
};

// Check if recurring invoice should be completed
const shouldComplete = (recurring: RecurringInvoice): boolean => {
  // Check if reached max occurrences
  if (recurring.max_occurrences && recurring.generated_count >= recurring.max_occurrences) {
    return true;
  }

  // Check if past end date
  if (recurring.end_date && new Date(recurring.end_date) <= new Date()) {
    return true;
  }

  return false;
};

// Create recurring invoice
export const createRecurringInvoice = async (
  companyId: string,
  userId: string,
  data: CreateRecurringInvoiceDto
): Promise<RecurringInvoice> => {
  await query('BEGIN');

  try {
    const startDate = new Date(data.start_date);
    const intervalCount = data.interval_count || 1;
    const nextGenDate = calculateNextGenerationDate(startDate, data.frequency, intervalCount);

    // Create recurring invoice
    const recurringResult = await query(
      `INSERT INTO recurring_invoices (
        company_id, customer_id, template_name, payment_terms, currency,
        reference, notes, frequency, interval_count, start_date, end_date,
        next_generation_date, max_occurrences, status, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      RETURNING *`,
      [
        companyId,
        data.customer_id,
        data.template_name,
        data.payment_terms || 30,
        'SEK',
        data.reference || null,
        data.notes || null,
        data.frequency,
        intervalCount,
        startDate,
        data.end_date ? new Date(data.end_date) : null,
        nextGenDate,
        data.max_occurrences || null,
        'active',
        userId
      ]
    );

    const recurring = recurringResult.rows[0];

    // Create recurring invoice lines
    for (let i = 0; i < data.lines.length; i++) {
      const line = data.lines[i];
      await query(
        `INSERT INTO recurring_invoice_lines (
          recurring_invoice_id, article_id, description, quantity,
          unit_price, unit, vat_rate, line_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          recurring.id,
          line.article_id || null,
          line.description,
          line.quantity,
          line.unit_price,
          line.unit || 'st',
          line.vat_rate,
          i + 1
        ]
      );
    }

    await query('COMMIT');

    // Log audit
    await auditService.logAction(userId, 'recurring_invoice.create', 'recurring_invoice', {
      companyId,
      entityId: recurring.id
    });

    return await getRecurringInvoiceById(recurring.id, companyId);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

// Get all recurring invoices with filters
export const getRecurringInvoices = async (
  companyId: string,
  filters?: RecurringInvoiceFilters
): Promise<RecurringInvoiceListResponse> => {
  let queryText = `
    SELECT ri.*, c.name as customer_name, c.email as customer_email
    FROM recurring_invoices ri
    LEFT JOIN customers c ON ri.customer_id = c.id
    WHERE ri.company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.customer_id) {
    queryText += ` AND ri.customer_id = $${paramCount}`;
    params.push(filters.customer_id);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND ri.status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  if (filters?.search) {
    queryText += ` AND (ri.template_name ILIKE $${paramCount} OR c.name ILIKE $${paramCount} OR ri.reference ILIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  // Get total count
  const countResult = await query(
    queryText.replace('SELECT ri.*, c.name as customer_name, c.email as customer_email', 'SELECT COUNT(*)'),
    params
  );
  const total = parseInt(countResult.rows[0].count);

  // Add ordering and pagination
  queryText += ' ORDER BY ri.next_generation_date ASC, ri.template_name ASC';

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
  }

  const result = await query(queryText, params);

  return {
    recurring_invoices: result.rows,
    total
  };
};

// Get recurring invoice by ID with lines
export const getRecurringInvoiceById = async (
  recurringId: string,
  companyId: string
): Promise<RecurringInvoice> => {
  const recurringResult = await query(
    `SELECT ri.*, c.name as customer_name, c.email as customer_email
     FROM recurring_invoices ri
     LEFT JOIN customers c ON ri.customer_id = c.id
     WHERE ri.id = $1 AND ri.company_id = $2`,
    [recurringId, companyId]
  );

  if (recurringResult.rows.length === 0) {
    throw new Error('Recurring invoice not found');
  }

  const recurring = recurringResult.rows[0];

  // Get recurring invoice lines
  const linesResult = await query(
    'SELECT * FROM recurring_invoice_lines WHERE recurring_invoice_id = $1 ORDER BY line_order',
    [recurringId]
  );

  recurring.lines = linesResult.rows;

  return recurring;
};

// Update recurring invoice
export const updateRecurringInvoice = async (
  recurringId: string,
  companyId: string,
  userId: string,
  data: UpdateRecurringInvoiceDto
): Promise<RecurringInvoice> => {
  await query('BEGIN');

  try {
    // Check if recurring invoice exists
    const checkResult = await query(
      'SELECT * FROM recurring_invoices WHERE id = $1 AND company_id = $2',
      [recurringId, companyId]
    );

    if (checkResult.rows.length === 0) {
      throw new Error('Recurring invoice not found');
    }

    const existing = checkResult.rows[0];

    // Update header if provided
    const updateFields: string[] = [];
    const updateParams: any[] = [];
    let paramCount = 1;

    if (data.template_name !== undefined) {
      updateFields.push(`template_name = $${paramCount}`);
      updateParams.push(data.template_name);
      paramCount++;
    }

    if (data.payment_terms !== undefined) {
      updateFields.push(`payment_terms = $${paramCount}`);
      updateParams.push(data.payment_terms);
      paramCount++;
    }

    if (data.reference !== undefined) {
      updateFields.push(`reference = $${paramCount}`);
      updateParams.push(data.reference || null);
      paramCount++;
    }

    if (data.notes !== undefined) {
      updateFields.push(`notes = $${paramCount}`);
      updateParams.push(data.notes || null);
      paramCount++;
    }

    // Handle frequency changes - recalculate next generation date
    let recalculateNext = false;
    let newFrequency = existing.frequency;
    let newIntervalCount = existing.interval_count;

    if (data.frequency !== undefined) {
      updateFields.push(`frequency = $${paramCount}`);
      updateParams.push(data.frequency);
      newFrequency = data.frequency;
      paramCount++;
      recalculateNext = true;
    }

    if (data.interval_count !== undefined) {
      updateFields.push(`interval_count = $${paramCount}`);
      updateParams.push(data.interval_count);
      newIntervalCount = data.interval_count;
      paramCount++;
      recalculateNext = true;
    }

    if (data.start_date !== undefined) {
      updateFields.push(`start_date = $${paramCount}`);
      updateParams.push(new Date(data.start_date));
      paramCount++;
      recalculateNext = true;
    }

    if (data.end_date !== undefined) {
      updateFields.push(`end_date = $${paramCount}`);
      updateParams.push(data.end_date ? new Date(data.end_date) : null);
      paramCount++;
    }

    if (data.max_occurrences !== undefined) {
      updateFields.push(`max_occurrences = $${paramCount}`);
      updateParams.push(data.max_occurrences || null);
      paramCount++;
    }

    // Recalculate next generation date if frequency/interval changed
    if (recalculateNext) {
      const baseDate = existing.last_generated_date
        ? new Date(existing.last_generated_date)
        : new Date(data.start_date || existing.start_date);

      const nextDate = calculateNextGenerationDate(baseDate, newFrequency, newIntervalCount);
      updateFields.push(`next_generation_date = $${paramCount}`);
      updateParams.push(nextDate);
      paramCount++;
    }

    if (updateFields.length > 0) {
      updateParams.push(recurringId, companyId);
      await query(
        `UPDATE recurring_invoices SET ${updateFields.join(', ')} WHERE id = $${paramCount} AND company_id = $${paramCount + 1}`,
        updateParams
      );
    }

    // Update lines if provided
    if (data.lines) {
      // Delete existing lines
      await query('DELETE FROM recurring_invoice_lines WHERE recurring_invoice_id = $1', [recurringId]);

      // Create new lines
      for (let i = 0; i < data.lines.length; i++) {
        const line = data.lines[i];
        await query(
          `INSERT INTO recurring_invoice_lines (
            recurring_invoice_id, article_id, description, quantity,
            unit_price, unit, vat_rate, line_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            recurringId,
            line.article_id || null,
            line.description,
            line.quantity,
            line.unit_price,
            line.unit || 'st',
            line.vat_rate,
            i + 1
          ]
        );
      }
    }

    await query('COMMIT');

    // Log audit
    await auditService.logAction(userId, 'recurring_invoice.update', 'recurring_invoice', {
      companyId,
      entityId: recurringId
    });

    return await getRecurringInvoiceById(recurringId, companyId);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

// Generate invoice from recurring template
export const generateInvoiceFromRecurring = async (
  recurringId: string,
  companyId: string,
  userId: string,
  data?: GenerateInvoiceFromRecurringDto
): Promise<{ invoice: any; recurring: RecurringInvoice }> => {
  await query('BEGIN');

  try {
    // Get recurring invoice with lines
    const recurring = await getRecurringInvoiceById(recurringId, companyId);

    // Check if active
    if (recurring.status !== 'active') {
      throw new Error('Recurring invoice is not active');
    }

    // Check if should be completed
    if (shouldComplete(recurring)) {
      throw new Error('Recurring invoice has reached its limit');
    }

    // Calculate invoice date
    const invoiceDate = data?.generation_date ? new Date(data.generation_date) : new Date();

    // Calculate due date
    const dueDate = new Date(invoiceDate);
    dueDate.setDate(dueDate.getDate() + recurring.payment_terms);

    // Create invoice from template
    const invoice = await invoiceService.createInvoice(companyId, userId, {
      customer_id: recurring.customer_id,
      invoice_date: invoiceDate.toISOString().split('T')[0],
      due_date: dueDate.toISOString().split('T')[0],
      payment_terms: recurring.payment_terms,
      reference: recurring.reference,
      notes: recurring.notes,
      lines: (recurring.lines || []).map(line => ({
        article_id: line.article_id,
        description: line.description,
        quantity: line.quantity,
        unit_price: line.unit_price,
        unit: line.unit,
        vat_rate: line.vat_rate
      }))
    });

    // Calculate period
    const periodStart = new Date(recurring.next_generation_date);
    const periodEnd = calculateNextGenerationDate(
      periodStart,
      recurring.frequency,
      recurring.interval_count
    );

    // Record in history
    await query(
      `INSERT INTO recurring_invoice_history (
        recurring_invoice_id, invoice_id, generated_date, period_start, period_end
      ) VALUES ($1, $2, $3, $4, $5)`,
      [recurringId, invoice.id, invoiceDate, periodStart, periodEnd]
    );

    // Calculate next generation date
    const nextGenDate = calculateNextGenerationDate(
      new Date(recurring.next_generation_date),
      recurring.frequency,
      recurring.interval_count
    );

    // Update recurring invoice
    const newGeneratedCount = recurring.generated_count + 1;
    const newStatus = shouldComplete({
      ...recurring,
      generated_count: newGeneratedCount
    }) ? 'completed' : 'active';

    await query(
      `UPDATE recurring_invoices
       SET last_generated_date = $1,
           next_generation_date = $2,
           generated_count = $3,
           status = $4
       WHERE id = $5`,
      [invoiceDate, nextGenDate, newGeneratedCount, newStatus, recurringId]
    );

    await query('COMMIT');

    // Log audit
    await auditService.logAction(userId, 'recurring_invoice.generate', 'recurring_invoice', {
      companyId,
      entityId: recurringId,
      metadata: { invoiceId: invoice.id }
    });

    const updatedRecurring = await getRecurringInvoiceById(recurringId, companyId);

    return {
      invoice,
      recurring: updatedRecurring
    };
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

// Pause recurring invoice
export const pauseRecurringInvoice = async (
  recurringId: string,
  companyId: string,
  userId: string
): Promise<RecurringInvoice> => {
  const result = await query(
    `UPDATE recurring_invoices
     SET status = 'paused'
     WHERE id = $1 AND company_id = $2 AND status = 'active'
     RETURNING *`,
    [recurringId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Recurring invoice not found or cannot be paused');
  }

  // Log audit
  await auditService.logAction(userId, 'recurring_invoice.pause', 'recurring_invoice', {
    companyId,
    entityId: recurringId
  });

  return await getRecurringInvoiceById(recurringId, companyId);
};

// Resume recurring invoice
export const resumeRecurringInvoice = async (
  recurringId: string,
  companyId: string,
  userId: string
): Promise<RecurringInvoice> => {
  const result = await query(
    `UPDATE recurring_invoices
     SET status = 'active'
     WHERE id = $1 AND company_id = $2 AND status = 'paused'
     RETURNING *`,
    [recurringId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Recurring invoice not found or cannot be resumed');
  }

  // Log audit
  await auditService.logAction(userId, 'recurring_invoice.resume', 'recurring_invoice', {
    companyId,
    entityId: recurringId
  });

  return await getRecurringInvoiceById(recurringId, companyId);
};

// Cancel recurring invoice
export const cancelRecurringInvoice = async (
  recurringId: string,
  companyId: string,
  userId: string
): Promise<RecurringInvoice> => {
  const result = await query(
    `UPDATE recurring_invoices
     SET status = 'cancelled'
     WHERE id = $1 AND company_id = $2 AND status IN ('active', 'paused')
     RETURNING *`,
    [recurringId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Recurring invoice not found or cannot be cancelled');
  }

  // Log audit
  await auditService.logAction(userId, 'recurring_invoice.cancel', 'recurring_invoice', {
    companyId,
    entityId: recurringId
  });

  return await getRecurringInvoiceById(recurringId, companyId);
};

// Delete recurring invoice
export const deleteRecurringInvoice = async (
  recurringId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  const result = await query(
    'DELETE FROM recurring_invoices WHERE id = $1 AND company_id = $2 RETURNING id',
    [recurringId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Recurring invoice not found');
  }

  // Log audit
  await auditService.logAction(userId, 'recurring_invoice.delete', 'recurring_invoice', {
    companyId,
    entityId: recurringId
  });
};

// Get recurring invoice history
export const getRecurringInvoiceHistory = async (
  recurringId: string,
  companyId: string
): Promise<RecurringInvoiceHistory[]> => {
  // Verify ownership
  const checkResult = await query(
    'SELECT id FROM recurring_invoices WHERE id = $1 AND company_id = $2',
    [recurringId, companyId]
  );

  if (checkResult.rows.length === 0) {
    throw new Error('Recurring invoice not found');
  }

  const result = await query(
    `SELECT h.*, i.invoice_number, i.status as invoice_status, i.total_amount as invoice_total
     FROM recurring_invoice_history h
     LEFT JOIN invoices i ON h.invoice_id = i.id
     WHERE h.recurring_invoice_id = $1
     ORDER BY h.generated_date DESC`,
    [recurringId]
  );

  return result.rows;
};

// Get recurring invoice statistics
export const getRecurringInvoiceStats = async (companyId: string): Promise<RecurringInvoiceStats> => {
  const result = await query(
    `SELECT
      COUNT(*) as total_recurring,
      SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active_recurring,
      SUM(CASE WHEN status = 'paused' THEN 1 ELSE 0 END) as paused_recurring,
      SUM(generated_count) as total_generated,
      SUM(CASE WHEN status = 'active' AND next_generation_date <= CURRENT_DATE THEN 1 ELSE 0 END) as pending_generation
     FROM recurring_invoices
     WHERE company_id = $1`,
    [companyId]
  );

  const stats = result.rows[0];

  return {
    total_recurring: parseInt(stats.total_recurring),
    active_recurring: parseInt(stats.active_recurring),
    paused_recurring: parseInt(stats.paused_recurring),
    total_generated: parseInt(stats.total_generated) || 0,
    pending_generation: parseInt(stats.pending_generation) || 0
  };
};

// Process all due recurring invoices (for cron job)
export const processDueRecurringInvoices = async (): Promise<{
  processed: number;
  succeeded: number;
  failed: number;
  errors: Array<{ recurringId: string; error: string }>;
}> => {
  const result = {
    processed: 0,
    succeeded: 0,
    failed: 0,
    errors: [] as Array<{ recurringId: string; error: string }>
  };

  try {
    // Find all active recurring invoices that are due
    const dueResult = await query(
      `SELECT id, company_id, created_by
       FROM recurring_invoices
       WHERE status = 'active'
       AND next_generation_date <= CURRENT_DATE`,
      []
    );

    const dueInvoices = dueResult.rows;
    result.processed = dueInvoices.length;

    // Process each due recurring invoice
    for (const due of dueInvoices) {
      try {
        await generateInvoiceFromRecurring(due.id, due.company_id, due.created_by);
        result.succeeded++;
      } catch (error: any) {
        result.failed++;
        result.errors.push({
          recurringId: due.id,
          error: error.message || 'Unknown error'
        });
      }
    }

    return result;
  } catch (error) {
    throw error;
  }
};
