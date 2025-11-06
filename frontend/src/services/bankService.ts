import axios from 'axios';
import {
  BankTransaction,
  TransactionImportResult,
  CashFlowSummary,
  CashFlowSettings,
  AvailableFundsCalculation,
  PlannedExpense,
  CreatePlannedExpenseDto,
  SalaryWithdrawal,
  CreateSalaryWithdrawalDto,
  ExpenseReimbursement,
  CreateExpenseReimbursementDto
} from '../types/bank.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

// ==================== Bank Transactions ====================

export const uploadTransactionFile = async (
  companyId: string,
  file: File,
  fileType: 'csv' | 'excel',
  bankName?: string
): Promise<TransactionImportResult> => {
  const formData = new FormData();
  formData.append('file', file);
  formData.append('company_id', companyId);
  formData.append('file_type', fileType);
  if (bankName) {
    formData.append('bank_name', bankName);
  }

  const response = await axios.post(
    `${API_URL}/bank-transactions/upload`,
    formData,
    {
      headers: {
        ...getAuthHeader(),
        'Content-Type': 'multipart/form-data'
      }
    }
  );
  return response.data;
};

export const getBankTransactions = async (
  companyId: string,
  filters?: {
    start_date?: string;
    end_date?: string;
    transaction_type?: string;
    status?: string;
    category?: string;
    search?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ transactions: BankTransaction[]; total: number; duplicates: BankTransaction[] }> => {
  const response = await axios.get(`${API_URL}/bank-transactions`, {
    params: { company_id: companyId, ...filters },
    headers: getAuthHeader()
  });
  return response.data;
};

export const getBankTransactionById = async (
  companyId: string,
  transactionId: string
): Promise<BankTransaction> => {
  const response = await axios.get(`${API_URL}/bank-transactions/${transactionId}`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
  return response.data;
};

export const linkTransactionToInvoice = async (
  transactionId: string,
  invoiceId: string
): Promise<void> => {
  await axios.post(
    `${API_URL}/bank-transactions/${transactionId}/link-invoice`,
    { invoice_id: invoiceId },
    { headers: getAuthHeader() }
  );
};

export const linkTransactionToReceipt = async (
  transactionId: string,
  receiptId: string
): Promise<void> => {
  await axios.post(
    `${API_URL}/bank-transactions/${transactionId}/link-receipt`,
    { receipt_id: receiptId },
    { headers: getAuthHeader() }
  );
};

export const ignoreTransaction = async (transactionId: string): Promise<void> => {
  await axios.post(
    `${API_URL}/bank-transactions/${transactionId}/ignore`,
    {},
    { headers: getAuthHeader() }
  );
};

export const deleteTransaction = async (companyId: string, transactionId: string): Promise<void> => {
  await axios.delete(`${API_URL}/bank-transactions/${transactionId}`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
};

// ==================== Cash Flow ====================

export const getCashFlowSummary = async (companyId: string): Promise<CashFlowSummary> => {
  const response = await axios.get(`${API_URL}/cash-flow/summary`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
  return response.data;
};

export const calculateAvailableFunds = async (
  companyId: string,
  excludeSalaryAmount?: number,
  excludeExpenseAmount?: number,
  planningDays?: number
): Promise<AvailableFundsCalculation> => {
  const response = await axios.post(
    `${API_URL}/cash-flow/calculate-available`,
    {
      company_id: companyId,
      exclude_salary_amount: excludeSalaryAmount,
      exclude_expense_amount: excludeExpenseAmount,
      planning_days: planningDays
    },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const getCashFlowSettings = async (companyId: string): Promise<CashFlowSettings> => {
  const response = await axios.get(`${API_URL}/cash-flow/settings`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
  return response.data;
};

export const updateCashFlowSettings = async (
  companyId: string,
  settings: Partial<CashFlowSettings>
): Promise<CashFlowSettings> => {
  const response = await axios.put(
    `${API_URL}/cash-flow/settings`,
    { company_id: companyId, ...settings },
    { headers: getAuthHeader() }
  );
  return response.data;
};

// ==================== Planned Expenses ====================

export const getPlannedExpenses = async (
  companyId: string,
  status?: string
): Promise<PlannedExpense[]> => {
  const response = await axios.get(`${API_URL}/cash-flow/planned-expenses`, {
    params: { company_id: companyId, status },
    headers: getAuthHeader()
  });
  return response.data;
};

export const createPlannedExpense = async (
  companyId: string,
  data: CreatePlannedExpenseDto
): Promise<PlannedExpense> => {
  const response = await axios.post(
    `${API_URL}/cash-flow/planned-expenses`,
    { company_id: companyId, ...data },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const updatePlannedExpense = async (
  companyId: string,
  expenseId: string,
  data: Partial<CreatePlannedExpenseDto>
): Promise<PlannedExpense> => {
  const response = await axios.put(
    `${API_URL}/cash-flow/planned-expenses/${expenseId}`,
    { company_id: companyId, ...data },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const deletePlannedExpense = async (companyId: string, expenseId: string): Promise<void> => {
  await axios.delete(`${API_URL}/cash-flow/planned-expenses/${expenseId}`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
};

// ==================== Salary Withdrawals ====================

export const getSalaryWithdrawals = async (
  companyId: string,
  status?: string
): Promise<SalaryWithdrawal[]> => {
  const response = await axios.get(`${API_URL}/salary-withdrawals`, {
    params: { company_id: companyId, status },
    headers: getAuthHeader()
  });
  return response.data;
};

export const getMySalaryWithdrawals = async (companyId: string): Promise<SalaryWithdrawal[]> => {
  const response = await axios.get(`${API_URL}/salary-withdrawals/my-withdrawals`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
  return response.data;
};

export const createSalaryWithdrawal = async (
  companyId: string,
  data: CreateSalaryWithdrawalDto
): Promise<SalaryWithdrawal> => {
  const response = await axios.post(
    `${API_URL}/salary-withdrawals`,
    { company_id: companyId, ...data },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const approveSalaryWithdrawal = async (
  companyId: string,
  withdrawalId: string,
  approvedAmount: number,
  notes?: string
): Promise<SalaryWithdrawal> => {
  const response = await axios.post(
    `${API_URL}/salary-withdrawals/${withdrawalId}/approve`,
    { company_id: companyId, approved_amount: approvedAmount, notes },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const rejectSalaryWithdrawal = async (
  companyId: string,
  withdrawalId: string,
  rejectionReason: string
): Promise<SalaryWithdrawal> => {
  const response = await axios.post(
    `${API_URL}/salary-withdrawals/${withdrawalId}/reject`,
    { company_id: companyId, rejection_reason: rejectionReason },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const cancelSalaryWithdrawal = async (
  companyId: string,
  withdrawalId: string
): Promise<SalaryWithdrawal> => {
  const response = await axios.post(
    `${API_URL}/salary-withdrawals/${withdrawalId}/cancel`,
    { company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};

// ==================== Expense Reimbursements ====================

export const getExpenseReimbursements = async (
  companyId: string,
  status?: string
): Promise<ExpenseReimbursement[]> => {
  const response = await axios.get(`${API_URL}/expense-reimbursements`, {
    params: { company_id: companyId, status },
    headers: getAuthHeader()
  });
  return response.data;
};

export const getMyExpenseReimbursements = async (
  companyId: string
): Promise<ExpenseReimbursement[]> => {
  const response = await axios.get(`${API_URL}/expense-reimbursements/my-reimbursements`, {
    params: { company_id: companyId },
    headers: getAuthHeader()
  });
  return response.data;
};

export const createExpenseReimbursement = async (
  companyId: string,
  data: CreateExpenseReimbursementDto
): Promise<ExpenseReimbursement> => {
  const response = await axios.post(
    `${API_URL}/expense-reimbursements`,
    { company_id: companyId, ...data },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const approveExpenseReimbursement = async (
  companyId: string,
  reimbursementId: string,
  approvedAmount: number,
  notes?: string
): Promise<ExpenseReimbursement> => {
  const response = await axios.post(
    `${API_URL}/expense-reimbursements/${reimbursementId}/approve`,
    { company_id: companyId, approved_amount: approvedAmount, notes },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const rejectExpenseReimbursement = async (
  companyId: string,
  reimbursementId: string,
  rejectionReason: string
): Promise<ExpenseReimbursement> => {
  const response = await axios.post(
    `${API_URL}/expense-reimbursements/${reimbursementId}/reject`,
    { company_id: companyId, rejection_reason: rejectionReason },
    { headers: getAuthHeader() }
  );
  return response.data;
};

export const cancelExpenseReimbursement = async (
  companyId: string,
  reimbursementId: string
): Promise<ExpenseReimbursement> => {
  const response = await axios.post(
    `${API_URL}/expense-reimbursements/${reimbursementId}/cancel`,
    { company_id: companyId },
    { headers: getAuthHeader() }
  );
  return response.data;
};
