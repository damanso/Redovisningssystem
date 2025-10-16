import { query } from '../config/database';

export interface DashboardStats {
  revenue_this_month: number;
  unpaid_invoices: {
    count: number;
    total: number;
  };
  overdue_invoices: {
    count: number;
  };
  recent_invoices: any[];
  monthly_revenue: Array<{
    month: string;
    revenue: number;
  }>;
  pending_receipts: number;
  total_customers: number;
  total_suppliers: number;
}

/**
 * Get comprehensive dashboard statistics
 */
export const getDashboardStats = async (companyId: string): Promise<DashboardStats> => {
  // Total revenue this month
  const revenueResult = await query(
    `SELECT COALESCE(SUM(total_amount), 0) as total
     FROM invoices
     WHERE company_id = $1
     AND status != 'cancelled'
     AND EXTRACT(MONTH FROM invoice_date) = EXTRACT(MONTH FROM CURRENT_DATE)
     AND EXTRACT(YEAR FROM invoice_date) = EXTRACT(YEAR FROM CURRENT_DATE)`,
    [companyId]
  );

  // Unpaid invoices
  const unpaidResult = await query(
    `SELECT
       COUNT(*)::int as count,
       COALESCE(SUM(total_amount - COALESCE(paid_amount, 0)), 0) as total
     FROM invoices
     WHERE company_id = $1
     AND status IN ('sent', 'overdue')
     AND COALESCE(paid_amount, 0) < total_amount`,
    [companyId]
  );

  // Overdue invoices
  const overdueResult = await query(
    `SELECT COUNT(*)::int as count
     FROM invoices
     WHERE company_id = $1
     AND status = 'overdue'`,
    [companyId]
  );

  // Recent invoices
  const recentInvoices = await query(
    `SELECT i.*, c.name as customer_name
     FROM invoices i
     LEFT JOIN customers c ON i.customer_id = c.id
     WHERE i.company_id = $1
     ORDER BY i.created_at DESC
     LIMIT 5`,
    [companyId]
  );

  // Monthly revenue (last 12 months)
  const monthlyRevenue = await query(
    `SELECT
      TO_CHAR(invoice_date, 'YYYY-MM') as month,
      COALESCE(SUM(total_amount), 0) as revenue
     FROM invoices
     WHERE company_id = $1
     AND status != 'cancelled'
     AND invoice_date >= CURRENT_DATE - INTERVAL '12 months'
     GROUP BY TO_CHAR(invoice_date, 'YYYY-MM')
     ORDER BY month`,
    [companyId]
  );

  // Pending receipts (not yet processed/booked)
  const pendingReceiptsResult = await query(
    `SELECT COUNT(*)::int as count
     FROM receipts
     WHERE company_id = $1
     AND status = 'pending'`,
    [companyId]
  );

  // Total customers
  const customersResult = await query(
    `SELECT COUNT(*)::int as count
     FROM customers
     WHERE company_id = $1
     AND is_active = true`,
    [companyId]
  );

  // Total suppliers
  const suppliersResult = await query(
    `SELECT COUNT(*)::int as count
     FROM suppliers
     WHERE company_id = $1
     AND is_active = true`,
    [companyId]
  );

  return {
    revenue_this_month: parseFloat(revenueResult.rows[0]?.total || 0),
    unpaid_invoices: {
      count: parseInt(unpaidResult.rows[0]?.count || 0),
      total: parseFloat(unpaidResult.rows[0]?.total || 0)
    },
    overdue_invoices: {
      count: parseInt(overdueResult.rows[0]?.count || 0)
    },
    recent_invoices: recentInvoices.rows,
    monthly_revenue: monthlyRevenue.rows.map(row => ({
      month: row.month,
      revenue: parseFloat(row.revenue)
    })),
    pending_receipts: parseInt(pendingReceiptsResult.rows[0]?.count || 0),
    total_customers: parseInt(customersResult.rows[0]?.count || 0),
    total_suppliers: parseInt(suppliersResult.rows[0]?.count || 0)
  };
};

/**
 * Get quick actions summary for dashboard
 */
export const getQuickActions = async (companyId: string) => {
  // Draft invoices that can be sent
  const draftInvoices = await query(
    `SELECT COUNT(*)::int as count
     FROM invoices
     WHERE company_id = $1 AND status = 'draft'`,
    [companyId]
  );

  // Pending receipts to process
  const pendingReceipts = await query(
    `SELECT COUNT(*)::int as count
     FROM receipts
     WHERE company_id = $1 AND status = 'pending'`,
    [companyId]
  );

  // Overdue invoices requiring attention
  const overdueInvoices = await query(
    `SELECT COUNT(*)::int as count
     FROM invoices
     WHERE company_id = $1 AND status = 'overdue'`,
    [companyId]
  );

  return {
    draft_invoices: parseInt(draftInvoices.rows[0]?.count || 0),
    pending_receipts: parseInt(pendingReceipts.rows[0]?.count || 0),
    overdue_invoices: parseInt(overdueInvoices.rows[0]?.count || 0)
  };
};
