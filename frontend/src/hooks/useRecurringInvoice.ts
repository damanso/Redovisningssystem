import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as recurringInvoiceService from '../services/recurringInvoiceService';
import type { CreateRecurringInvoiceDto, UpdateRecurringInvoiceDto, RecurringStatus } from '../types/recurringInvoice.types';

export const useRecurringInvoices = (filters?: {
  customer_id?: string;
  status?: RecurringStatus;
  search?: string;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: ['recurring-invoices', filters],
    queryFn: () => recurringInvoiceService.getRecurringInvoices(filters)
  });
};

export const useRecurringInvoice = (id: string) => {
  return useQuery({
    queryKey: ['recurring-invoice', id],
    queryFn: () => recurringInvoiceService.getRecurringInvoiceById(id),
    enabled: !!id
  });
};

export const useRecurringInvoiceHistory = (id: string) => {
  return useQuery({
    queryKey: ['recurring-invoice-history', id],
    queryFn: () => recurringInvoiceService.getRecurringInvoiceHistory(id),
    enabled: !!id
  });
};

export const useRecurringInvoiceStats = () => {
  return useQuery({
    queryKey: ['recurring-invoice-stats'],
    queryFn: recurringInvoiceService.getRecurringInvoiceStats
  });
};

export const useCreateRecurringInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: recurringInvoiceService.createRecurringInvoice,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
    }
  });
};

export const useUpdateRecurringInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateRecurringInvoiceDto }) =>
      recurringInvoiceService.updateRecurringInvoice(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
    }
  });
};

export const useDeleteRecurringInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringInvoiceService.deleteRecurringInvoice(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
    }
  });
};

export const useGenerateInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data?: { generation_date?: string } }) =>
      recurringInvoiceService.generateInvoice(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-history', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    }
  });
};

export const usePauseRecurringInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringInvoiceService.pauseRecurringInvoice(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
    }
  });
};

export const useResumeRecurringInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringInvoiceService.resumeRecurringInvoice(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
    }
  });
};

export const useCancelRecurringInvoice = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => recurringInvoiceService.cancelRecurringInvoice(id),
    onSuccess: (_, id) => {
      queryClient.invalidateQueries({ queryKey: ['recurring-invoices'] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice', id] });
      queryClient.invalidateQueries({ queryKey: ['recurring-invoice-stats'] });
    }
  });
};
