/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transaction Hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as crossCompanyTransactionService from '../services/crossCompanyTransactionService';
import {
  CreateCrossCompanyTransactionDto,
  UpdateCrossCompanyTransactionDto,
  TransactionStatus
} from '../types/crossCompanyTransaction.types';

export const useCrossCompanyTransactions = (filters?: {
  company_id?: string;
  status?: TransactionStatus;
  from_date?: string;
  to_date?: string;
}) => {
  return useQuery({
    queryKey: ['crossCompanyTransactions', filters],
    queryFn: () => crossCompanyTransactionService.getCrossCompanyTransactions(filters),
    retry: 1,
  });
};

export const useCrossCompanyTransaction = (transactionId: string) => {
  return useQuery({
    queryKey: ['crossCompanyTransaction', transactionId],
    queryFn: () => crossCompanyTransactionService.getCrossCompanyTransactionById(transactionId),
    enabled: !!transactionId,
    retry: 1,
  });
};

export const useCreateCrossCompanyTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCrossCompanyTransactionDto) =>
      crossCompanyTransactionService.createCrossCompanyTransaction(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crossCompanyTransactions'] });
    },
  });
};

export const useUpdateCrossCompanyTransaction = (transactionId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateCrossCompanyTransactionDto) =>
      crossCompanyTransactionService.updateCrossCompanyTransaction(transactionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crossCompanyTransaction', transactionId] });
      queryClient.invalidateQueries({ queryKey: ['crossCompanyTransactions'] });
    },
  });
};

export const useReconcileTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionId: string) =>
      crossCompanyTransactionService.reconcileTransaction(transactionId),
    onSuccess: (_, transactionId) => {
      queryClient.invalidateQueries({ queryKey: ['crossCompanyTransaction', transactionId] });
      queryClient.invalidateQueries({ queryKey: ['crossCompanyTransactions'] });
    },
  });
};

export const useDeleteCrossCompanyTransaction = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (transactionId: string) =>
      crossCompanyTransactionService.deleteCrossCompanyTransaction(transactionId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crossCompanyTransactions'] });
    },
  });
};

export const useCompanyTransactionSummary = (
  companyId: string,
  dateRange?: { from_date?: string; to_date?: string }
) => {
  return useQuery({
    queryKey: ['companyTransactionSummary', companyId, dateRange],
    queryFn: () => crossCompanyTransactionService.getCompanyTransactionSummary(companyId, dateRange),
    enabled: !!companyId,
    retry: 1,
  });
};
