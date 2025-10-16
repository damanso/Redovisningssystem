import { query } from '../config/database.js';
import {
  Invoice,
  InvoiceLine,
  CreateInvoiceDto,
  UpdateInvoiceDto,
  InvoiceFilters,
  InvoiceListResponse,
  InvoiceStats
} from '../types/invoice.types.js';
import * as auditService from './auditService.js';

// Generate unique invoice number
export const generateInvoiceNumber = async (companyId: string): Promise<string> => {
  const result = await query(
    `SELECT invoice_number FROM invoices
     WHERE company_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [companyId]
  );

  if (result.rows.length === 0) {
    const currentYear = new Date().getFullYear();
    return `${currentYear}-0001`;
  }

  const lastNumber = result.rows[0].invoice_number;
  const [year, num] = lastNumber.split('-');
  const currentYear = new Date().getFullYear().toString();

  if (year === currentYear) {
    const nextNum = (parseInt(num) + 1).toString().padStart(4, '0');
    return `${currentYear}-${nextNum}`;
  } else {
    return `${currentYear}-0001`;
  }
};

// Generate OCR number (Swedish standard with Luhn checksum)
export const generateOCRNumber = (invoiceNumber: string): string => {
  const cleaned = invoiceNumber.replace(/[^0-9]/g, '');
  const checksum = calculateLuhnChecksum(cleaned);
  return cleaned + checksum;
};

function calculateLuhnChecksum(number: string): string {
  let sum = 0;
  let alternate = false;

  for (let i = number.length - 1; i >= 0; i--) {
    let n = parseInt(number[i]);

    if (alternate) {
      n *= 2;
      if (n > 9) n -= 9;
    }

    sum += n;
    alternate = !alternate;
  }

  return ((10 - (sum % 10)) % 10).toString();
}

// Calculate invoice totals from lines
export const calculateInvoiceTotals = (lines: InvoiceLine[]): {
  subtotal: number;
  vat_amount: number;
  total_amount: number;
} => {
  let subtotal = 0;
  let vat_amount = 0;

  lines.forEach(line => {
    const lineSubtotal = line.quantity * line.unit_price;
    const lineVat = lineSubtotal * (line.vat_rate / 100);

    subtotal += lineSubtotal;
    vat_amount += lineVat;
  });

  const total_amount = subtotal + vat_amount;

  return {
    subtotal: Math.round(subtotal * 100) / 100,
    vat_amount: Math.round(vat_amount * 100) / 100,
    total_amount: Math.round(total_amount * 100) / 100
  };
};

// Create invoice with lines in a transaction
export const createInvoice = async (
  companyId: string,
  userId: string,
  data: CreateInvoiceDto
): Promise<Invoice> => {
  // Start transaction
  await query('BEGIN');

  try {
    // Generate invoice number and OCR
    const invoiceNumber = await generateInvoiceNumber(companyId);
    const ocrNumber = generateOCRNumber(invoiceNumber);

    // Calculate due date if not provided
    const invoiceDate = new Date(data.invoice_date);
    const paymentTerms = data.payment_terms || 30;
    const dueDate = data.due_date
      ? new Date(data.due_date)
      : new Date(invoiceDate.getTime() + paymentTerms * 24 * 60 * 60 * 1000);

    // Calculate line amounts
    const linesWithAmounts = data.lines.map((line, index) => ({
      ...line,
      amount: line.quantity * line.unit_price,
      line_order: index + 1,
      unit: line.unit || 'st'
    }));

    // Calculate totals
    const totals = calculateInvoiceTotals(linesWithAmounts as InvoiceLine[]);

    // Create invoice
    const invoiceResult = await query(
      `INSERT INTO invoices (
        company_id, customer_id, invoice_number, invoice_date, due_date,
        payment_terms, status, currency, subtotal, vat_amount, total_amount,
        paid_amount, reference, notes, ocr_number, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)
      RETURNING *`,
      [
        companyId,
        data.customer_id,
        invoiceNumber,
        invoiceDate,
        dueDate,
        paymentTerms,
        'draft',
        'SEK',
        totals.subtotal,
        totals.vat_amount,
        totals.total_amount,
        0,
        data.reference || null,
        data.notes || null,
        ocrNumber,
        userId
      ]
    );

    const invoice = invoiceResult.rows[0];

    // Create invoice lines
    for (const line of linesWithAmounts) {
      await query(
        `INSERT INTO invoice_lines (
          invoice_id, article_id, description, quantity, unit_price,
          unit, vat_rate, amount, line_order
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          invoice.id,
          line.article_id || null,
          line.description,
          line.quantity,
          line.unit_price,
          line.unit,
          line.vat_rate,
          line.amount,
          line.line_order
        ]
      );
    }

    // Commit transaction
    await query('COMMIT');

    // Log audit
    await auditService.logAction(userId, 'invoice.create', 'invoice', {
      companyId,
      entityId: invoice.id,
    });

    // Fetch complete invoice with lines
    return await getInvoiceById(invoice.id, companyId);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

