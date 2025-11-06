import { Pool } from 'pg';
import crypto from 'crypto';
import { parse } from 'csv-parse/sync';
import * as XLSX from 'xlsx';
import {
  BankTransaction,
  CreateBankTransactionDto,
  ImportTransactionsDto,
  BankTransactionFilters,
  BankTransactionListResponse,
  TransactionImportResult,
  ParsedTransaction,
  TransactionFileUpload
} from '../types/bank.types.js';

export class BankTransactionService {
  constructor(private pool: Pool) {}

  /**
   * Generate a hash for duplicate detection
   */
  private generateTransactionHash(
    companyId: string,
    transactionDate: string,
    amount: number,
    description: string,
    reference?: string
  ): string {
    const data = `${companyId}|${transactionDate}|${amount}|${description}|${reference || ''}`;
    return crypto.createHash('sha256').update(data).digest('hex');
  }

  /**
   * Check if transaction is duplicate
   */
  async checkDuplicate(
    companyId: string,
    transactionDate: string,
    amount: number,
    description: string,
    reference?: string
  ): Promise<BankTransaction | null> {
    const hash = this.generateTransactionHash(companyId, transactionDate, amount, description, reference);

    const result = await this.pool.query<BankTransaction>(
      `SELECT * FROM bank_transactions
       WHERE company_id = $1 AND hash = $2
       LIMIT 1`,
      [companyId, hash]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Create a single bank transaction
   */
  async createTransaction(
    companyId: string,
    userId: string,
    dto: CreateBankTransactionDto,
    batchId?: string
  ): Promise<BankTransaction> {
    const hash = this.generateTransactionHash(
      companyId,
      dto.transaction_date,
      dto.amount,
      dto.description,
      dto.reference_number
    );

    // Check for duplicates
    const duplicate = await this.checkDuplicate(
      companyId,
      dto.transaction_date,
      dto.amount,
      dto.description,
      dto.reference_number
    );

    const isDuplicate = !!duplicate;
    const status = isDuplicate ? 'duplicate' : 'unmatched';

    const result = await this.pool.query<BankTransaction>(
      `INSERT INTO bank_transactions (
        company_id, transaction_date, booking_date, transaction_id, reference_number,
        transaction_type, description, category, amount, currency, balance_after,
        import_source, import_batch_id, file_name, hash,
        is_duplicate, duplicate_of_id, status, created_by
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19
      )
      RETURNING *`,
      [
        companyId,
        dto.transaction_date,
        dto.booking_date || null,
        dto.transaction_id || null,
        dto.reference_number || null,
        dto.transaction_type,
        dto.description,
        dto.category || null,
        dto.amount,
        dto.currency || 'SEK',
        dto.balance_after || null,
        dto.import_source,
        batchId || null,
        dto.file_name || null,
        hash,
        isDuplicate,
        duplicate ? duplicate.id : null,
        status,
        userId
      ]
    );

    return result.rows[0];
  }

  /**
   * Import multiple transactions
   */
  async importTransactions(
    companyId: string,
    userId: string,
    dto: ImportTransactionsDto
  ): Promise<TransactionImportResult> {
    let importedCount = 0;
    let duplicateCount = 0;
    let errorCount = 0;
    const duplicates: BankTransaction[] = [];
    const errors: Array<{ row: number; error: string; data?: any }> = [];

    for (let i = 0; i < dto.transactions.length; i++) {
      try {
        const transaction = await this.createTransaction(
          companyId,
          userId,
          dto.transactions[i],
          dto.import_batch_id
        );

        if (transaction.is_duplicate) {
          duplicateCount++;
          duplicates.push(transaction);
        } else {
          importedCount++;
        }
      } catch (error) {
        errorCount++;
        errors.push({
          row: i + 1,
          error: error instanceof Error ? error.message : 'Unknown error',
          data: dto.transactions[i]
        });
      }
    }

    return {
      success: errorCount === 0,
      imported_count: importedCount,
      duplicate_count: duplicateCount,
      error_count: errorCount,
      import_batch_id: dto.import_batch_id,
      duplicates,
      errors
    };
  }

  /**
   * Parse CSV file (Generic format and Swedish banks)
   */
  private parseCSV(buffer: Buffer, bankName?: string): ParsedTransaction[] {
    const content = buffer.toString('utf-8');

    // Try to detect encoding (Swedish banks may use different encodings)
    let parsedData: any[];
    try {
      parsedData = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: ';', // Swedish banks often use semicolon
        relax_column_count: true
      });
    } catch (error) {
      // Try with comma delimiter
      parsedData = parse(content, {
        columns: true,
        skip_empty_lines: true,
        trim: true,
        delimiter: ',',
        relax_column_count: true
      });
    }

    // Map based on bank format
    return parsedData.map(row => this.mapRowToTransaction(row, bankName));
  }

