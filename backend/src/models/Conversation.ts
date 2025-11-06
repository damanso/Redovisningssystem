import { ObjectId } from 'mongodb';

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export interface Conversation {
  _id?: ObjectId;
  userId: number;
  companyId: number;
  title: string;
  messages: Message[];
  createdAt: Date;
  updatedAt: Date;
}

/**
 * Generate a title for a conversation based on the first user message
 */
export const generateConversationTitle = (firstMessage: string): string => {
  const maxLength = 50;
  const title = firstMessage.length > maxLength
    ? firstMessage.substring(0, maxLength) + '...'
    : firstMessage;
  return title;
};
