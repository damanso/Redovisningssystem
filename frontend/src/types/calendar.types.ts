export interface CalendarEvent {
  id: string;
  company_id: string;
  user_id: string;
  google_event_id?: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string;
  end_time: string;
  all_day: boolean;
  attendees?: string[];
  reminder_minutes?: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  sync_to_google: boolean;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CalendarReminder {
  id: string;
  company_id: string;
  user_id: string;
  event_id?: string;
  google_event_id?: string;
  title: string;
  description?: string;
  reminder_time: string;
  is_completed: boolean;
  sync_to_google: boolean;
  last_synced_at?: string;
  created_at: string;
  updated_at: string;
}

export interface CreateEventRequest {
  company_id: string;
  title: string;
  description?: string;
  location?: string;
  start_time: string | Date;
  end_time: string | Date;
  all_day?: boolean;
  attendees?: string[];
  reminder_minutes?: number;
  sync_to_google?: boolean;
}

export interface UpdateEventRequest {
  company_id: string;
  title?: string;
  description?: string;
  location?: string;
  start_time?: string | Date;
  end_time?: string | Date;
  all_day?: boolean;
  attendees?: string[];
  reminder_minutes?: number;
  status?: 'pending' | 'confirmed' | 'cancelled';
  sync_to_google?: boolean;
}

export interface CreateReminderRequest {
  company_id: string;
  event_id?: string;
  title: string;
  description?: string;
  reminder_time: string | Date;
  sync_to_google?: boolean;
}

export interface UpdateReminderRequest {
  company_id: string;
  title?: string;
  description?: string;
  reminder_time?: string | Date;
  is_completed?: boolean;
  sync_to_google?: boolean;
}

export interface EventFilters {
  start_date?: string | Date;
  end_date?: string | Date;
  status?: string;
  limit?: number;
  offset?: number;
}

export interface ReminderFilters {
  is_completed?: boolean;
  start_date?: string | Date;
  end_date?: string | Date;
  limit?: number;
  offset?: number;
}

export interface CalendarConnectionStatus {
  connected: boolean;
}

export interface GoogleAuthUrl {
  authUrl: string;
}

export interface SyncResult {
  success: boolean;
  synced_count: number;
  failed_count: number;
  errors?: string[];
  last_sync_at: string;
}

export interface EventsResponse {
  events: CalendarEvent[];
  total: number;
}

export interface RemindersResponse {
  reminders: CalendarReminder[];
  total: number;
}
