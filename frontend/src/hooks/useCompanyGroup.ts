/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Hooks
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as companyGroupService from '../services/companyGroupService';
import {
  CreateCompanyGroupDto,
  UpdateCompanyGroupDto
} from '../types/companyGroup.types';

export const useCompanyGroups = () => {
  return useQuery({
    queryKey: ['companyGroups'],
    queryFn: companyGroupService.getCompanyGroups,
    retry: 1,
  });
};

export const useCompanyGroup = (groupId: string) => {
  return useQuery({
    queryKey: ['companyGroup', groupId],
    queryFn: () => companyGroupService.getCompanyGroupById(groupId),
    enabled: !!groupId,
    retry: 1,
  });
};

export const useCreateCompanyGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompanyGroupDto) => companyGroupService.createCompanyGroup(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyGroups'] });
    },
  });
};

export const useUpdateCompanyGroup = (groupId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateCompanyGroupDto) =>
      companyGroupService.updateCompanyGroup(groupId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyGroup', groupId] });
      queryClient.invalidateQueries({ queryKey: ['companyGroups'] });
    },
  });
};

export const useDeleteCompanyGroup = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (groupId: string) => companyGroupService.deleteCompanyGroup(groupId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyGroups'] });
    },
  });
};

export const useAddCompanyToGroup = (groupId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) =>
      companyGroupService.addCompanyToGroup(groupId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyGroup', groupId] });
      queryClient.invalidateQueries({ queryKey: ['companyGroups'] });
    },
  });
};

export const useRemoveCompanyFromGroup = (groupId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) =>
      companyGroupService.removeCompanyFromGroup(groupId, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyGroup', groupId] });
      queryClient.invalidateQueries({ queryKey: ['companyGroups'] });
    },
  });
};

export const useCompaniesInGroup = (groupId: string) => {
  return useQuery({
    queryKey: ['companiesInGroup', groupId],
    queryFn: () => companyGroupService.getCompaniesInGroup(groupId),
    enabled: !!groupId,
    retry: 1,
  });
};
