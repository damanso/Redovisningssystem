/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as consolidatedReportService from '../services/consolidatedReportService';
import {
  CreateConsolidatedReportConfigDto,
  UpdateConsolidatedReportConfigDto
} from '../types/consolidatedReport.types';

export const useReportConfigs = () => {
  return useQuery({
    queryKey: ['reportConfigs'],
    queryFn: consolidatedReportService.getReportConfigs,
    retry: 1,
  });
};

export const useReportConfig = (configId: string) => {
  return useQuery({
    queryKey: ['reportConfig', configId],
    queryFn: () => consolidatedReportService.getReportConfigById(configId),
    enabled: !!configId,
    retry: 1,
  });
};

export const useCreateReportConfig = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateConsolidatedReportConfigDto) =>
      consolidatedReportService.createReportConfig(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportConfigs'] });
    },
  });
};

export const useUpdateReportConfig = (configId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateConsolidatedReportConfigDto) =>
      consolidatedReportService.updateReportConfig(configId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportConfig', configId] });
      queryClient.invalidateQueries({ queryKey: ['reportConfigs'] });
    },
  });
};

export const useDeleteReportConfig = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (configId: string) => consolidatedReportService.deleteReportConfig(configId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reportConfigs'] });
    },
  });
};

export const useGenerateConsolidatedReport = () => {
  return useMutation({
    mutationFn: (data: {
      company_ids?: string[];
      group_ids?: string[];
      report_type: string;
      date_range_start?: string;
      date_range_end?: string;
      currency?: string;
    }) => consolidatedReportService.generateConsolidatedReport(data),
  });
};

export const useConsolidatedTransactionData = (
  companyIds: string[],
  dateRange?: { date_range_start?: string; date_range_end?: string }
) => {
  return useQuery({
    queryKey: ['consolidatedTransactionData', companyIds, dateRange],
    queryFn: () => consolidatedReportService.getConsolidatedTransactionData(companyIds, dateRange),
    enabled: companyIds.length > 0,
    retry: 1,
  });
};
