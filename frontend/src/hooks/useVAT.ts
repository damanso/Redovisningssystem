import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as vatService from '../services/vatService';

// ============================================================================
// TAX PERIOD HOOKS
// ============================================================================

export const useTaxPeriods = (
  companyId: string,
  filters?: {
    period_type?: vatService.TaxPeriodType;
    period_year?: number;
    status?: vatService.TaxPeriodStatus;
  }
) => {
  return useQuery({
    queryKey: ['tax-periods', companyId, filters],
    queryFn: () => vatService.getTaxPeriods(companyId, filters),
    enabled: !!companyId,
  });
};

export const useTaxPeriod = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['tax-period', id],
    queryFn: () => vatService.getTaxPeriodById(id, companyId),
    enabled: !!id && !!companyId,
  });
};

export const useCreateTaxPeriod = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vatService.createTaxPeriod,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tax-periods'] });
    },
  });
};

export const useUpdateTaxPeriod = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      companyId,
      data,
    }: {
      id: string;
      companyId: string;
      data: { status?: vatService.TaxPeriodStatus; due_date?: string };
    }) => vatService.updateTaxPeriod(id, companyId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['tax-periods'] });
      queryClient.invalidateQueries({ queryKey: ['tax-period', variables.id] });
    },
  });
};

// ============================================================================
// VAT REPORT HOOKS
// ============================================================================

export const useVATReports = (
  companyId: string,
  filters?: {
    tax_period_id?: string;
    status?: vatService.VATReportStatus;
    period_start?: string;
    period_end?: string;
  }
) => {
  return useQuery({
    queryKey: ['vat-reports', companyId, filters],
    queryFn: () => vatService.getVATReports(companyId, filters),
    enabled: !!companyId,
  });
};

export const useVATReport = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['vat-report', id],
    queryFn: () => vatService.getVATReportById(id, companyId),
    enabled: !!id && !!companyId,
  });
};

export const useGenerateVATReport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: vatService.generateVATReport,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vat-reports'] });
    },
  });
};

export const useUpdateVATReport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      companyId,
      data,
    }: {
      id: string;
      companyId: string;
      data: vatService.UpdateVATReportDto;
    }) => vatService.updateVATReport(id, companyId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vat-reports'] });
      queryClient.invalidateQueries({ queryKey: ['vat-report', variables.id] });
    },
  });
};

export const useDeleteVATReport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      vatService.deleteVATReport(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['vat-reports'] });
    },
  });
};

// ============================================================================
// VAT CALCULATION HOOKS
// ============================================================================

export const useVATSummary = (
  companyId: string,
  periodStart: string,
  periodEnd: string,
  enabled: boolean = true
) => {
  return useQuery({
    queryKey: ['vat-summary', companyId, periodStart, periodEnd],
    queryFn: () => vatService.getVATSummary(companyId, periodStart, periodEnd),
    enabled: !!companyId && !!periodStart && !!periodEnd && enabled,
  });
};

// ============================================================================
// SKATTEVERKET SUBMISSION HOOKS
// ============================================================================

export const useSubmitVATReport = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      data,
    }: {
      id: string;
      data: vatService.SubmitVATReportDto;
    }) => vatService.submitVATReportToSkatteverket(id, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vat-report', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['vat-submissions', variables.id] });
    },
  });
};

export const useVATSubmissions = (reportId: string) => {
  return useQuery({
    queryKey: ['vat-submissions', reportId],
    queryFn: () => vatService.getSubmissionsByReport(reportId),
    enabled: !!reportId,
  });
};

export const useExportVATReport = () => {
  return useMutation({
    mutationFn: ({
      id,
      companyId,
      format,
    }: {
      id: string;
      companyId: string;
      format?: 'json' | 'xml';
    }) => vatService.exportVATReport(id, companyId, format),
  });
};
