import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import { query } from '../config/database.js';
import {
  CalendarEvent,
  CalendarReminder,
  CreateEventDto,
  UpdateEventDto,
  CreateReminderDto,
  UpdateReminderDto,
  GoogleCalendarAuth,
  SyncResult
} from '../types/calendar.types.js';

// Initialize OAuth2 client
const getOAuth2Client = (): OAuth2Client => {
  return new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/v1/calendar/oauth/callback'
  );
};

/**
 * Generate Google OAuth authorization URL
 */
export const getAuthorizationUrl = (): string => {
  const oauth2Client = getOAuth2Client();

  const scopes = [
    'https://www.googleapis.com/auth/calendar',
    'https://www.googleapis.com/auth/calendar.events'
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: 'offline',
    scope: scopes,
    prompt: 'consent'
  });

  return authUrl;
};

/**
 * Exchange authorization code for tokens and save to database
 */
export const handleOAuthCallback = async (
  code: string,
  companyId: string,
  userId: string
): Promise<GoogleCalendarAuth> => {
  const oauth2Client = getOAuth2Client();

  // Exchange code for tokens
  const { tokens } = await oauth2Client.getToken(code);

  if (!tokens.access_token || !tokens.refresh_token) {
    throw new Error('Failed to obtain access tokens');
  }

  const tokenExpiry = new Date(tokens.expiry_date || Date.now() + 3600000);

  // Check if auth already exists for this user
  const existingAuth = await query(
    'SELECT * FROM google_calendar_auth WHERE company_id = $1 AND user_id = $2',
    [companyId, userId]
  );

  let result;

  if (existingAuth.rows.length > 0) {
    // Update existing auth
    result = await query(
      `UPDATE google_calendar_auth
       SET access_token = $1, refresh_token = $2, token_expiry = $3,
           is_active = true, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = $4 AND user_id = $5
       RETURNING *`,
      [tokens.access_token, tokens.refresh_token, tokenExpiry, companyId, userId]
    );
  } else {
    // Create new auth
    result = await query(
      `INSERT INTO google_calendar_auth
       (company_id, user_id, access_token, refresh_token, token_expiry, calendar_id)
       VALUES ($1, $2, $3, $4, $5, 'primary')
       RETURNING *`,
      [companyId, userId, tokens.access_token, tokens.refresh_token, tokenExpiry]
    );
  }

  return result.rows[0];
};

/**
 * Get valid OAuth2 client for a user (refreshes token if needed)
 */
