import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as userService from '../services/userService';

export const useCurrentUser = () => {
  return useQuery({
    queryKey: ['currentUser'],
    queryFn: userService.getCurrentUser,
    retry: 1,
  });
};

export const useUpdateUser = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: userService.updateCurrentUser,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['currentUser'] });
    },
  });
};

export const useChangePassword = () => {
  return useMutation({
    mutationFn: userService.changePassword,
  });
};

export const useUsers = (companyId?: string) => {
  return useQuery({
    queryKey: ['users', companyId],
    queryFn: () => userService.getAllUsers(companyId),
    retry: 1,
  });
};

export const useUser = (userId: string) => {
  return useQuery({
    queryKey: ['user', userId],
    queryFn: () => userService.getUserById(userId),
    enabled: !!userId,
    retry: 1,
  });
};
