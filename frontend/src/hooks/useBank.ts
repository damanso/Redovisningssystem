/**
 * Bank Integration Hooks
 * React Query hooks for bank operations
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import axios from 'axios';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

// Types
export interface BankConnection {
  id: string;
  company_id: string;
  provider: string;
  bank_name?: string;
  status: 'active' | 'expired' | 'revoked' | 'error';
  last_sync_at?: string;
  created_at: string;
}

export interface BankAccount {
  id: string;
  bank_connection_id: string;
  account_name: string;
  account_number?: string;
  clearing_number?: string;
  balance?: number;
  currency: string;
  is_active: boolean;
  last_synced_at?: string;
  unmatched_count?: number;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  transaction_date: string;
  amount: number;
  description?: string;
  counterparty_name?: string;
  status: 'unmatched' | 'matched' | 'reconciled' | 'ignored';
  matches?: TransactionMatch[];
}

export interface TransactionMatch {
  id: string;
  match_type: 'invoice' | 'receipt';
  match_id: string;
  matched_amount: number;
  confidence_score?: number;
}

export interface MatchCandidate {
  invoice_id?: string;
  receipt_id?: string;
  type: 'invoice' | 'receipt';
  amount: number;
  date: string;
  confidence_score: number;
  match_reasons: string[];
}

// Get auth token
const getAuthToken = () => localStorage.getItem('token');

// API calls
const bankApi = {
  // Connections
  getConnections: async (companyId: string) => {
    const { data } = await axios.get(`${API_URL}/banks/connections`, {
      params: { company_id: companyId },
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    return data;
  },

  createConnection: async (payload: any) => {
    const { data } = await axios.post(`${API_URL}/banks/connections`, payload, {
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    return data;
  },

  deleteConnection: async (connectionId: string, companyId: string) => {
    await axios.delete(`${API_URL}/banks/connections/${connectionId}`, {
      params: { company_id: companyId },
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
  },

  // Accounts
  getAccounts: async (connectionId: string, companyId: string) => {
    const { data } = await axios.get(`${API_URL}/banks/connections/${connectionId}/accounts`, {
      params: { company_id: companyId },
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    return data;
  },

  syncAccount: async (accountId: string, companyId: string, options?: any) => {
    const { data } = await axios.post(
      `${API_URL}/banks/accounts/${accountId}/sync`,
      options || {},
      {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      }
    );
    return data;
  },

  // Transactions
  getTransactions: async (accountId: string, companyId: string, filters?: any) => {
    const { data } = await axios.get(`${API_URL}/banks/accounts/${accountId}/transactions`, {
      params: { company_id: companyId, ...filters },
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    return data;
  },

  getMatchCandidates: async (transactionId: string, companyId: string) => {
    const { data } = await axios.get(`${API_URL}/banks/transactions/${transactionId}/match-candidates`, {
      params: { company_id: companyId },
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    return data;
  },

  matchTransaction: async (transactionId: string, companyId: string, matchData: any) => {
    const { data } = await axios.post(
      `${API_URL}/banks/transactions/${transactionId}/match`,
      matchData,
      {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      }
    );
    return data;
  },

  reconcileTransaction: async (transactionId: string, companyId: string, options?: any) => {
    const { data } = await axios.post(
      `${API_URL}/banks/transactions/${transactionId}/reconcile`,
      options || {},
      {
        params: { company_id: companyId },
        headers: { Authorization: `Bearer ${getAuthToken()}` },
      }
    );
    return data;
  },

  getReconciliationSummary: async (companyId: string) => {
    const { data } = await axios.get(`${API_URL}/banks/reconciliation/summary`, {
      params: { company_id: companyId },
      headers: { Authorization: `Bearer ${getAuthToken()}` },
    });
    return data;
  },
};

// Hooks

// Bank Connections
export const useBankConnections = (companyId: string) => {
  return useQuery({
    queryKey: ['bankConnections', companyId],
    queryFn: () => bankApi.getConnections(companyId),
    enabled: !!companyId,
  });
};

export const useCreateBankConnection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: bankApi.createConnection,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bankConnections', variables.company_id] });
    },
  });
};

export const useDeleteBankConnection = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ connectionId, companyId }: { connectionId: string; companyId: string }) =>
      bankApi.deleteConnection(connectionId, companyId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bankConnections', variables.companyId] });
    },
  });
};

// Bank Accounts
export const useBankAccounts = (connectionId: string, companyId: string) => {
  return useQuery({
    queryKey: ['bankAccounts', connectionId, companyId],
    queryFn: () => bankApi.getAccounts(connectionId, companyId),
    enabled: !!connectionId && !!companyId,
  });
};

export const useSyncBankAccount = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ accountId, companyId, options }: any) =>
      bankApi.syncAccount(accountId, companyId, options),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['bankAccounts'] });
      queryClient.invalidateQueries({ queryKey: ['bankTransactions', variables.accountId] });
    },
  });
};

// Bank Transactions
export const useBankTransactions = (accountId: string, companyId: string, filters?: any) => {
  return useQuery({
    queryKey: ['bankTransactions', accountId, companyId, filters],
    queryFn: () => bankApi.getTransactions(accountId, companyId, filters),
    enabled: !!accountId && !!companyId,
  });
};

export const useMatchCandidates = (transactionId: string, companyId: string) => {
  return useQuery({
    queryKey: ['matchCandidates', transactionId, companyId],
    queryFn: () => bankApi.getMatchCandidates(transactionId, companyId),
    enabled: !!transactionId && !!companyId,
  });
};

export const useMatchTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, companyId, matchData }: any) =>
      bankApi.matchTransaction(transactionId, companyId, matchData),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bankTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliationSummary'] });
    },
  });
};

export const useReconcileTransaction = () => {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ transactionId, companyId, options }: any) =>
      bankApi.reconcileTransaction(transactionId, companyId, options),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['bankTransactions'] });
      queryClient.invalidateQueries({ queryKey: ['reconciliationSummary'] });
    },
  });
};

export const useReconciliationSummary = (companyId: string) => {
  return useQuery({
    queryKey: ['reconciliationSummary', companyId],
    queryFn: () => bankApi.getReconciliationSummary(companyId),
    enabled: !!companyId,
  });
};