const getAuthenticatedClient = async (
  companyId: string,
  userId: string
): Promise<OAuth2Client> => {
  const result = await query(
    'SELECT * FROM google_calendar_auth WHERE company_id = $1 AND user_id = $2 AND is_active = true',
    [companyId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Google Calendar not connected. Please authenticate first.');
  }

  const auth = result.rows[0];
  const oauth2Client = getOAuth2Client();

  oauth2Client.setCredentials({
    access_token: auth.access_token,
    refresh_token: auth.refresh_token,
    expiry_date: new Date(auth.token_expiry).getTime()
  });

  // Check if token needs refresh
  const now = new Date();
  if (new Date(auth.token_expiry) <= now) {
    const { credentials } = await oauth2Client.refreshAccessToken();

    // Update tokens in database
    await query(
      `UPDATE google_calendar_auth
       SET access_token = $1, token_expiry = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3`,
      [credentials.access_token, new Date(credentials.expiry_date!), auth.id]
    );

    oauth2Client.setCredentials(credentials);
  }

  return oauth2Client;
};

/**
 * Check if user has connected Google Calendar
 */
export const isCalendarConnected = async (
  companyId: string,
  userId: string
): Promise<boolean> => {
  const result = await query(
    'SELECT id FROM google_calendar_auth WHERE company_id = $1 AND user_id = $2 AND is_active = true',
    [companyId, userId]
  );
  return result.rows.length > 0;
};

/**
 * Disconnect Google Calendar
 */
export const disconnectCalendar = async (
  companyId: string,
  userId: string
): Promise<void> => {
  await query(
    'UPDATE google_calendar_auth SET is_active = false WHERE company_id = $1 AND user_id = $2',
    [companyId, userId]
  );
};

/**
 * Create a calendar event in local database
 */
export const createEvent = async (
  companyId: string,
  userId: string,
  data: CreateEventDto
): Promise<CalendarEvent> => {
  const result = await query(
    `INSERT INTO calendar_events
     (company_id, user_id, title, description, location, start_time, end_time,
      all_day, attendees, reminder_minutes, sync_to_google)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
     RETURNING *`,
    [
      companyId,
      userId,
      data.title,
      data.description || null,
      data.location || null,
      data.start_time,
      data.end_time,
      data.all_day || false,
      data.attendees || null,
      data.reminder_minutes || null,
      data.sync_to_google || false
    ]
  );

  const event = result.rows[0];

  // If sync is enabled, create event in Google Calendar
  if (data.sync_to_google) {
    try {
      await syncEventToGoogle(companyId, userId, event.id);
    } catch (error) {
      console.error('Failed to sync event to Google:', error);
      // Event is still created locally, sync can be retried later
    }
  }

  return event;
};

/**
 * Get all events for a company/user
 */
export const getEvents = async (
  companyId: string,
  userId: string,
  filters?: {
    start_date?: Date;
    end_date?: Date;
    status?: string;
    limit?: number;
    offset?: number;
  }
): Promise<{ events: CalendarEvent[]; total: number }> => {
  let queryText = `
    SELECT * FROM calendar_events
    WHERE company_id = $1 AND user_id = $2
  `;

  const params: any[] = [companyId, userId];
  let paramCount = 3;

  if (filters?.start_date) {
    queryText += ` AND start_time >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND end_time <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  if (filters?.status) {
    queryText += ` AND status = $${paramCount}`;
    params.push(filters.status);
    paramCount++;
  }

  const countResult = await query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);

  queryText += ` ORDER BY start_time ASC`;

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
  }

  const result = await query(queryText, params);

  return {
    events: result.rows,
    total
  };
};

/**
 * Get event by ID
 */
export const getEventById = async (
  eventId: string,
  companyId: string,
  userId: string
): Promise<CalendarEvent> => {
  const result = await query(
    'SELECT * FROM calendar_events WHERE id = $1 AND company_id = $2 AND user_id = $3',
    [eventId, companyId, userId]
  );

  if (result.rows.length === 0) {
    throw new Error('Event not found');
  }

  return result.rows[0];
};

/**
 * Update a calendar event
 */
export const updateEvent = async (
  eventId: string,
  companyId: string,
  userId: string,
  data: UpdateEventDto
): Promise<CalendarEvent> => {
  const event = await getEventById(eventId, companyId, userId);

  const updates: string[] = [];
  const params: any[] = [];
  let paramCount = 1;

  if (data.title !== undefined) {
    updates.push(`title = $${paramCount}`);
    params.push(data.title);
    paramCount++;
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramCount}`);
    params.push(data.description);
    paramCount++;
  }

  if (data.location !== undefined) {
    updates.push(`location = $${paramCount}`);
    params.push(data.location);
    paramCount++;
  }

  if (data.start_time !== undefined) {
    updates.push(`start_time = $${paramCount}`);
    params.push(data.start_time);
    paramCount++;
  }

  if (data.end_time !== undefined) {
    updates.push(`end_time = $${paramCount}`);
    params.push(data.end_time);
    paramCount++;
  }

  if (data.all_day !== undefined) {
    updates.push(`all_day = $${paramCount}`);
    params.push(data.all_day);
    paramCount++;
  }

  if (data.attendees !== undefined) {
    updates.push(`attendees = $${paramCount}`);
    params.push(data.attendees);
    paramCount++;
  }

  if (data.reminder_minutes !== undefined) {
    updates.push(`reminder_minutes = $${paramCount}`);
    params.push(data.reminder_minutes);
    paramCount++;
  }

  if (data.status !== undefined) {
    updates.push(`status = $${paramCount}`);
    params.push(data.status);
    paramCount++;
  }

  if (data.sync_to_google !== undefined) {
    updates.push(`sync_to_google = $${paramCount}`);
    params.push(data.sync_to_google);
    paramCount++;
  }

  if (updates.length === 0) {
    return event;
  }

  params.push(eventId, companyId, userId);

  const result = await query(
    `UPDATE calendar_events
     SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1} AND user_id = $${paramCount + 2}
     RETURNING *`,
    params
  );

  const updatedEvent = result.rows[0];

  // If sync is enabled and event was synced before, update in Google
  if (updatedEvent.sync_to_google && updatedEvent.google_event_id) {
    try {
      await syncEventToGoogle(companyId, userId, updatedEvent.id);
    } catch (error) {
      console.error('Failed to sync updated event to Google:', error);
    }
  }

  return updatedEvent;
};

