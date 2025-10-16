import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as customerService from '../services/customerService';
import type { CreateCustomerDto } from '../services/customerService';

export const useCustomers = (companyId: string, filters?: {
  search?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}) => {
  return useQuery({
    queryKey: ['customers', companyId, filters],
    queryFn: () => customerService.getCustomers(companyId, filters),
    enabled: !!companyId
  });
};

export const useCustomer = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['customer', id],
    queryFn: () => customerService.getCustomerById(id, companyId),
    enabled: !!id && !!companyId
  });
};

export const useCreateCustomer = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: customerService.createCustomer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
  });
};

export const useUpdateCustomer = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, companyId, data }: { 
      id: string; 
      companyId: string; 
      data: Partial<CreateCustomerDto> 
    }) => customerService.updateCustomer(id, companyId, data),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      queryClient.invalidateQueries({ queryKey: ['customer', variables.id] });
    }
  });
};

export const useDeleteCustomer = () => {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) => 
      customerService.deleteCustomer(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customers'] });
    }
  });
};
