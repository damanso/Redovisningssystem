import express from 'express';
import * as calendarController from '../controllers/calendarController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

router.use(authenticate);

// OAuth endpoints
router.get('/auth/url', calendarController.getAuthUrl);
router.get('/auth/callback', calendarController.handleOAuthCallback);
router.get('/auth/status', calendarController.checkConnection);
router.post('/auth/disconnect', calendarController.disconnect);

// Event CRUD operations
router.post('/events', calendarController.createEvent);
router.get('/events', calendarController.getEvents);
router.get('/events/:id', calendarController.getEventById);
router.put('/events/:id', calendarController.updateEvent);
router.delete('/events/:id', calendarController.deleteEvent);

// Event sync operations
router.post('/events/:id/sync', calendarController.syncEventToGoogle);
router.post('/sync/import', calendarController.syncFromGoogle);

// Reminder CRUD operations
router.post('/reminders', calendarController.createReminder);
router.get('/reminders', calendarController.getReminders);
router.put('/reminders/:id', calendarController.updateReminder);
router.delete('/reminders/:id', calendarController.deleteReminder);

export default router;
