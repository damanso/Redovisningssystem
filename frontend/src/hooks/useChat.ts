import { useState, useCallback } from 'react';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api/v1';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

interface Conversation {
  _id: string;
  userId: number;
  companyId: number;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

export const useChat = (companyId: number) => {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [currentConversation, setCurrentConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const getAuthHeaders = () => {
    const token = localStorage.getItem('token');
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    };
  };

  // Fetch all conversations
  const fetchConversations = useCallback(async () => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/chatbot/conversations?companyId=${companyId}`,
        {
          headers: getAuthHeaders()
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch conversations');
      }

      const data = await response.json();
      setConversations(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Fetch conversations error:', err);
    } finally {
      setIsLoading(false);
    }
  }, [companyId]);

  // Fetch single conversation
  const fetchConversation = useCallback(async (conversationId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/chatbot/conversations/${conversationId}`,
        {
          headers: getAuthHeaders()
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch conversation');
      }

      const data = await response.json();
      setCurrentConversation(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Fetch conversation error:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Create new conversation
  const createConversation = useCallback(async (message: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(`${API_URL}/chatbot/conversations`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          companyId,
          message
        })
      });

      if (!response.ok) {
        throw new Error('Failed to create conversation');
      }

      const data = await response.json();

      // Fetch the newly created conversation
      await fetchConversation(data.conversationId);
      await fetchConversations();

      return data.conversationId;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Create conversation error:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [companyId, fetchConversation, fetchConversations]);

  // Send message to existing conversation
  const sendMessage = useCallback(async (conversationId: string, message: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/chatbot/conversations/${conversationId}/messages`,
        {
          method: 'POST',
          headers: getAuthHeaders(),
          body: JSON.stringify({ message })
        }
      );

      if (!response.ok) {
        throw new Error('Failed to send message');
      }

      // Refresh current conversation
      await fetchConversation(conversationId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Send message error:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [fetchConversation]);

  // Delete conversation
  const deleteConversation = useCallback(async (conversationId: string) => {
    try {
      setIsLoading(true);
      setError(null);

      const response = await fetch(
        `${API_URL}/chatbot/conversations/${conversationId}`,
        {
          method: 'DELETE',
          headers: getAuthHeaders()
        }
      );

      if (!response.ok) {
        throw new Error('Failed to delete conversation');
      }

      // Refresh conversations list
      await fetchConversations();

      // Clear current conversation if it was deleted
      if (currentConversation?._id === conversationId) {
        setCurrentConversation(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
      console.error('Delete conversation error:', err);
      throw err;
    } finally {
      setIsLoading(false);
    }
  }, [currentConversation, fetchConversations]);

  return {
    conversations,
    currentConversation,
    isLoading,
    error,
    fetchConversations,
    fetchConversation,
    createConversation,
    sendMessage,
    deleteConversation
  };
};
