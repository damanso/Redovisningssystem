import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import * as calendarService from '../services/calendarService';
import {
  CreateEventRequest,
  UpdateEventRequest,
  CreateReminderRequest,
  UpdateReminderRequest,
  EventFilters,
  ReminderFilters
} from '../types/calendar.types';

// ==================== AUTHENTICATION HOOKS ====================

export const useCalendarAuthUrl = () => {
  return useQuery({
    queryKey: ['calendar-auth-url'],
    queryFn: calendarService.getAuthUrl,
    staleTime: 5 * 60 * 1000, // 5 minutes
    enabled: false // Only fetch when manually triggered
  });
};

export const useCalendarConnection = (companyId: string) => {
  return useQuery({
    queryKey: ['calendar-connection', companyId],
    queryFn: () => calendarService.checkConnection(companyId),
    enabled: !!companyId
  });
};

export const useDisconnectCalendar = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (companyId: string) => calendarService.disconnectCalendar(companyId),
    onSuccess: (_, companyId) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-connection', companyId] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-reminders'] });
    }
  });
};

// ==================== EVENT HOOKS ====================

export const useCalendarEvents = (companyId: string, filters?: EventFilters) => {
  return useQuery({
    queryKey: ['calendar-events', companyId, filters],
    queryFn: () => calendarService.getEvents(companyId, filters),
    enabled: !!companyId
  });
};

export const useCalendarEvent = (id: string, companyId: string) => {
  return useQuery({
    queryKey: ['calendar-event', id],
    queryFn: () => calendarService.getEventById(id, companyId),
    enabled: !!id && !!companyId
  });
};

export const useCreateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: calendarService.createEvent,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events', variables.company_id] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    }
  });
};

export const useUpdateEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateEventRequest }) =>
      calendarService.updateEvent(id, data),
    onSuccess: (data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
      queryClient.invalidateQueries({ queryKey: ['calendar-event', variables.id] });
    }
  });
};

export const useDeleteEvent = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      calendarService.deleteEvent(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    }
  });
};

export const useSyncEventToGoogle = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      calendarService.syncEventToGoogle(id, companyId),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-event', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    }
  });
};

export const useSyncFromGoogle = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({
      companyId,
      startDate,
      endDate
    }: {
      companyId: string;
      startDate?: Date;
      endDate?: Date;
    }) => calendarService.syncFromGoogle(companyId, startDate, endDate),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-events', variables.companyId] });
      queryClient.invalidateQueries({ queryKey: ['calendar-events'] });
    }
  });
};

// ==================== REMINDER HOOKS ====================

export const useCalendarReminders = (companyId: string, filters?: ReminderFilters) => {
  return useQuery({
    queryKey: ['calendar-reminders', companyId, filters],
    queryFn: () => calendarService.getReminders(companyId, filters),
    enabled: !!companyId
  });
};

export const useCreateReminder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: calendarService.createReminder,
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['calendar-reminders', variables.company_id] });
      queryClient.invalidateQueries({ queryKey: ['calendar-reminders'] });
    }
  });
};

export const useUpdateReminder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateReminderRequest }) =>
      calendarService.updateReminder(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-reminders'] });
    }
  });
};

export const useDeleteReminder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      calendarService.deleteReminder(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-reminders'] });
    }
  });
};

export const useCompleteReminder = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, companyId }: { id: string; companyId: string }) =>
      calendarService.completeReminder(id, companyId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['calendar-reminders'] });
    }
  });
};
