import { Request, Response } from 'express';
import * as userService from '../services/userService.js';
import { UpdateUserDto, ChangePasswordDto } from '../types/user.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

export const getCurrentUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const user = await userService.getUserById(userId);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error: any) {
    console.error('Get current user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const user = await userService.getUserById(id);

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json(user);
  } catch (error: any) {
    console.error('Get user by ID error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAllUsers = async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.query;
    const users = await userService.getAllUsers(companyId as string);
    res.json(users);
  } catch (error: any) {
    console.error('Get all users error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateCurrentUser = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const updates: UpdateUserDto = req.body;
    const user = await userService.updateUser(userId, updates);

    res.json(user);
  } catch (error: any) {
    console.error('Update user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const changePassword = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const { current_password, new_password }: ChangePasswordDto = req.body;

    if (!current_password || !new_password) {
      return res.status(400).json({ error: 'Both passwords are required' });
    }

    if (new_password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    await userService.changePassword(userId, current_password, new_password);

    res.json({ message: 'Password changed successfully' });
  } catch (error: any) {
    if (error.message === 'Current password is incorrect') {
      return res.status(400).json({ error: error.message });
    }
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deactivateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await userService.deactivateUser(id);
    res.json({ message: 'User deactivated successfully' });
  } catch (error: any) {
    console.error('Deactivate user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const activateUser = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    await userService.activateUser(id);
    res.json({ message: 'User activated successfully' });
  } catch (error: any) {
    console.error('Activate user error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
