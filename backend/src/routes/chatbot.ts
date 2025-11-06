import express from 'express';
import {
  createConversation,
  sendMessage,
  getConversations,
  getConversation,
  deleteConversation
} from '../controllers/chatbotController.js';
import { authenticateToken } from '../middleware/auth.js';

const router = express.Router();

// All chatbot routes require authentication
router.use(authenticateToken);

// Create new conversation
router.post('/conversations', createConversation);

// Get all conversations for a company
router.get('/conversations', getConversations);

// Get single conversation
router.get('/conversations/:conversationId', getConversation);

// Send message to conversation
router.post('/conversations/:conversationId/messages', sendMessage);

// Delete conversation
router.delete('/conversations/:conversationId', deleteConversation);

export default router;
