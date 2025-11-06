import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Calendar, Plus, RefreshCw, Link, Unlink, Clock, MapPin } from 'lucide-react';
import {
  useCalendarEvents,
  useCalendarConnection,
  useDisconnectCalendar,
  useSyncFromGoogle,
  useDeleteEvent
} from '../../hooks/useCalendar';

const CalendarPage: React.FC = () => {
  const navigate = useNavigate();
  const [companyId, setCompanyId] = useState<string>(''); // In a real app, get from context/store

  // Fetch connection status
  const { data: connectionStatus, isLoading: connectionLoading } = useCalendarConnection(companyId);

  // Fetch events
  const { data: eventsData, isLoading: eventsLoading, refetch } = useCalendarEvents(companyId);

  // Mutations
  const disconnectMutation = useDisconnectCalendar();
  const syncMutation = useSyncFromGoogle();
  const deleteMutation = useDeleteEvent();

  const handleConnect = () => {
    // In a real implementation, this would redirect to OAuth flow
    window.location.href = `/api/v1/calendar/auth/url`;
  };

  const handleDisconnect = async () => {
    if (confirm('Are you sure you want to disconnect Google Calendar?')) {
      await disconnectMutation.mutateAsync(companyId);
    }
  };

  const handleSync = async () => {
    try {
      const result = await syncMutation.mutateAsync({ companyId });
      alert(`Synced ${result.synced_count} events successfully!`);
    } catch (error) {
      alert('Failed to sync events from Google Calendar');
    }
  };

  const handleDelete = async (eventId: string) => {
    if (confirm('Are you sure you want to delete this event?')) {
      await deleteMutation.mutateAsync({ id: eventId, companyId });
    }
  };

  const formatDateTime = (dateString: string) => {
    return new Date(dateString).toLocaleString('sv-SE', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    });
  };

  return (
    <div className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="bg-white rounded-lg shadow-sm p-6 mb-6">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Calendar className="w-8 h-8 text-blue-600" />
              <div>
                <h1 className="text-2xl font-bold text-gray-900">Calendar & Events</h1>
                <p className="text-sm text-gray-600">
                  Manage your events and sync with Google Calendar
                </p>
              </div>
            </div>

            <div className="flex items-center gap-3">
              {connectionStatus?.connected ? (
                <>
                  <button
                    onClick={handleSync}
                    disabled={syncMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-md hover:bg-green-700 disabled:opacity-50"
                  >
                    <RefreshCw className={`w-4 h-4 ${syncMutation.isPending ? 'animate-spin' : ''}`} />
                    Sync from Google
                  </button>
                  <button
                    onClick={handleDisconnect}
                    disabled={disconnectMutation.isPending}
                    className="flex items-center gap-2 px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 disabled:opacity-50"
                  >
                    <Unlink className="w-4 h-4" />
                    Disconnect
                  </button>
                </>
              ) : (
                <button
                  onClick={handleConnect}
                  className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                >
                  <Link className="w-4 h-4" />
                  Connect Google Calendar
                </button>
              )}

              <button
                onClick={() => navigate('/calendar/new')}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                New Event
              </button>
            </div>
          </div>
        </div>

        {/* Events List */}
        <div className="bg-white rounded-lg shadow-sm">
          <div className="p-6 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Upcoming Events</h2>
          </div>

          {eventsLoading ? (
            <div className="p-12 text-center text-gray-500">
              Loading events...
            </div>
          ) : !eventsData?.events || eventsData.events.length === 0 ? (
            <div className="p-12 text-center">
              <Calendar className="w-16 h-16 text-gray-300 mx-auto mb-4" />
              <p className="text-gray-500 mb-4">No events found</p>
              <button
                onClick={() => navigate('/calendar/new')}
                className="inline-flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-md hover:bg-indigo-700"
              >
                <Plus className="w-4 h-4" />
                Create your first event
              </button>
            </div>
          ) : (
            <div className="divide-y divide-gray-200">
              {eventsData.events.map((event) => (
                <div
                  key={event.id}
                  className="p-6 hover:bg-gray-50 transition-colors cursor-pointer"
                  onClick={() => navigate(`/calendar/events/${event.id}`)}
                >
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2 mb-2">
                        <h3 className="text-lg font-semibold text-gray-900">
                          {event.title}
                        </h3>
                        <span
                          className={`px-2 py-1 text-xs font-medium rounded-full ${
                            event.status === 'confirmed'
                              ? 'bg-green-100 text-green-800'
                              : event.status === 'cancelled'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {event.status}
                        </span>
                        {event.sync_to_google && (
                          <span className="px-2 py-1 text-xs font-medium rounded-full bg-blue-100 text-blue-800">
                            Synced to Google
                          </span>
                        )}
                      </div>

                      {event.description && (
                        <p className="text-sm text-gray-600 mb-3">{event.description}</p>
                      )}

                      <div className="flex flex-wrap gap-4 text-sm text-gray-500">
                        <div className="flex items-center gap-1">
                          <Clock className="w-4 h-4" />
                          <span>
                            {formatDateTime(event.start_time)} - {formatDateTime(event.end_time)}
                          </span>
                        </div>

                        {event.location && (
                          <div className="flex items-center gap-1">
                            <MapPin className="w-4 h-4" />
                            <span>{event.location}</span>
                          </div>
                        )}

                        {event.attendees && event.attendees.length > 0 && (
                          <div className="flex items-center gap-1">
                            <span>{event.attendees.length} attendees</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex gap-2 ml-4">
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          navigate(`/calendar/events/${event.id}/edit`);
                        }}
                        className="px-3 py-1 text-sm text-blue-600 hover:bg-blue-50 rounded-md"
                      >
                        Edit
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          handleDelete(event.id);
                        }}
                        disabled={deleteMutation.isPending}
                        className="px-3 py-1 text-sm text-red-600 hover:bg-red-50 rounded-md disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default CalendarPage;
