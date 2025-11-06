import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Calendar, Save, X } from 'lucide-react';
import { useCreateEvent, useUpdateEvent, useCalendarEvent } from '../../hooks/useCalendar';
import { CreateEventRequest } from '../../types/calendar.types';

const EventFormPage: React.FC = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const isEditMode = !!id;

  const [companyId] = useState<string>(''); // In a real app, get from context/store

  // Fetch event if editing
  const { data: existingEvent } = useCalendarEvent(id || '', companyId);

  // Mutations
  const createMutation = useCreateEvent();
  const updateMutation = useUpdateEvent();

  // Form state
  const [formData, setFormData] = useState({
    title: '',
    description: '',
    location: '',
    start_time: '',
    end_time: '',
    all_day: false,
    attendees: '',
    reminder_minutes: 15,
    sync_to_google: false
  });

  // Load existing event data
  useEffect(() => {
    if (existingEvent) {
      setFormData({
        title: existingEvent.title,
        description: existingEvent.description || '',
        location: existingEvent.location || '',
        start_time: new Date(existingEvent.start_time).toISOString().slice(0, 16),
        end_time: new Date(existingEvent.end_time).toISOString().slice(0, 16),
        all_day: existingEvent.all_day,
        attendees: existingEvent.attendees?.join(', ') || '',
        reminder_minutes: existingEvent.reminder_minutes || 15,
        sync_to_google: existingEvent.sync_to_google
      });
    }
  }, [existingEvent]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    const attendeesList = formData.attendees
      .split(',')
      .map(email => email.trim())
      .filter(email => email.length > 0);

    const eventData: CreateEventRequest = {
      company_id: companyId,
      title: formData.title,
      description: formData.description || undefined,
      location: formData.location || undefined,
      start_time: formData.start_time,
      end_time: formData.end_time,
      all_day: formData.all_day,
      attendees: attendeesList.length > 0 ? attendeesList : undefined,
      reminder_minutes: formData.reminder_minutes,
      sync_to_google: formData.sync_to_google
    };

    try {
      if (isEditMode && id) {
        await updateMutation.mutateAsync({ id, data: eventData });
      } else {
        await createMutation.mutateAsync(eventData);
      }
      navigate('/calendar');
    } catch (error) {
      console.error('Failed to save event:', error);
      alert('Failed to save event. Please try again.');
    }
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => {
    const { name, value, type } = e.target;
    const checked = (e.target as HTMLInputElement).checked;

    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center gap-3">
            <Calendar className="w-8 h-8 text-blue-600" />
            <div>
              <h1 className="text-2xl font-bold text-gray-900">
                {isEditMode ? 'Edit Event' : 'Create New Event'}
              </h1>
              <p className="text-sm text-gray-600">
                {isEditMode ? 'Update event details' : 'Add a new event to your calendar'}
              </p>
            </div>
          </div>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="bg-white rounded-lg shadow-sm p-6">
          <div className="space-y-6">
            {/* Title */}
            <div>
              <label htmlFor="title" className="block text-sm font-medium text-gray-700 mb-2">
                Event Title *
              </label>
              <input
                type="text"
                id="title"
                name="title"
                value={formData.title}
                onChange={handleChange}
                required
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Team Meeting, Client Call"
              />
            </div>

            {/* Description */}
            <div>
              <label htmlFor="description" className="block text-sm font-medium text-gray-700 mb-2">
                Description
              </label>
              <textarea
                id="description"
                name="description"
                value={formData.description}
                onChange={handleChange}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Event details..."
              />
            </div>

            {/* Location */}
            <div>
              <label htmlFor="location" className="block text-sm font-medium text-gray-700 mb-2">
                Location
              </label>
              <input
                type="text"
                id="location"
                name="location"
                value={formData.location}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g., Office, Zoom, Address"
              />
            </div>

            {/* Date and Time */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label htmlFor="start_time" className="block text-sm font-medium text-gray-700 mb-2">
                  Start Time *
                </label>
                <input
                  type="datetime-local"
                  id="start_time"
                  name="start_time"
                  value={formData.start_time}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>

              <div>
                <label htmlFor="end_time" className="block text-sm font-medium text-gray-700 mb-2">
                  End Time *
                </label>
                <input
                  type="datetime-local"
                  id="end_time"
                  name="end_time"
                  value={formData.end_time}
                  onChange={handleChange}
                  required
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* All Day */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="all_day"
                name="all_day"
                checked={formData.all_day}
                onChange={handleChange}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="all_day" className="text-sm font-medium text-gray-700">
                All-day event
              </label>
            </div>

            {/* Attendees */}
            <div>
              <label htmlFor="attendees" className="block text-sm font-medium text-gray-700 mb-2">
                Attendees
              </label>
              <input
                type="text"
                id="attendees"
                name="attendees"
                value={formData.attendees}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="email1@example.com, email2@example.com"
              />
              <p className="mt-1 text-xs text-gray-500">Separate multiple emails with commas</p>
            </div>

            {/* Reminder */}
            <div>
              <label htmlFor="reminder_minutes" className="block text-sm font-medium text-gray-700 mb-2">
                Reminder
              </label>
              <select
                id="reminder_minutes"
                name="reminder_minutes"
                value={formData.reminder_minutes}
                onChange={handleChange}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option value={0}>No reminder</option>
                <option value={5}>5 minutes before</option>
                <option value={15}>15 minutes before</option>
                <option value={30}>30 minutes before</option>
                <option value={60}>1 hour before</option>
                <option value={1440}>1 day before</option>
              </select>
            </div>

            {/* Sync to Google */}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="sync_to_google"
                name="sync_to_google"
                checked={formData.sync_to_google}
                onChange={handleChange}
                className="w-4 h-4 text-blue-600 border-gray-300 rounded focus:ring-blue-500"
              />
              <label htmlFor="sync_to_google" className="text-sm font-medium text-gray-700">
                Sync to Google Calendar
              </label>
            </div>
          </div>

          {/* Actions */}
          <div className="flex justify-end gap-3 mt-8 pt-6 border-t border-gray-200">
            <button
              type="button"
              onClick={() => navigate('/calendar')}
              className="flex items-center gap-2 px-4 py-2 text-gray-700 bg-gray-100 rounded-md hover:bg-gray-200"
            >
              <X className="w-4 h-4" />
              Cancel
            </button>
            <button
              type="submit"
              disabled={createMutation.isPending || updateMutation.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50"
            >
              <Save className="w-4 h-4" />
              {isEditMode ? 'Update Event' : 'Create Event'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default EventFormPage;
