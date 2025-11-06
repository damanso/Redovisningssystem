/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Controller
 */

import { Request, Response } from 'express';
import * as companyGroupService from '../services/companyGroupService';
import { CreateCompanyGroupDto, UpdateCompanyGroupDto } from '../types/companyGroup.types';

/**
 * Create a new company group
 * POST /api/v1/company-groups
 */
export const createCompanyGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const data: CreateCompanyGroupDto = req.body;

    if (!data.name) {
      return res.status(400).json({ error: 'Name is required' });
    }

    const group = await companyGroupService.createCompanyGroup(userId, data);
    res.status(201).json(group);
  } catch (error: any) {
    console.error('Error creating company group:', error);
    res.status(500).json({ error: error.message || 'Failed to create company group' });
  }
};

/**
 * Get all company groups for current user
 * GET /api/v1/company-groups
 */
export const getCompanyGroups = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groups = await companyGroupService.getCompanyGroupsByUser(userId);
    res.json(groups);
  } catch (error: any) {
    console.error('Error fetching company groups:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch company groups' });
  }
};

/**
 * Get a specific company group by ID
 * GET /api/v1/company-groups/:id
 */
export const getCompanyGroupById = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groupId = req.params.id;
    const group = await companyGroupService.getCompanyGroupById(groupId, userId);

    if (!group) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json(group);
  } catch (error: any) {
    console.error('Error fetching company group:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch company group' });
  }
};

/**
 * Update a company group
 * PUT /api/v1/company-groups/:id
 */
export const updateCompanyGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groupId = req.params.id;
    const data: UpdateCompanyGroupDto = req.body;

    const group = await companyGroupService.updateCompanyGroup(groupId, userId, data);

    if (!group) {
      return res.status(404).json({ error: 'Group not found or no changes made' });
    }

    res.json(group);
  } catch (error: any) {
    console.error('Error updating company group:', error);
    res.status(500).json({ error: error.message || 'Failed to update company group' });
  }
};

/**
 * Delete a company group
 * DELETE /api/v1/company-groups/:id
 */
export const deleteCompanyGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groupId = req.params.id;
    const success = await companyGroupService.deleteCompanyGroup(groupId, userId);

    if (!success) {
      return res.status(404).json({ error: 'Group not found' });
    }

    res.json({ message: 'Company group deleted successfully' });
  } catch (error: any) {
    console.error('Error deleting company group:', error);
    res.status(500).json({ error: error.message || 'Failed to delete company group' });
  }
};

/**
 * Add a company to a group
 * POST /api/v1/company-groups/:id/companies
 */
export const addCompanyToGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groupId = req.params.id;
    const { company_id } = req.body;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const member = await companyGroupService.addCompanyToGroup(groupId, company_id, userId);
    res.status(201).json(member);
  } catch (error: any) {
    console.error('Error adding company to group:', error);
    res.status(500).json({ error: error.message || 'Failed to add company to group' });
  }
};

/**
 * Remove a company from a group
 * DELETE /api/v1/company-groups/:id/companies/:companyId
 */
export const removeCompanyFromGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groupId = req.params.id;
    const companyId = req.params.companyId;

    const success = await companyGroupService.removeCompanyFromGroup(groupId, companyId, userId);

    if (!success) {
      return res.status(404).json({ error: 'Company not found in group' });
    }

    res.json({ message: 'Company removed from group successfully' });
  } catch (error: any) {
    console.error('Error removing company from group:', error);
    res.status(500).json({ error: error.message || 'Failed to remove company from group' });
  }
};

/**
 * Get all companies in a group
 * GET /api/v1/company-groups/:id/companies
 */
export const getCompaniesInGroup = async (req: Request, res: Response) => {
  try {
    const userId = req.user?.id;
    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized' });
    }

    const groupId = req.params.id;
    const companies = await companyGroupService.getCompaniesInGroup(groupId, userId);

    res.json(companies);
  } catch (error: any) {
    console.error('Error fetching companies in group:', error);
    res.status(500).json({ error: error.message || 'Failed to fetch companies in group' });
  }
};