/**
 * Delete a calendar event
 */
export const deleteEvent = async (
  eventId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  const event = await getEventById(eventId, companyId, userId);

  // If synced to Google, delete from Google Calendar first
  if (event.google_event_id) {
    try {
      const oauth2Client = await getAuthenticatedClient(companyId, userId);
      const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

      await calendar.events.delete({
        calendarId: 'primary',
        eventId: event.google_event_id
      });
    } catch (error) {
      console.error('Failed to delete event from Google Calendar:', error);
    }
  }

  await query(
    'DELETE FROM calendar_events WHERE id = $1 AND company_id = $2 AND user_id = $3',
    [eventId, companyId, userId]
  );
};

/**
 * Sync a single event to Google Calendar
 */
export const syncEventToGoogle = async (
  companyId: string,
  userId: string,
  eventId: string
): Promise<void> => {
  const event = await getEventById(eventId, companyId, userId);

  if (!event.sync_to_google) {
    throw new Error('Event is not marked for Google sync');
  }

  const oauth2Client = await getAuthenticatedClient(companyId, userId);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const googleEvent = {
    summary: event.title,
    description: event.description || undefined,
    location: event.location || undefined,
    start: event.all_day
      ? { date: new Date(event.start_time).toISOString().split('T')[0] }
      : { dateTime: new Date(event.start_time).toISOString(), timeZone: 'Europe/Stockholm' },
    end: event.all_day
      ? { date: new Date(event.end_time).toISOString().split('T')[0] }
      : { dateTime: new Date(event.end_time).toISOString(), timeZone: 'Europe/Stockholm' },
    attendees: event.attendees?.map(email => ({ email })) || undefined,
    reminders: event.reminder_minutes
      ? {
          useDefault: false,
          overrides: [
            { method: 'popup', minutes: event.reminder_minutes }
          ]
        }
      : { useDefault: true }
  };

  if (event.google_event_id) {
    // Update existing event
    await calendar.events.update({
      calendarId: 'primary',
      eventId: event.google_event_id,
      requestBody: googleEvent
    });
  } else {
    // Create new event
    const response = await calendar.events.insert({
      calendarId: 'primary',
      requestBody: googleEvent
    });

    // Save Google event ID
    await query(
      `UPDATE calendar_events
       SET google_event_id = $1, last_synced_at = CURRENT_TIMESTAMP
       WHERE id = $2`,
      [response.data.id, eventId]
    );
  }

  // Update last synced timestamp
  await query(
    'UPDATE calendar_events SET last_synced_at = CURRENT_TIMESTAMP WHERE id = $1',
    [eventId]
  );
};

/**
 * Sync all events from Google Calendar to local database
 */
export const syncFromGoogle = async (
  companyId: string,
  userId: string,
  startDate?: Date,
  endDate?: Date
): Promise<SyncResult> => {
  const oauth2Client = await getAuthenticatedClient(companyId, userId);
  const calendar = google.calendar({ version: 'v3', auth: oauth2Client });

  const timeMin = startDate || new Date();
  const timeMax = endDate || new Date(Date.now() + 90 * 24 * 60 * 60 * 1000); // 90 days

  try {
    const response = await calendar.events.list({
      calendarId: 'primary',
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: true,
      orderBy: 'startTime'
    });

    const googleEvents = response.data.items || [];
    let syncedCount = 0;
    let failedCount = 0;
    const errors: string[] = [];

    for (const gEvent of googleEvents) {
      try {
        // Check if event already exists
        const existing = await query(
          'SELECT id FROM calendar_events WHERE google_event_id = $1 AND company_id = $2 AND user_id = $3',
          [gEvent.id, companyId, userId]
        );

        const startTime = gEvent.start?.dateTime || gEvent.start?.date;
        const endTime = gEvent.end?.dateTime || gEvent.end?.date;
        const allDay = !gEvent.start?.dateTime;

        if (existing.rows.length > 0) {
          // Update existing event
          await query(
            `UPDATE calendar_events
             SET title = $1, description = $2, location = $3, start_time = $4,
                 end_time = $5, all_day = $6, last_synced_at = CURRENT_TIMESTAMP
             WHERE google_event_id = $7 AND company_id = $8 AND user_id = $9`,
            [
              gEvent.summary || 'Untitled Event',
              gEvent.description || null,
              gEvent.location || null,
              startTime,
              endTime,
              allDay,
              gEvent.id,
              companyId,
              userId
            ]
          );
        } else {
          // Create new event
          await query(
            `INSERT INTO calendar_events
             (company_id, user_id, google_event_id, title, description, location,
              start_time, end_time, all_day, sync_to_google, last_synced_at)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, true, CURRENT_TIMESTAMP)`,
            [
              companyId,
              userId,
              gEvent.id,
              gEvent.summary || 'Untitled Event',
              gEvent.description || null,
              gEvent.location || null,
              startTime,
              endTime,
              allDay
            ]
          );
        }

        syncedCount++;
      } catch (error) {
        failedCount++;
        errors.push(`Failed to sync event ${gEvent.id}: ${error}`);
        console.error(`Failed to sync event ${gEvent.id}:`, error);
      }
    }

    return {
      success: failedCount === 0,
      synced_count: syncedCount,
      failed_count: failedCount,
      errors: errors.length > 0 ? errors : undefined,
      last_sync_at: new Date()
    };
  } catch (error) {
    throw new Error(`Failed to sync from Google Calendar: ${error}`);
  }
};

