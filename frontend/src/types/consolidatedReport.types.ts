/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Types (Frontend)
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
  company_ids: string[];
  group_ids?: string[];
  report_type: ReportType;
  date_range_start?: string;
  date_range_end?: string;
  currency: string;
  options?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface CreateConsolidatedReportConfigDto {
  name: string;
  description?: string;
  company_ids: string[];
  group_ids?: string[];
  report_type: ReportType;
  date_range_start?: string;
  date_range_end?: string;
  currency?: string;
  options?: Record<string, any>;
}

export interface UpdateConsolidatedReportConfigDto {
  name?: string;
  description?: string;
  company_ids?: string[];
  group_ids?: string[];
  report_type?: ReportType;
  date_range_start?: string;
  date_range_end?: string;
  currency?: string;
  options?: Record<string, any>;
}

export interface CompanyReportData {
  company_id: string;
  company_name: string;
  data: any;
}

export interface ConsolidatedReportData {
  report_type: ReportType;
  date_range_start: string;
  date_range_end: string;
  currency: string;
  companies: CompanyReportData[];
  consolidated_totals: Record<string, number>;
  generated_at: string;
}
