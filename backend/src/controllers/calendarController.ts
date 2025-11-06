import { Request, Response } from 'express';
import * as calendarService from '../services/googleCalendarService.js';
import { CreateEventDto, UpdateEventDto, CreateReminderDto, UpdateReminderDto } from '../types/calendar.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

/**
 * Get Google OAuth authorization URL
 */
export const getAuthUrl = async (req: Request, res: Response) => {
  try {
    const authUrl = calendarService.getAuthorizationUrl();
    res.json({ authUrl });
  } catch (error: any) {
    console.error('Get auth URL error:', error);
    res.status(500).json({ error: 'Failed to generate authorization URL' });
  }
};

/**
 * Handle OAuth callback
 */
export const handleOAuthCallback = async (req: AuthRequest, res: Response) => {
  try {
    const { code, company_id } = req.query;
    const userId = req.user?.userId;

    if (!code || !company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const auth = await calendarService.handleOAuthCallback(
      code as string,
      company_id as string,
      userId
    );

    res.json({
      message: 'Google Calendar connected successfully',
      auth: {
        id: auth.id,
        is_active: auth.is_active,
        calendar_id: auth.calendar_id
      }
    });
  } catch (error: any) {
    console.error('OAuth callback error:', error);
    res.status(500).json({ error: 'Failed to connect Google Calendar' });
  }
};

/**
 * Check if calendar is connected
 */
export const checkConnection = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const isConnected = await calendarService.isCalendarConnected(
      company_id as string,
      userId
    );

    res.json({ connected: isConnected });
  } catch (error: any) {
    console.error('Check connection error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Disconnect Google Calendar
 */
export const disconnect = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await calendarService.disconnectCalendar(company_id, userId);

    res.json({ message: 'Google Calendar disconnected successfully' });
  } catch (error: any) {
    console.error('Disconnect error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Create a calendar event
 */
export const createEvent = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...eventData } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data: CreateEventDto = eventData;
    const event = await calendarService.createEvent(company_id, userId, data);

    res.status(201).json(event);
  } catch (error: any) {
    console.error('Create event error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Get all events
 */
export const getEvents = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, start_date, end_date, status, limit, offset } = req.query;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await calendarService.getEvents(company_id as string, userId, {
      start_date: start_date ? new Date(start_date as string) : undefined,
      end_date: end_date ? new Date(end_date as string) : undefined,
      status: status as string,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get events error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get event by ID
 */
export const getEventById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const event = await calendarService.getEventById(id, company_id as string, userId);

    res.json(event);
  } catch (error: any) {
    if (error.message === 'Event not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Get event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update an event
 */
export const updateEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const event = await calendarService.updateEvent(
      id,
      company_id,
      userId,
      updates as UpdateEventDto
    );

    res.json(event);
  } catch (error: any) {
    if (error.message === 'Event not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete an event
 */
export const deleteEvent = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await calendarService.deleteEvent(id, company_id, userId);

    res.json({ message: 'Event deleted successfully' });
  } catch (error: any) {
    if (error.message === 'Event not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Delete event error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Sync a single event to Google Calendar
 */
export const syncEventToGoogle = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await calendarService.syncEventToGoogle(company_id, userId, id);

    res.json({ message: 'Event synced to Google Calendar successfully' });
  } catch (error: any) {
    console.error('Sync event error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Sync events from Google Calendar
 */
export const syncFromGoogle = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, start_date, end_date } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await calendarService.syncFromGoogle(
      company_id,
      userId,
      start_date ? new Date(start_date) : undefined,
      end_date ? new Date(end_date) : undefined
    );

    res.json(result);
  } catch (error: any) {
    console.error('Sync from Google error:', error);
    res.status(500).json({ error: error.message || 'Internal server error' });
  }
};

/**
 * Create a reminder
 */
export const createReminder = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, ...reminderData } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data: CreateReminderDto = reminderData;
    const reminder = await calendarService.createReminder(company_id, userId, data);

    res.status(201).json(reminder);
  } catch (error: any) {
    console.error('Create reminder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Get all reminders
 */
export const getReminders = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id, is_completed, start_date, end_date, limit, offset } = req.query;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const result = await calendarService.getReminders(company_id as string, userId, {
      is_completed: is_completed === 'true' ? true : is_completed === 'false' ? false : undefined,
      start_date: start_date ? new Date(start_date as string) : undefined,
      end_date: end_date ? new Date(end_date as string) : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get reminders error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Update a reminder
 */
export const updateReminder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    const reminder = await calendarService.updateReminder(
      id,
      company_id,
      userId,
      updates as UpdateReminderDto
    );

    res.json(reminder);
  } catch (error: any) {
    if (error.message === 'Reminder not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update reminder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

/**
 * Delete a reminder
 */
export const deleteReminder = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;
    const userId = req.user?.userId;

    if (!company_id || !userId) {
      return res.status(400).json({ error: 'Missing required parameters' });
    }

    await calendarService.deleteReminder(id, company_id, userId);

    res.json({ message: 'Reminder deleted successfully' });
  } catch (error: any) {
    if (error.message === 'Reminder not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Delete reminder error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
