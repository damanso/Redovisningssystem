import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as companyService from '../services/companyService';
import { CreateCompanyDto, UpdateCompanyDto } from '../types/company.types';

export const useCompanies = () => {
  return useQuery({
    queryKey: ['companies'],
    queryFn: companyService.getUserCompanies,
    retry: 1,
  });
};

export const useCompany = (companyId: string) => {
  return useQuery({
    queryKey: ['company', companyId],
    queryFn: () => companyService.getCompanyById(companyId),
    enabled: !!companyId,
    retry: 1,
  });
};

export const useCreateCompany = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: CreateCompanyDto) => companyService.createCompany(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
};

export const useUpdateCompany = (companyId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (data: UpdateCompanyDto) =>
      companyService.updateCompany(companyId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['company', companyId] });
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
};

export const useDeactivateCompany = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) => companyService.deactivateCompany(companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companies'] });
    },
  });
};

export const useCompanyUsers = (companyId: string) => {
  return useQuery({
    queryKey: ['companyUsers', companyId],
    queryFn: () => companyService.getCompanyUsers(companyId),
    enabled: !!companyId,
    retry: 1,
  });
};

export const useAddUserToCompany = (companyId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      companyService.addUserToCompany(companyId, userId, role),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyUsers', companyId] });
    },
  });
};

export const useRemoveUserFromCompany = (companyId: string) => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (userId: string) =>
      companyService.removeUserFromCompany(companyId, userId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['companyUsers', companyId] });
    },
  });
};
