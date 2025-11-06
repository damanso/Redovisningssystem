import axios from 'axios';
import {
  CalendarEvent,
  CalendarReminder,
  CreateEventRequest,
  UpdateEventRequest,
  CreateReminderRequest,
  UpdateReminderRequest,
  EventFilters,
  ReminderFilters,
  CalendarConnectionStatus,
  GoogleAuthUrl,
  SyncResult,
  EventsResponse,
  RemindersResponse
} from '../types/calendar.types';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

const getAuthHeader = () => {
  const token = localStorage.getItem('token');
  return { Authorization: `Bearer ${token}` };
};

// ==================== AUTHENTICATION ====================

/**
 * Get Google OAuth authorization URL
 */
export const getAuthUrl = async (): Promise<GoogleAuthUrl> => {
  const response = await axios.get(`${API_URL}/calendar/auth/url`, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Check if calendar is connected
 */
export const checkConnection = async (companyId: string): Promise<CalendarConnectionStatus> => {
  const response = await axios.get(`${API_URL}/calendar/auth/status?company_id=${companyId}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Disconnect Google Calendar
 */
export const disconnectCalendar = async (companyId: string): Promise<void> => {
  await axios.post(`${API_URL}/calendar/auth/disconnect`,
    { company_id: companyId },
    { headers: getAuthHeader() }
  );
};

// ==================== EVENTS ====================

/**
 * Get all events
 */
export const getEvents = async (
  companyId: string,
  filters?: EventFilters
): Promise<EventsResponse> => {
  const params = new URLSearchParams({ company_id: companyId });

  if (filters?.start_date) {
    params.append('start_date',
      typeof filters.start_date === 'string'
        ? filters.start_date
        : filters.start_date.toISOString()
    );
  }
  if (filters?.end_date) {
    params.append('end_date',
      typeof filters.end_date === 'string'
        ? filters.end_date
        : filters.end_date.toISOString()
    );
  }
  if (filters?.status) params.append('status', filters.status);
  if (filters?.limit) params.append('limit', filters.limit.toString());
  if (filters?.offset) params.append('offset', filters.offset.toString());

  const response = await axios.get(`${API_URL}/calendar/events?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Get event by ID
 */
export const getEventById = async (
  id: string,
  companyId: string
): Promise<CalendarEvent> => {
  const response = await axios.get(
    `${API_URL}/calendar/events/${id}?company_id=${companyId}`,
    { headers: getAuthHeader() }
  );
  return response.data;
};

/**
 * Create a new event
 */
export const createEvent = async (data: CreateEventRequest): Promise<CalendarEvent> => {
  const response = await axios.post(`${API_URL}/calendar/events`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Update an event
 */
export const updateEvent = async (
  id: string,
  data: UpdateEventRequest
): Promise<CalendarEvent> => {
  const response = await axios.put(`${API_URL}/calendar/events/${id}`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Delete an event
 */
export const deleteEvent = async (id: string, companyId: string): Promise<void> => {
  await axios.delete(`${API_URL}/calendar/events/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
};

/**
 * Sync a single event to Google Calendar
 */
export const syncEventToGoogle = async (id: string, companyId: string): Promise<void> => {
  await axios.post(
    `${API_URL}/calendar/events/${id}/sync`,
    { company_id: companyId },
    { headers: getAuthHeader() }
  );
};

/**
 * Sync events from Google Calendar
 */
export const syncFromGoogle = async (
  companyId: string,
  startDate?: Date,
  endDate?: Date
): Promise<SyncResult> => {
  const response = await axios.post(
    `${API_URL}/calendar/sync/import`,
    {
      company_id: companyId,
      start_date: startDate?.toISOString(),
      end_date: endDate?.toISOString()
    },
    { headers: getAuthHeader() }
  );
  return response.data;
};

// ==================== REMINDERS ====================

/**
 * Get all reminders
 */
export const getReminders = async (
  companyId: string,
  filters?: ReminderFilters
): Promise<RemindersResponse> => {
  const params = new URLSearchParams({ company_id: companyId });

  if (filters?.is_completed !== undefined) {
    params.append('is_completed', filters.is_completed.toString());
  }
  if (filters?.start_date) {
    params.append('start_date',
      typeof filters.start_date === 'string'
        ? filters.start_date
        : filters.start_date.toISOString()
    );
  }
  if (filters?.end_date) {
    params.append('end_date',
      typeof filters.end_date === 'string'
        ? filters.end_date
        : filters.end_date.toISOString()
    );
  }
  if (filters?.limit) params.append('limit', filters.limit.toString());
  if (filters?.offset) params.append('offset', filters.offset.toString());

  const response = await axios.get(`${API_URL}/calendar/reminders?${params.toString()}`, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Create a new reminder
 */
export const createReminder = async (
  data: CreateReminderRequest
): Promise<CalendarReminder> => {
  const response = await axios.post(`${API_URL}/calendar/reminders`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Update a reminder
 */
export const updateReminder = async (
  id: string,
  data: UpdateReminderRequest
): Promise<CalendarReminder> => {
  const response = await axios.put(`${API_URL}/calendar/reminders/${id}`, data, {
    headers: getAuthHeader()
  });
  return response.data;
};

/**
 * Delete a reminder
 */
export const deleteReminder = async (id: string, companyId: string): Promise<void> => {
  await axios.delete(`${API_URL}/calendar/reminders/${id}`, {
    headers: getAuthHeader(),
    data: { company_id: companyId }
  });
};

/**
 * Mark a reminder as completed
 */
export const completeReminder = async (
  id: string,
  companyId: string
): Promise<CalendarReminder> => {
  return updateReminder(id, {
    company_id: companyId,
    is_completed: true
  });
};
