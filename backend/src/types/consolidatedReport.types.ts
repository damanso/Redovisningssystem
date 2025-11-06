/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Types
 */

export type ReportType =
  | 'profit_loss'
  | 'balance_sheet'
  | 'cash_flow'
  | 'custom';

export interface ConsolidatedReportConfig {
  id: string;
  user_id: string;
  name: string;
  description?: string;
  company_ids: string[]; // JSON array
  group_ids?: string[]; // JSON array
  report_type: ReportType;
  date_range_start?: Date;
  date_range_end?: Date;
  currency: string;
  options?: Record<string, any>; // Flexible options
  created_at: Date;
  updated_at: Date;
}

export interface CreateConsolidatedReportConfigDto {
  name: string;
  description?: string;
  company_ids: string[];
  group_ids?: string[];
  report_type: ReportType;
  date_range_start?: Date | string;
  date_range_end?: Date | string;
  currency?: string;
  options?: Record<string, any>;
}

export interface UpdateConsolidatedReportConfigDto {
  name?: string;
  description?: string;
  company_ids?: string[];
  group_ids?: string[];
  report_type?: ReportType;
  date_range_start?: Date | string;
  date_range_end?: Date | string;
  currency?: string;
  options?: Record<string, any>;
}

// Report Data Structures
export interface CompanyReportData {
  company_id: string;
  company_name: string;
  data: any; // Flexible structure depending on report type
}

export interface ConsolidatedReportData {
  report_type: ReportType;
  date_range_start: Date;
  date_range_end: Date;
  currency: string;
  companies: CompanyReportData[];
  consolidated_totals: Record<string, number>;
  generated_at: Date;
}

// Specific report types
export interface ProfitLossData {
  revenue: number;
  cost_of_goods_sold: number;
  gross_profit: number;
  operating_expenses: number;
  operating_income: number;
  net_income: number;
}

export interface BalanceSheetData {
  assets: {
    current_assets: number;
    fixed_assets: number;
    total_assets: number;
  };
  liabilities: {
    current_liabilities: number;
    long_term_liabilities: number;
    total_liabilities: number;
  };
  equity: {
    share_capital: number;
    retained_earnings: number;
    total_equity: number;
  };
}

export interface CashFlowData {
  operating_activities: number;
  investing_activities: number;
  financing_activities: number;
  net_cash_flow: number;
  beginning_cash: number;
  ending_cash: number;
}
