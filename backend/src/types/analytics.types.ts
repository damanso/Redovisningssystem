// Advanced Analytics Types
// Types for budgets, KPIs, and cash flow forecasting

// ============================================
// BUDGET TYPES
// ============================================

export type BudgetStatus = 'draft' | 'active' | 'closed' | 'archived';

export interface Budget {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: BudgetStatus;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  account_number: number;
  period_start: string;
  period_end: string;
  budgeted_amount: number;
  notes?: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetRevision {
  id: string;
  budget_id: string;
  revision_number: number;
  revised_by: string;
  revision_date: string;
  reason?: string;
  changes: Record<string, any>;
}

export interface BudgetVsActual {
  account_number: number;
  account_name: string;
  account_type: string;
  budgeted_amount: number;
  actual_amount: number;
  variance: number;
  variance_percentage: number;
}

export interface CreateBudgetRequest {
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status?: BudgetStatus;
}

export interface UpdateBudgetRequest {
  name?: string;
  description?: string;
  start_date?: string;
  end_date?: string;
  status?: BudgetStatus;
}

export interface CreateBudgetLineRequest {
  account_number: number;
  period_start: string;
  period_end: string;
  budgeted_amount: number;
  notes?: string;
}

// ============================================
// KPI TYPES
// ============================================

export type KPICategory = 'financial' | 'operational' | 'customer' | 'growth';
export type KPIUnit = 'currency' | 'percentage' | 'number' | 'ratio';
export type KPITargetOperator = 'greater_than' | 'less_than' | 'equals' | 'between';

export interface KPIDefinition {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description?: string;
  category: KPICategory;
  unit: KPIUnit;
  calculation_method?: string;
  target_value?: number;
  target_operator?: KPITargetOperator;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface KPIValue {
  id: string;
  kpi_definition_id: string;
  period_start: string;
  period_end: string;
  value: number;
  calculated_at: string;
  notes?: string;
  metadata: Record<string, any>;
}

export interface KPITarget {
  id: string;
  kpi_definition_id: string;
  period_start: string;
  period_end: string;
  target_value: number;
  notes?: string;
  created_at: string;
}

export interface KPIWithValue extends KPIDefinition {
  current_value?: number;
  target_value?: number;
  status?: 'on_target' | 'off_target' | 'no_data';
  trend?: 'up' | 'down' | 'stable';
}

export interface CreateKPIDefinitionRequest {
  code: string;
  name: string;
  description?: string;
  category: KPICategory;
  unit: KPIUnit;
  calculation_method?: string;
  target_value?: number;
  target_operator?: KPITargetOperator;
  is_active?: boolean;
}

export interface UpdateKPIDefinitionRequest {
  name?: string;
  description?: string;
  category?: KPICategory;
  unit?: KPIUnit;
  calculation_method?: string;
  target_value?: number;
  target_operator?: KPITargetOperator;
  is_active?: boolean;
}

export interface CreateKPIValueRequest {
  kpi_definition_id: string;
  period_start: string;
  period_end: string;
  value: number;
  notes?: string;
  metadata?: Record<string, any>;
}

// ============================================
// CASH FLOW FORECASTING TYPES
// ============================================

export type ForecastType = 'conservative' | 'realistic' | 'optimistic';
export type CashFlowCategory = 'receivables' | 'payables' | 'revenue' | 'expense' | 'other';
export type CashFlowSourceType = 'invoice' | 'receipt' | 'recurring' | 'manual';
export type PatternType = 'seasonal' | 'weekly' | 'monthly' | 'quarterly';

export interface CashFlowForecast {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  forecast_type: ForecastType;
  start_date: string;
  end_date: string;
  opening_balance: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CashFlowForecastLine {
  id: string;
  forecast_id: string;
  transaction_date: string;
  category: CashFlowCategory;
  description?: string;
  amount: number;
  confidence_level: number;
  source_type?: CashFlowSourceType;
  source_id?: string;
  is_recurring: boolean;
  notes?: string;
  created_at: string;
}

export interface CashFlowPattern {
  id: string;
  company_id: string;
  pattern_type: PatternType;
  category: CashFlowCategory;
  period_identifier: string;
  average_amount: number;
  std_deviation?: number;
  sample_size: number;
  last_calculated: string;
}

export interface CashFlowScenario {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  base_forecast_id?: string;
  assumptions: Record<string, any>;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CashFlowProjection {
  projection_date: string;
  inflows: number;
  outflows: number;
  net_flow: number;
  running_balance: number;
}

export interface CreateCashFlowForecastRequest {
  name: string;
  description?: string;
  forecast_type: ForecastType;
  start_date: string;
  end_date: string;
  opening_balance?: number;
}

export interface UpdateCashFlowForecastRequest {
  name?: string;
  description?: string;
  forecast_type?: ForecastType;
  start_date?: string;
  end_date?: string;
  opening_balance?: number;
}

export interface CreateCashFlowForecastLineRequest {
  transaction_date: string;
  category: CashFlowCategory;
  description?: string;
  amount: number;
  confidence_level?: number;
  source_type?: CashFlowSourceType;
  source_id?: string;
  is_recurring?: boolean;
  notes?: string;
}

// ============================================
// ANALYTICS SUMMARY TYPES
// ============================================

export interface AnalyticsSummary {
  budgets: {
    total: number;
    active: number;
    draft: number;
  };
  kpis: {
    total: number;
    on_target: number;
    off_target: number;
  };
  cash_flow: {
    current_balance: number;
    projected_30_days: number;
    projected_90_days: number;
  };
}

export interface PeriodComparison {
  current_period: {
    start_date: string;
    end_date: string;
    value: number;
  };
  previous_period: {
    start_date: string;
    end_date: string;
    value: number;
  };
  change: number;
  change_percentage: number;
}