  /**
   * Parse Excel file
   */
  private parseExcel(buffer: Buffer, bankName?: string): ParsedTransaction[] {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    return data.map(row => this.mapRowToTransaction(row, bankName));
  }

  /**
   * Map row to transaction based on bank format
   */
  private mapRowToTransaction(row: any, bankName?: string): ParsedTransaction {
    // Generic mapping (try common column names)
    let transactionDate = '';
    let bookingDate = '';
    let description = '';
    let amount = 0;
    let balanceAfter: number | undefined;
    let referenceNumber = '';
    let transactionId = '';

    // Try different common column names
    const dateFields = ['Datum', 'Date', 'Transaction Date', 'Transaktionsdatum', 'Bokföringsdatum'];
    const bookingDateFields = ['Bokföringsdatum', 'Booking Date', 'Value Date', 'Valutadatum'];
    const descriptionFields = ['Beskrivning', 'Description', 'Text', 'Meddelande', 'Message'];
    const amountFields = ['Belopp', 'Amount', 'Summa', 'Value'];
    const balanceFields = ['Saldo', 'Balance', 'Account Balance'];
    const referenceFields = ['Referens', 'Reference', 'OCR', 'Payment Reference'];

    // Find date
    for (const field of dateFields) {
      if (row[field]) {
        transactionDate = this.parseDate(row[field]);
        break;
      }
    }

    // Find booking date
    for (const field of bookingDateFields) {
      if (row[field]) {
        bookingDate = this.parseDate(row[field]);
        break;
      }
    }

    // Find description
    for (const field of descriptionFields) {
      if (row[field]) {
        description = String(row[field]).trim();
        break;
      }
    }

    // Find amount
    for (const field of amountFields) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
        amount = this.parseAmount(row[field]);
        break;
      }
    }

    // Find balance
    for (const field of balanceFields) {
      if (row[field] !== undefined && row[field] !== null && row[field] !== '') {
        balanceAfter = this.parseAmount(row[field]);
        break;
      }
    }

    // Find reference
    for (const field of referenceFields) {
      if (row[field]) {
        referenceNumber = String(row[field]).trim();
        break;
      }
    }

    return {
      transaction_date: transactionDate || new Date().toISOString().split('T')[0],
      booking_date: bookingDate || undefined,
      description: description || 'Unknown transaction',
      amount,
      balance_after: balanceAfter,
      reference_number: referenceNumber || undefined,
      transaction_id: transactionId || undefined,
      raw_data: row
    };
  }

  /**
   * Parse date string to YYYY-MM-DD format
   */
  private parseDate(dateStr: string): string {
    // Try different formats
    const formats = [
      /^(\d{4})-(\d{2})-(\d{2})$/, // YYYY-MM-DD
      /^(\d{2})\/(\d{2})\/(\d{4})$/, // DD/MM/YYYY
      /^(\d{2})-(\d{2})-(\d{4})$/, // DD-MM-YYYY
      /^(\d{4})(\d{2})(\d{2})$/, // YYYYMMDD
    ];

    for (const format of formats) {
      const match = String(dateStr).match(format);
      if (match) {
        if (format === formats[0] || format === formats[3]) {
          // Already in YYYY-MM-DD or YYYYMMDD
          return match[0].replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
        } else {
          // Convert DD/MM/YYYY or DD-MM-YYYY to YYYY-MM-DD
          return `${match[3]}-${match[2]}-${match[1]}`;
        }
      }
    }

    // Try to parse as Date object
    const date = new Date(dateStr);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }

    return new Date().toISOString().split('T')[0];
  }

  /**
   * Parse amount (handle Swedish number format: 1 234,56)
   */
  private parseAmount(amountStr: string | number): number {
    if (typeof amountStr === 'number') {
      return amountStr;
    }

    // Remove spaces and convert Swedish decimal separator
    const cleaned = String(amountStr)
      .replace(/\s/g, '')
      .replace(',', '.');

    return parseFloat(cleaned) || 0;
  }

  /**
   * Parse uploaded transaction file
   */
  async parseTransactionFile(
    file: Express.Multer.File,
    fileType: 'csv' | 'excel',
    bankName?: string
  ): Promise<ParsedTransaction[]> {
    if (fileType === 'csv') {
      return this.parseCSV(file.buffer, bankName);
    } else if (fileType === 'excel') {
      return this.parseExcel(file.buffer, bankName);
    }

    throw new Error('Unsupported file type');
  }

  /**
   * Get transactions with filters
   */
  async getTransactions(
    companyId: string,
    filters: BankTransactionFilters
  ): Promise<BankTransactionListResponse> {
    let query = `
      SELECT bt.*,
             i.invoice_number,
             r.receipt_date,
             u.name as created_by_name
      FROM bank_transactions bt
      LEFT JOIN invoices i ON bt.linked_invoice_id = i.id
      LEFT JOIN receipts r ON bt.linked_receipt_id = r.id
      LEFT JOIN users u ON bt.created_by = u.id
      WHERE bt.company_id = $1
    `;
    const params: any[] = [companyId];
    let paramIndex = 2;

    // Apply filters
    if (filters.start_date) {
      query += ` AND bt.transaction_date >= $${paramIndex}`;
      params.push(filters.start_date);
      paramIndex++;
    }

    if (filters.end_date) {
      query += ` AND bt.transaction_date <= $${paramIndex}`;
      params.push(filters.end_date);
      paramIndex++;
    }

    if (filters.transaction_type) {
      query += ` AND bt.transaction_type = $${paramIndex}`;
      params.push(filters.transaction_type);
      paramIndex++;
    }

    if (filters.status) {
      query += ` AND bt.status = $${paramIndex}`;
      params.push(filters.status);
      paramIndex++;
    }

    if (filters.category) {
      query += ` AND bt.category = $${paramIndex}`;
      params.push(filters.category);
      paramIndex++;
    }

    if (filters.search) {
      query += ` AND (bt.description ILIKE $${paramIndex} OR bt.reference_number ILIKE $${paramIndex})`;
      params.push(`%${filters.search}%`);
      paramIndex++;
    }

    // Count total
    const countQuery = query.replace('SELECT bt.*, i.invoice_number, r.receipt_date, u.name as created_by_name', 'SELECT COUNT(*) as total');
    const countResult = await this.pool.query(countQuery, params);
    const total = parseInt(countResult.rows[0].total);

    // Add sorting and pagination
    query += ` ORDER BY bt.transaction_date DESC, bt.created_at DESC`;

    const limit = filters.limit || 50;
    const offset = filters.offset || 0;
    query += ` LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`;
    params.push(limit, offset);

    const result = await this.pool.query<BankTransaction>(query, params);

    // Get duplicates separately
    const duplicatesResult = await this.pool.query<BankTransaction>(
      `SELECT * FROM bank_transactions
       WHERE company_id = $1 AND is_duplicate = true
       ORDER BY created_at DESC
       LIMIT 100`,
      [companyId]
    );

    return {
      transactions: result.rows,
      total,
      duplicates: duplicatesResult.rows
    };
  }

  /**
   * Get transaction by ID
   */
  async getTransactionById(companyId: string, transactionId: string): Promise<BankTransaction | null> {
    const result = await this.pool.query<BankTransaction>(
      `SELECT bt.*,
              i.invoice_number,
              r.receipt_date,
              u.name as created_by_name
       FROM bank_transactions bt
       LEFT JOIN invoices i ON bt.linked_invoice_id = i.id
       LEFT JOIN receipts r ON bt.linked_receipt_id = r.id
       LEFT JOIN users u ON bt.created_by = u.id
       WHERE bt.company_id = $1 AND bt.id = $2`,
      [companyId, transactionId]
    );

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Link transaction to invoice
   */
  async linkToInvoice(transactionId: string, invoiceId: string): Promise<void> {
    await this.pool.query(
      `UPDATE bank_transactions
       SET linked_invoice_id = $1, status = 'matched', is_reconciled = true
       WHERE id = $2`,
      [invoiceId, transactionId]
    );
  }

  /**
   * Link transaction to receipt
   */
  async linkToReceipt(transactionId: string, receiptId: string): Promise<void> {
    await this.pool.query(
      `UPDATE bank_transactions
       SET linked_receipt_id = $1, status = 'matched', is_reconciled = true
       WHERE id = $2`,
      [receiptId, transactionId]
    );
  }

  /**
   * Ignore transaction
   */
  async ignoreTransaction(transactionId: string): Promise<void> {
    await this.pool.query(
      `UPDATE bank_transactions
       SET status = 'ignored'
       WHERE id = $1`,
      [transactionId]
    );
  }

  /**
   * Delete transaction
   */
  async deleteTransaction(companyId: string, transactionId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM bank_transactions
       WHERE company_id = $1 AND id = $2`,
      [companyId, transactionId]
    );
  }
}
