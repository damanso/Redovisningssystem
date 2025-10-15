import { Response } from 'express';
import * as companyService from '../services/companyService.js';
import { CreateCompanyDto, UpdateCompanyDto, AddUserToCompanyDto, UpdateUserCompanyRoleDto } from '../types/company.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

export const createCompany = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const data: CreateCompanyDto = req.body;

    // Validation
    if (!data.name || !data.org_number) {
      return res.status(400).json({ error: 'Name and organization number are required' });
    }

    const company = await companyService.createCompany(data, userId);
    res.status(201).json(company);
  } catch (error: any) {
    if (error.code === '23505') { // Unique violation
      return res.status(400).json({ error: 'Organization number already exists' });
    }
    console.error('Create company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCompanyById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has access to this company
    const role = await companyService.getUserCompanyRole(userId, id);
    if (!role) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    const company = await companyService.getCompanyById(id);
    if (!company) {
      return res.status(404).json({ error: 'Company not found' });
    }

    res.json({ ...company, user_role: role });
  } catch (error: any) {
    console.error('Get company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserCompanies = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const companies = await companyService.getCompaniesByUserId(userId);
    res.json(companies);
  } catch (error: any) {
    console.error('Get user companies error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has permission (owner or admin)
    const role = await companyService.getUserCompanyRole(userId, id);
    if (!role || !['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const updates: UpdateCompanyDto = req.body;
    const company = await companyService.updateCompany(id, updates);

    res.json(company);
  } catch (error: any) {
    console.error('Update company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deactivateCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Only owner can deactivate
    const role = await companyService.getUserCompanyRole(userId, id);
    if (role !== 'owner') {
      return res.status(403).json({ error: 'Only owner can deactivate company' });
    }

    await companyService.deactivateCompany(id);
    res.json({ message: 'Company deactivated successfully' });
  } catch (error: any) {
    console.error('Deactivate company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const addUserToCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has permission (owner or admin)
    const role = await companyService.getUserCompanyRole(userId, id);
    if (!role || !['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const data: AddUserToCompanyDto = req.body;
    if (!data.user_id || !data.role) {
      return res.status(400).json({ error: 'User ID and role are required' });
    }

    const userCompany = await companyService.addUserToCompany(id, data);
    res.status(201).json(userCompany);
  } catch (error: any) {
    console.error('Add user to company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const removeUserFromCompany = async (req: AuthRequest, res: Response) => {
  try {
    const { id, userId: targetUserId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has permission (owner or admin)
    const role = await companyService.getUserCompanyRole(userId, id);
    if (!role || !['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    // Cannot remove yourself if you're the only owner
    if (userId === targetUserId && role === 'owner') {
      const users = await companyService.getCompanyUsers(id);
      const owners = users.filter(u => u.company_role === 'owner');
      if (owners.length === 1) {
        return res.status(400).json({ error: 'Cannot remove the only owner' });
      }
    }

    await companyService.removeUserFromCompany(id, targetUserId);
    res.json({ message: 'User removed from company successfully' });
  } catch (error: any) {
    console.error('Remove user from company error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCompanyUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has access to this company
    const role = await companyService.getUserCompanyRole(userId, id);
    if (!role) {
      return res.status(403).json({ error: 'Access denied to this company' });
    }

    const users = await companyService.getCompanyUsers(id);
    res.json(users);
  } catch (error: any) {
    console.error('Get company users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateUserRole = async (req: AuthRequest, res: Response) => {
  try {
    const { id, userId: targetUserId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    // Check if user has permission (owner or admin)
    const role = await companyService.getUserCompanyRole(userId, id);
    if (!role || !['owner', 'admin'].includes(role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    const { role: newRole }: UpdateUserCompanyRoleDto = req.body;
    if (!newRole) {
      return res.status(400).json({ error: 'Role is required' });
    }

    const userCompany = await companyService.updateUserCompanyRole(id, targetUserId, newRole);
    res.json(userCompany);
  } catch (error: any) {
    console.error('Update user role error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