/**
 * Create a reminder
 */
export const createReminder = async (
  companyId: string,
  userId: string,
  data: CreateReminderDto
): Promise<CalendarReminder> => {
  const result = await query(
    `INSERT INTO calendar_reminders
     (company_id, user_id, event_id, title, description, reminder_time, sync_to_google)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      companyId,
      userId,
      data.event_id || null,
      data.title,
      data.description || null,
      data.reminder_time,
      data.sync_to_google || false
    ]
  );

  return result.rows[0];
};

/**
 * Get all reminders for a company/user
 */
export const getReminders = async (
  companyId: string,
  userId: string,
  filters?: {
    is_completed?: boolean;
    start_date?: Date;
    end_date?: Date;
    limit?: number;
    offset?: number;
  }
): Promise<{ reminders: CalendarReminder[]; total: number }> => {
  let queryText = `
    SELECT * FROM calendar_reminders
    WHERE company_id = $1 AND user_id = $2
  `;

  const params: any[] = [companyId, userId];
  let paramCount = 3;

  if (filters?.is_completed !== undefined) {
    queryText += ` AND is_completed = $${paramCount}`;
    params.push(filters.is_completed);
    paramCount++;
  }

  if (filters?.start_date) {
    queryText += ` AND reminder_time >= $${paramCount}`;
    params.push(filters.start_date);
    paramCount++;
  }

  if (filters?.end_date) {
    queryText += ` AND reminder_time <= $${paramCount}`;
    params.push(filters.end_date);
    paramCount++;
  }

  const countResult = await query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);

  queryText += ` ORDER BY reminder_time ASC`;

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
  }

  const result = await query(queryText, params);

  return {
    reminders: result.rows,
    total
  };
};

/**
 * Update a reminder
 */
export const updateReminder = async (
  reminderId: string,
  companyId: string,
  userId: string,
  data: UpdateReminderDto
): Promise<CalendarReminder> => {
  const updates: string[] = [];
  const params: any[] = [];
  let paramCount = 1;

  if (data.title !== undefined) {
    updates.push(`title = $${paramCount}`);
    params.push(data.title);
    paramCount++;
  }

  if (data.description !== undefined) {
    updates.push(`description = $${paramCount}`);
    params.push(data.description);
    paramCount++;
  }

  if (data.reminder_time !== undefined) {
    updates.push(`reminder_time = $${paramCount}`);
    params.push(data.reminder_time);
    paramCount++;
  }

  if (data.is_completed !== undefined) {
    updates.push(`is_completed = $${paramCount}`);
    params.push(data.is_completed);
    paramCount++;
  }

  if (updates.length === 0) {
    const result = await query(
      'SELECT * FROM calendar_reminders WHERE id = $1 AND company_id = $2 AND user_id = $3',
      [reminderId, companyId, userId]
    );
    return result.rows[0];
  }

  params.push(reminderId, companyId, userId);

  const result = await query(
    `UPDATE calendar_reminders
     SET ${updates.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1} AND user_id = $${paramCount + 2}
     RETURNING *`,
    params
  );

  if (result.rows.length === 0) {
    throw new Error('Reminder not found');
  }

  return result.rows[0];
};

/**
 * Delete a reminder
 */
export const deleteReminder = async (
  reminderId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  await query(
    'DELETE FROM calendar_reminders WHERE id = $1 AND company_id = $2 AND user_id = $3',
    [reminderId, companyId, userId]
  );
};
