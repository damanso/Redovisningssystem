import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as projectService from '../services/projectService';
import type { CreateProjectDto, CreateTimeEntryDto } from '../services/projectService';

// ==================== PROJECT HOOKS ====================

export const useProjects = (companyId: string, filters?: {
  search?: string;
  status?: string;
  customer_id?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: ['projects', companyId, filters],
    queryFn: () => projectService.getProjects(companyId, filters),
    enabled: !!companyId
  });
};

export const useProject = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['project', id],
    queryFn: () => projectService.getProjectById(id, companyId),
    enabled: !!id && !!companyId
  });
};

export const useCreateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectService.createProject,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  });
};

export const useUpdateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      companyId,
      data
    }: {
      id: string;
      companyId: string;
      data: Partial<CreateProjectDto>
    }) => projectService.updateProject(id, companyId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
    }
  });
};

export const useDeleteProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      projectService.deleteProject(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
    }
  });
};

export const useDeactivateProject = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      projectService.deactivateProject(id, companyId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project', variables.id] });
    }
  });
};

export const useProjectSummary = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['project-summary', id],
    queryFn: () => projectService.getProjectSummary(id, companyId),
    enabled: !!id && !!companyId
  });
};

// ==================== TIME ENTRY HOOKS ====================

export const useTimeEntries = (companyId: string, filters?: {
  project_id?: string;
  user_id?: string;
  start_date?: string;
  end_date?: string;
  is_billable?: boolean;
  is_invoiced?: boolean;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: ['time-entries', companyId, filters],
    queryFn: () => projectService.getTimeEntries(companyId, filters),
    enabled: !!companyId
  });
};

export const useTimeEntry = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['time-entry', id],
    queryFn: () => projectService.getTimeEntryById(id, companyId),
    enabled: !!id && !!companyId
  });
};

export const useCreateTimeEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: projectService.createTimeEntry,
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['project', data.project_id] });
      queryClient.invalidateQueries({ queryKey: ['project-summary', data.project_id] });
    }
  });
};

export const useUpdateTimeEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      id,
      companyId,
      data
    }: {
      id: string;
      companyId: string;
      data: Partial<CreateTimeEntryDto>
    }) => projectService.updateTimeEntry(id, companyId, data),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['time-entry', variables.id] });
      if (result?.project_id) {
        queryClient.invalidateQueries({ queryKey: ['project', result.project_id] });
        queryClient.invalidateQueries({ queryKey: ['project-summary', result.project_id] });
      }
    }
  });
};

export const useDeleteTimeEntry = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      projectService.deleteTimeEntry(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-summary'] });
    }
  });
};

export const useMarkTimeEntriesAsInvoiced = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      timeEntryIds,
      invoiceId
    }: {
      companyId: string;
      timeEntryIds: string[];
      invoiceId: string;
    }) => projectService.markTimeEntriesAsInvoiced(companyId, timeEntryIds, invoiceId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['time-entries'] });
      queryClient.invalidateQueries({ queryKey: ['projects'] });
      queryClient.invalidateQueries({ queryKey: ['project-summary'] });
    }
  });
};
