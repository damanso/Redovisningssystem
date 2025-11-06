import { Request, Response } from 'express';
import * as projectService from '../services/projectService';
import {
  CreateProjectDto,
  UpdateProjectDto,
  CreateTimeEntryDto,
  UpdateTimeEntryDto,
  CreateProjectInvoiceDto
} from '../types/project.types';
import { AuthRequest } from '../middleware/authenticate';

// ==================== PROJECT CONTROLLERS ====================

export const createProject = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data: CreateProjectDto = req.body;
    const project = await projectService.createProject(company_id, userId, data);

    res.status(201).json(project);
  } catch (error: any) {
    console.error('Create project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProjects = async (req: Request, res: Response) => {
  try {
    const { company_id, search, status, customer_id, is_active, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await projectService.getProjects(company_id as string, {
      search: search as string,
      status: status as string,
      customer_id: customer_id as string,
      is_active: is_active === 'true' ? true : is_active === 'false' ? false : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get projects error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProjectById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const project = await projectService.getProjectById(id, company_id as string);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error: any) {
    console.error('Get project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id, ...updates } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const project = await projectService.updateProject(
      id,
      company_id,
      updates as UpdateProjectDto
    );

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error: any) {
    console.error('Update project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const success = await projectService.deleteProject(id, company_id);

    if (!success) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Delete project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deactivateProject = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const project = await projectService.deactivateProject(id, company_id);

    if (!project) {
      return res.status(404).json({ error: 'Project not found' });
    }

    res.json(project);
  } catch (error: any) {
    console.error('Deactivate project error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProjectSummary = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const summary = await projectService.getProjectSummary(id, company_id as string);
    res.json(summary);
  } catch (error: any) {
    console.error('Get project summary error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==================== TIME ENTRY CONTROLLERS ====================

export const createTimeEntry = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data: CreateTimeEntryDto = req.body;
    const timeEntry = await projectService.createTimeEntry(company_id, userId, data);

    res.status(201).json(timeEntry);
  } catch (error: any) {
    console.error('Create time entry error:', error);
    if (error.message === 'Project not found or access denied') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTimeEntries = async (req: Request, res: Response) => {
  try {
    const {
      company_id,
      project_id,
      user_id,
      start_date,
      end_date,
      is_billable,
      is_invoiced,
      limit,
      offset
    } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await projectService.getTimeEntries(company_id as string, {
      project_id: project_id as string,
      user_id: user_id as string,
      start_date: start_date as string,
      end_date: end_date as string,
      is_billable: is_billable === 'true' ? true : is_billable === 'false' ? false : undefined,
      is_invoiced: is_invoiced === 'true' ? true : is_invoiced === 'false' ? false : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get time entries error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getTimeEntryById = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const timeEntry = await projectService.getTimeEntryById(id, company_id as string);

    if (!timeEntry) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    res.json(timeEntry);
  } catch (error: any) {
    console.error('Get time entry error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateTimeEntry = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, ...updates } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const timeEntry = await projectService.updateTimeEntry(
      id,
      company_id,
      userId,
      updates as UpdateTimeEntryDto
    );

    if (!timeEntry) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    res.json(timeEntry);
  } catch (error: any) {
    console.error('Update time entry error:', error);
    if (error.message.includes('invoiced') || error.message.includes('another user')) {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteTimeEntry = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const success = await projectService.deleteTimeEntry(id, company_id, userId);

    if (!success) {
      return res.status(404).json({ error: 'Time entry not found' });
    }

    res.status(204).send();
  } catch (error: any) {
    console.error('Delete time entry error:', error);
    if (error.message.includes('invoiced') || error.message.includes('another user')) {
      return res.status(403).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

// ==================== PROJECT INVOICE CONTROLLERS ====================

export const createProjectInvoice = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId || !company_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const data: CreateProjectInvoiceDto = req.body;
    const projectInvoice = await projectService.createProjectInvoice(company_id, userId, data);

    res.status(201).json(projectInvoice);
  } catch (error: any) {
    console.error('Create project invoice error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getProjectInvoices = async (req: Request, res: Response) => {
  try {
    const { projectId } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const invoices = await projectService.getProjectInvoices(projectId, company_id as string);
    res.json(invoices);
  } catch (error: any) {
    console.error('Get project invoices error:', error);
    if (error.message === 'Project not found or access denied') {
      return res.status(404).json({ error: error.message });
    }
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const markTimeEntriesAsInvoiced = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, time_entry_ids, invoice_id } = req.body;

    if (!company_id || !time_entry_ids || !invoice_id) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    await projectService.markTimeEntriesAsInvoiced(
      time_entry_ids,
      invoice_id,
      company_id
    );

    res.status(200).json({ success: true });
  } catch (error: any) {
    console.error('Mark time entries as invoiced error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
