import { Request, Response } from 'express';
import { ObjectId } from 'mongodb';
import { getDB } from '../config/mongodb.js';
import { chatWithAssistant } from '../services/aiService.js';
import { Conversation, Message, generateConversationTitle } from '../models/Conversation.js';
import pool from '../config/database.js';

/**
 * Create a new conversation
 */
export const createConversation = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { companyId, message } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!companyId || !message) {
      res.status(400).json({ error: 'Company ID and message are required' });
      return;
    }

    // Verify user has access to company
    const companyCheck = await pool.query(
      'SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2',
      [userId, companyId]
    );

    if (companyCheck.rows.length === 0) {
      res.status(403).json({ error: 'Access denied to this company' });
      return;
    }

    // Get company context for AI
    const companyResult = await pool.query(
      'SELECT name, org_number, industry FROM companies WHERE id = $1',
      [companyId]
    );

    const company = companyResult.rows[0];

    // Get AI response
    const aiResponse = await chatWithAssistant(
      [{ role: 'user', content: message }],
      {
        name: company.name,
        orgNumber: company.org_number,
        industry: company.industry
      }
    );

    // Create conversation in MongoDB
    const db = getDB();
    const conversation: Conversation = {
      userId,
      companyId,
      title: generateConversationTitle(message),
      messages: [
        { role: 'user', content: message, timestamp: new Date() },
        { role: 'assistant', content: aiResponse, timestamp: new Date() }
      ],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    const result = await db.collection<Conversation>('conversations').insertOne(conversation);

    res.status(201).json({
      conversationId: result.insertedId,
      message: aiResponse
    });
  } catch (error) {
    console.error('Create conversation error:', error);
    res.status(500).json({
      error: 'Failed to create conversation',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Send a message to existing conversation
 */
export const sendMessage = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { conversationId } = req.params;
    const { message } = req.body;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!message) {
      res.status(400).json({ error: 'Message is required' });
      return;
    }

    // Get conversation
    const db = getDB();
    const conversation = await db.collection<Conversation>('conversations').findOne({
      _id: new ObjectId(conversationId),
      userId
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    // Get company context
    const companyResult = await pool.query(
      'SELECT name, org_number, industry FROM companies WHERE id = $1',
      [conversation.companyId]
    );

    const company = companyResult.rows[0];

    // Build conversation history for AI
    const conversationHistory = [
      ...conversation.messages.map(msg => ({
        role: msg.role,
        content: msg.content
      })),
      { role: 'user' as const, content: message }
    ];

    // Get AI response
    const aiResponse = await chatWithAssistant(
      conversationHistory,
      {
        name: company.name,
        orgNumber: company.org_number,
        industry: company.industry
      }
    );

    // Update conversation with new messages
    const newMessages: Message[] = [
      { role: 'user', content: message, timestamp: new Date() },
      { role: 'assistant', content: aiResponse, timestamp: new Date() }
    ];

    await db.collection<Conversation>('conversations').updateOne(
      { _id: new ObjectId(conversationId) },
      {
        $push: { messages: { $each: newMessages } },
        $set: { updatedAt: new Date() }
      }
    );

    res.status(200).json({
      message: aiResponse
    });
  } catch (error) {
    console.error('Send message error:', error);
    res.status(500).json({
      error: 'Failed to send message',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get all conversations for a user and company
 */
export const getConversations = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { companyId } = req.query;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    if (!companyId) {
      res.status(400).json({ error: 'Company ID is required' });
      return;
    }

    // Verify user has access to company
    const companyCheck = await pool.query(
      'SELECT id FROM user_companies WHERE user_id = $1 AND company_id = $2',
      [userId, parseInt(companyId as string)]
    );

    if (companyCheck.rows.length === 0) {
      res.status(403).json({ error: 'Access denied to this company' });
      return;
    }

    // Get conversations from MongoDB
    const db = getDB();
    const conversations = await db.collection<Conversation>('conversations')
      .find({
        userId,
        companyId: parseInt(companyId as string)
      })
      .sort({ updatedAt: -1 })
      .toArray();

    res.status(200).json(conversations);
  } catch (error) {
    console.error('Get conversations error:', error);
    res.status(500).json({
      error: 'Failed to get conversations',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Get a single conversation by ID
 */
export const getConversation = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { conversationId } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Get conversation
    const db = getDB();
    const conversation = await db.collection<Conversation>('conversations').findOne({
      _id: new ObjectId(conversationId),
      userId
    });

    if (!conversation) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.status(200).json(conversation);
  } catch (error) {
    console.error('Get conversation error:', error);
    res.status(500).json({
      error: 'Failed to get conversation',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};

/**
 * Delete a conversation
 */
export const deleteConversation = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.id;
    const { conversationId } = req.params;

    if (!userId) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    // Delete conversation
    const db = getDB();
    const result = await db.collection<Conversation>('conversations').deleteOne({
      _id: new ObjectId(conversationId),
      userId
    });

    if (result.deletedCount === 0) {
      res.status(404).json({ error: 'Conversation not found' });
      return;
    }

    res.status(200).json({ message: 'Conversation deleted successfully' });
  } catch (error) {
    console.error('Delete conversation error:', error);
    res.status(500).json({
      error: 'Failed to delete conversation',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
};