// Get all invoices with filters
export const getInvoices = async (
  companyId: string,
  filters?: InvoiceFilters
): Promise<InvoiceListResponse> => {
  let queryText = `
    SELECT i.*, c.name as customer_name, c.email as customer_email
    FROM invoices i
    LEFT JOIN customers c ON i.customer_id = c.id
    WHERE i.company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  if (filters?.customer_id) {
    queryText += ` AND i.customer_id = $${paramCount}`;
    params.push(filters.customer_id);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND i.status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  if (filters?.search) {
    queryText += ` AND (i.invoice_number ILIKE $${paramCount} OR c.name ILIKE $${paramCount} OR i.reference ILIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  if (filters?.start_date) {
    queryText += ` AND i.invoice_date >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND i.invoice_date <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  // Get total count
  const countResult = await query(queryText.replace('SELECT i.*, c.name as customer_name, c.email as customer_email', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);

  // Add ordering and pagination
  queryText += ' ORDER BY i.invoice_date DESC, i.invoice_number DESC';

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
    invoices: result.rows,
    total
  };
};

// Get invoice by ID with lines
export const getInvoiceById = async (
  invoiceId: string,
  companyId: string
): Promise<Invoice> => {
  const invoiceResult = await query(
    `SELECT i.*, c.name as customer_name, c.email as customer_email
     FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE i.id = $1 AND i.company_id = $2`,
    [invoiceId, companyId]
  );

  if (invoiceResult.rows.length === 0) {
    throw new Error('Invoice not found');
  }

  const invoice = invoiceResult.rows[0];

  // Get invoice lines
  const linesResult = await query(
    'SELECT * FROM invoice_lines WHERE invoice_id = $1 ORDER BY line_order',
    [invoiceId]
  );

  invoice.lines = linesResult.rows;

  return invoice;
};

// Update invoice (only draft invoices)
export const updateInvoice = async (
  invoiceId: string,
  companyId: string,
  userId: string,
  data: UpdateInvoiceDto
): Promise<Invoice> => {
  await query('BEGIN');

  try {
    // Check if invoice is draft
    const checkResult = await query(
      'SELECT status FROM invoices WHERE id = $1 AND company_id = $2',
      [invoiceId, companyId]
    );

    if (checkResult.rows.length === 0) {
      throw new Error('Invoice not found');
    }

    if (checkResult.rows[0].status !== 'draft') {
      throw new Error('Only draft invoices can be updated');
    }

    // Update invoice header if provided
    if (data.invoice_date || data.due_date || data.payment_terms || data.reference !== undefined || data.notes !== undefined) {
      const updateFields: string[] = [];
      const updateParams: any[] = [];
      let paramCount = 1;

      if (data.invoice_date) {
        updateFields.push(`invoice_date = $${paramCount}`);
        updateParams.push(new Date(data.invoice_date));
        paramCount++;
      }

      if (data.due_date) {
        updateFields.push(`due_date = $${paramCount}`);
        updateParams.push(new Date(data.due_date));
        paramCount++;
      }

      if (data.payment_terms) {
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

      if (updateFields.length > 0) {
        updateParams.push(invoiceId, companyId);
        await query(
          `UPDATE invoices SET ${updateFields.join(', ')} WHERE id = $${paramCount} AND company_id = $${paramCount + 1}`,
          updateParams
        );
      }
    }

    // Update lines if provided
    if (data.lines) {
      // Delete existing lines
      await query('DELETE FROM invoice_lines WHERE invoice_id = $1', [invoiceId]);

      // Create new lines
      const linesWithAmounts = data.lines.map((line, index) => ({
        ...line,
        amount: line.quantity * line.unit_price,
        line_order: index + 1,
        unit: line.unit || 'st'
      }));

      for (const line of linesWithAmounts) {
        await query(
          `INSERT INTO invoice_lines (
            invoice_id, article_id, description, quantity, unit_price,
            unit, vat_rate, amount, line_order
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
          [
            invoiceId,
            line.article_id || null,
            line.description,
            line.quantity,
            line.unit_price,
            line.unit,
            line.vat_rate,
            line.amount,
            line.line_order
          ]
        );
      }

      // Recalculate totals
      const totals = calculateInvoiceTotals(linesWithAmounts as InvoiceLine[]);

      await query(
        `UPDATE invoices
         SET subtotal = $1, vat_amount = $2, total_amount = $3
         WHERE id = $4`,
        [totals.subtotal, totals.vat_amount, totals.total_amount, invoiceId]
      );
    }

    await query('COMMIT');

    // Log audit
    await auditService.logAction(userId, 'invoice.update', 'invoice', {
      companyId,
      entityId: invoiceId
    });

    return await getInvoiceById(invoiceId, companyId);
  } catch (error) {
    await query('ROLLBACK');
    throw error;
  }
};

