import { Response } from 'express';
import * as customerService from '../services/customerService.js';
import { CreateCustomerDto, UpdateCustomerDto } from '../types/customer.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

export const createCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const data: CreateCustomerDto = req.body;
    const customer = await customerService.createCustomer(company_id, userId, data);

    res.status(201).json(customer);
  } catch (error: any) {
    console.error('Create customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomers = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, search, is_active, tags, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await customerService.getCustomers(company_id as string, {
      search: search as string,
      is_active: is_active === 'true',
      tags: tags ? (tags as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get customers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomerById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const customer = await customerService.getCustomerById(id, company_id as string);

    if (!customer) {
      return res.status(404).json({ error: 'Customer not found' });
    }

    res.json(customer);
  } catch (error: any) {
    console.error('Get customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, ...updates } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const customer = await customerService.updateCustomer(
      id,
      company_id,
      userId,
      updates as UpdateCustomerDto
    );

    res.json(customer);
  } catch (error: any) {
    if (error.message === 'Customer not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteCustomer = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await customerService.deleteCustomer(id, company_id, userId);
    res.json({ message: 'Customer deactivated successfully' });
  } catch (error: any) {
    console.error('Delete customer error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Customer Contacts
export const addCustomerContact = async (req: AuthRequest, res: Response) => {
  try {
    const contact = await customerService.addCustomerContact(req.body);
    res.status(201).json(contact);
  } catch (error: any) {
    console.error('Add customer contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomerContacts = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contacts = await customerService.getCustomerContacts(id);
    res.json(contacts);
  } catch (error: any) {
    console.error('Get customer contacts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteCustomerContact = async (req: AuthRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    await customerService.deleteCustomerContact(contactId);
    res.json({ message: 'Contact deleted successfully' });
  } catch (error: any) {
    console.error('Delete customer contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Customer Notes
export const addCustomerNote = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { note } = req.body;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!note) {
      return res.status(400).json({ error: 'note is required' });
    }

    const customerNote = await customerService.addCustomerNote(id, userId, note);
    res.status(201).json(customerNote);
  } catch (error: any) {
    console.error('Add customer note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCustomerNotes = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const notes = await customerService.getCustomerNotes(id);
    res.json(notes);
  } catch (error: any) {
    console.error('Get customer notes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteCustomerNote = async (req: AuthRequest, res: Response) => {
  try {
    const { noteId } = req.params;
    await customerService.deleteCustomerNote(noteId);
    res.json({ message: 'Note deleted successfully' });
  } catch (error: any) {
    console.error('Delete customer note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Statistics
export const getCustomerStats = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const stats = await customerService.getCustomerStats(company_id as string);
    res.json(stats);
  } catch (error: any) {
    console.error('Get customer stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
