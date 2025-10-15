import { Response } from 'express';
import * as supplierService from '../services/supplierService.js';
import { CreateSupplierDto, UpdateSupplierDto } from '../types/supplier.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

export const createSupplier = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const data: CreateSupplierDto = req.body;
    const supplier = await supplierService.createSupplier(company_id, userId, data);

    res.status(201).json(supplier);
  } catch (error: any) {
    console.error('Create supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSuppliers = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, search, is_active, tags, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await supplierService.getSuppliers(company_id as string, {
      search: search as string,
      is_active: is_active === 'true',
      tags: tags ? (tags as string).split(',') : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get suppliers error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSupplierById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const supplier = await supplierService.getSupplierById(id, company_id as string);

    if (!supplier) {
      return res.status(404).json({ error: 'Supplier not found' });
    }

    res.json(supplier);
  } catch (error: any) {
    console.error('Get supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateSupplier = async (req: AuthRequest, res: Response) => {
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

    const supplier = await supplierService.updateSupplier(
      id,
      company_id,
      userId,
      updates as UpdateSupplierDto
    );

    res.json(supplier);
  } catch (error: any) {
    if (error.message === 'Supplier not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteSupplier = async (req: AuthRequest, res: Response) => {
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

    await supplierService.deleteSupplier(id, company_id, userId);
    res.json({ message: 'Supplier deactivated successfully' });
  } catch (error: any) {
    console.error('Delete supplier error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Supplier Contacts
export const addSupplierContact = async (req: AuthRequest, res: Response) => {
  try {
    const contact = await supplierService.addSupplierContact(req.body);
    res.status(201).json(contact);
  } catch (error: any) {
    console.error('Add supplier contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSupplierContacts = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const contacts = await supplierService.getSupplierContacts(id);
    res.json(contacts);
  } catch (error: any) {
    console.error('Get supplier contacts error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteSupplierContact = async (req: AuthRequest, res: Response) => {
  try {
    const { contactId } = req.params;
    await supplierService.deleteSupplierContact(contactId);
    res.json({ message: 'Contact deleted successfully' });
  } catch (error: any) {
    console.error('Delete supplier contact error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Supplier Notes
export const addSupplierNote = async (req: AuthRequest, res: Response) => {
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

    const supplierNote = await supplierService.addSupplierNote(id, userId, note);
    res.status(201).json(supplierNote);
  } catch (error: any) {
    console.error('Add supplier note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getSupplierNotes = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const notes = await supplierService.getSupplierNotes(id);
    res.json(notes);
  } catch (error: any) {
    console.error('Get supplier notes error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteSupplierNote = async (req: AuthRequest, res: Response) => {
  try {
    const { noteId } = req.params;
    await supplierService.deleteSupplierNote(noteId);
    res.json({ message: 'Note deleted successfully' });
  } catch (error: any) {
    console.error('Delete supplier note error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// Statistics
export const getSupplierStats = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const stats = await supplierService.getSupplierStats(company_id as string);
    res.json(stats);
  } catch (error: any) {
    console.error('Get supplier stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