// Mark invoice as sent
export const markInvoiceAsSent = async (
  invoiceId: string,
  companyId: string,
  userId: string
): Promise<Invoice> => {
  const result = await query(
    `UPDATE invoices
     SET status = 'sent', sent_date = CURRENT_TIMESTAMP
     WHERE id = $1 AND company_id = $2 AND status = 'draft'
     RETURNING *`,
    [invoiceId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Invoice not found or cannot be sent');
  }

  // Log audit
  await auditService.logAction(userId, 'invoice.send', 'invoice', {
    companyId,
    entityId: invoiceId
  });

  return await getInvoiceById(invoiceId, companyId);
};

// Mark invoice as paid
export const markInvoiceAsPaid = async (
  invoiceId: string,
  companyId: string,
  userId: string,
  paidAmount: number,
  paidDate: Date
): Promise<Invoice> => {
  const result = await query(
    `UPDATE invoices
     SET status = 'paid', paid_amount = $3, paid_date = $4
     WHERE id = $1 AND company_id = $2
     RETURNING *`,
    [invoiceId, companyId, paidAmount, paidDate]
  );

  if (result.rows.length === 0) {
    throw new Error('Invoice not found');
  }

  // Log audit
  await auditService.logAction(userId, 'invoice.mark_paid', 'invoice', {
    companyId,
    entityId: invoiceId,
  });

  return await getInvoiceById(invoiceId, companyId);
};

// Cancel invoice
export const cancelInvoice = async (
  invoiceId: string,
  companyId: string,
  userId: string
): Promise<Invoice> => {
  const result = await query(
    `UPDATE invoices
     SET status = 'cancelled'
     WHERE id = $1 AND company_id = $2 AND status IN ('draft', 'sent')
     RETURNING *`,
    [invoiceId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Invoice not found or cannot be cancelled');
  }

  // Log audit
  await auditService.logAction(userId, 'invoice.cancel', 'invoice', {
    companyId,
    entityId: invoiceId
  });

  return await getInvoiceById(invoiceId, companyId);
};

// Delete invoice (only draft)
export const deleteInvoice = async (
  invoiceId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  const result = await query(
    'DELETE FROM invoices WHERE id = $1 AND company_id = $2 AND status = \'draft\' RETURNING id',
    [invoiceId, companyId]
  );

  if (result.rows.length === 0) {
    throw new Error('Invoice not found or cannot be deleted');
  }

  // Log audit
  await auditService.logAction(userId, 'invoice.delete', 'invoice', {
    companyId,
    entityId: invoiceId
  });
};

// Get invoice statistics
export const getInvoiceStats = async (companyId: string): Promise<InvoiceStats> => {
  const result = await query(
    `SELECT
      COUNT(*) as total_invoices,
      SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END) as draft_invoices,
      SUM(CASE WHEN status = 'sent' THEN 1 ELSE 0 END) as sent_invoices,
      SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END) as paid_invoices,
      SUM(CASE WHEN status = 'overdue' THEN 1 ELSE 0 END) as overdue_invoices,
      SUM(CASE WHEN status IN ('sent', 'overdue') THEN total_amount - paid_amount ELSE 0 END) as total_outstanding,
      SUM(CASE WHEN status = 'paid' THEN paid_amount ELSE 0 END) as total_paid
     FROM invoices
     WHERE company_id = $1`,
    [companyId]
  );

  const stats = result.rows[0];

  return {
    total_invoices: parseInt(stats.total_invoices),
    draft_invoices: parseInt(stats.draft_invoices),
    sent_invoices: parseInt(stats.sent_invoices),
    paid_invoices: parseInt(stats.paid_invoices),
    overdue_invoices: parseInt(stats.overdue_invoices),
    total_outstanding: parseFloat(stats.total_outstanding) || 0,
    total_paid: parseFloat(stats.total_paid) || 0
  };
};
