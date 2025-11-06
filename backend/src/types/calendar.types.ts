export interface CalendarEvent {
  id: string;
  company_id: string;
  user_id: string;
  google_event_id?: string;
  title: string;
  description?: string;
  location?: string;
  start_time: Date;
  end_time: Date;
  all_day: boolean;
  attendees?: string[];
  reminder_minutes?: number;
  status: 'pending' | 'confirmed' | 'cancelled';
  sync_to_google: boolean;
  last_synced_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CalendarReminder {
  id: string;
  company_id: string;
  user_id: string;
  event_id?: string;
  google_event_id?: string;
  title: string;
  description?: string;
  reminder_time: Date;
  is_completed: boolean;
  sync_to_google: boolean;
  last_synced_at?: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateEventDto {
  title: string;
  description?: string;
  location?: string;
  start_time: Date | string;
  end_time: Date | string;
  all_day?: boolean;
  attendees?: string[];
  reminder_minutes?: number;
  sync_to_google?: boolean;
}

export interface UpdateEventDto extends Partial<CreateEventDto> {
  status?: 'pending' | 'confirmed' | 'cancelled';
}

export interface CreateReminderDto {
  event_id?: string;
  title: string;
  description?: string;
  reminder_time: Date | string;
  sync_to_google?: boolean;
}

export interface UpdateReminderDto extends Partial<CreateReminderDto> {
  is_completed?: boolean;
}

export interface GoogleCalendarConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  refreshToken?: string;
  accessToken?: string;
}

export interface GoogleCalendarAuth {
  id: string;
  company_id: string;
  user_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: Date;
  calendar_id: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

export interface SyncResult {
  success: boolean;
  synced_count: number;
  failed_count: number;
  errors?: string[];
  last_sync_at: Date;
}
