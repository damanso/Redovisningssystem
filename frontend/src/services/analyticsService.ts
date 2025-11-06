import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

// ============================================
// TYPES
// ============================================

export interface Budget {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status: 'draft' | 'active' | 'closed' | 'archived';
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface BudgetLine {
  id: string;
  budget_id: string;
  account_number: number;
  account_name?: string;
  account_type?: string;
  period_start: string;
  period_end: string;
  budgeted_amount: number;
  notes?: string;
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

export interface KPIDefinition {
  id: string;
  company_id: string;
  code: string;
  name: string;
  description?: string;
  category: 'financial' | 'operational' | 'customer' | 'growth';
  unit: 'currency' | 'percentage' | 'number' | 'ratio';
  calculation_method?: string;
  target_value?: number;
  target_operator?: 'greater_than' | 'less_than' | 'equals' | 'between';
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
}

export interface KPIWithValue extends KPIDefinition {
  current_value?: number;
  target_value?: number;
  status?: 'on_target' | 'off_target' | 'no_data';
  trend?: 'up' | 'down' | 'stable';
}

export interface CashFlowForecast {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  forecast_type: 'conservative' | 'realistic' | 'optimistic';
  start_date: string;
  end_date: string;
  opening_balance: number;
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

// ============================================
// BUDGET API
// ============================================

export const getBudgets = async () => {
  const response = await axios.get(`${API_URL}/budgets`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getBudgetById = async (id: string) => {
  const response = await axios.get(`${API_URL}/budgets/${id}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createBudget = async (data: {
  name: string;
  description?: string;
  start_date: string;
  end_date: string;
  status?: 'draft' | 'active' | 'closed' | 'archived';
}) => {
  const response = await axios.post(`${API_URL}/budgets`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateBudget = async (id: string, data: Partial<Budget>) => {
  const response = await axios.put(`${API_URL}/budgets/${id}`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const deleteBudget = async (id: string) => {
  await axios.delete(`${API_URL}/budgets/${id}`, {
    headers: getAuthHeader()
  });
};

export const getBudgetLines = async (budgetId: string) => {
  const response = await axios.get(`${API_URL}/budgets/${budgetId}/lines`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createBudgetLine = async (budgetId: string, data: {
  account_number: number;
  period_start: string;
  period_end: string;
  budgeted_amount: number;
  notes?: string;
}) => {
  const response = await axios.post(`${API_URL}/budgets/${budgetId}/lines`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getBudgetVsActual = async (budgetId: string, startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);

  const response = await axios.get(
    `${API_URL}/budgets/${budgetId}/vs-actual?${params.toString()}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getBudgetSummary = async (budgetId: string) => {
  const response = await axios.get(`${API_URL}/budgets/${budgetId}/summary`, {
    headers: getAuthHeader()
  });
  return response.data;
};

// ============================================
// KPI API
// ============================================

export const getKPIDefinitions = async () => {
  const response = await axios.get(`${API_URL}/kpis/definitions`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getKPIDefinitionById = async (id: string) => {
  const response = await axios.get(`${API_URL}/kpis/definitions/${id}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createKPIDefinition = async (data: {
  code: string;
  name: string;
  description?: string;
  category: 'financial' | 'operational' | 'customer' | 'growth';
  unit: 'currency' | 'percentage' | 'number' | 'ratio';
  target_value?: number;
}) => {
  const response = await axios.post(`${API_URL}/kpis/definitions`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getKPIDashboard = async (startDate?: string, endDate?: string) => {
  const params = new URLSearchParams();
  if (startDate) params.append('start_date', startDate);
  if (endDate) params.append('end_date', endDate);

  const response = await axios.get(
    `${API_URL}/kpis/dashboard?${params.toString()}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const calculateAndSaveKPI = async (code: string, startDate: string, endDate: string) => {
  const response = await axios.post(
    `${API_URL}/kpis/calculate/${code}`,
    { start_date: startDate, end_date: endDate },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const calculateAllKPIs = async (startDate: string, endDate: string) => {
  const response = await axios.post(
    `${API_URL}/kpis/calculate-all`,
    { start_date: startDate, end_date: endDate },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getKPITrend = async (kpiId: string, periods: number = 12) => {
  const response = await axios.get(
    `${API_URL}/kpis/definitions/${kpiId}/trend?periods=${periods}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

// ============================================
// CASH FLOW API
// ============================================

export const getCashFlowForecasts = async () => {
  const response = await axios.get(`${API_URL}/cash-flow/forecasts`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCashFlowForecastById = async (id: string) => {
  const response = await axios.get(`${API_URL}/cash-flow/forecasts/${id}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const createCashFlowForecast = async (data: {
  name: string;
  description?: string;
  forecast_type: 'conservative' | 'realistic' | 'optimistic';
  start_date: string;
  end_date: string;
  opening_balance?: number;
}) => {
  const response = await axios.post(`${API_URL}/cash-flow/forecasts`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCashFlowProjection = async (forecastId: string) => {
  const response = await axios.get(`${API_URL}/cash-flow/forecasts/${forecastId}/projection`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getCashFlowSummary = async (forecastId: string) => {
  const response = await axios.get(`${API_URL}/cash-flow/forecasts/${forecastId}/summary`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const getQuickProjection = async (days: number = 30) => {
  const response = await axios.get(`${API_URL}/cash-flow/quick-projection?days=${days}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

export const regenerateForecast = async (forecastId: string) => {
  const response = await axios.post(
    `${API_URL}/cash-flow/forecasts/${forecastId}/regenerate`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const calculatePaymentPatterns = async () => {
  const response = await axios.post(
    `${API_URL}/cash-flow/patterns/calculate`,
    {},
    { headers: getAuthHeader() }
  );
  return response.data;
};
