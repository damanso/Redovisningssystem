import { Response } from 'express';
import * as auditService from '../services/auditService.js';
import { AuthRequest } from '../middleware/authenticate.js';
import { AuditLogFilter } from '../types/audit.types.js';

export const getAuditLogs = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const filter: AuditLogFilter = {
      company_id: req.query.company_id as string,
      action: req.query.action as any,
      entity_type: req.query.entity_type as any,
      entity_id: req.query.entity_id as string,
      status: req.query.status as any,
      start_date: req.query.start_date ? new Date(req.query.start_date as string) : undefined,
      end_date: req.query.end_date ? new Date(req.query.end_date as string) : undefined,
      limit: req.query.limit ? parseInt(req.query.limit as string) : 100,
      offset: req.query.offset ? parseInt(req.query.offset as string) : 0,
    };

    // If admin, can see all logs for their companies
    // Otherwise, only their own logs
    if (req.user?.role !== 'admin' && !filter.user_id) {
      filter.user_id = userId;
    }

    const logs = await auditService.getAuditLogs(filter);
    res.json(logs);
  } catch (error: any) {
    console.error('Get audit logs error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAuditLogById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const log = await auditService.getAuditLogById(id);

    if (!log) {
      return res.status(404).json({ error: 'Audit log not found' });
    }

    res.json(log);
  } catch (error: any) {
    console.error('Get audit log error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getEntityHistory = async (req: AuthRequest, res: Response) => {
  try {
    const { entityType, entityId } = req.params;
    const logs = await auditService.getEntityHistory(entityType as any, entityId);
    res.json(logs);
  } catch (error: any) {
    console.error('Get entity history error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getUserActivity = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    const limit = req.query.limit ? parseInt(req.query.limit as string) : 50;
    const logs = await auditService.getUserActivity(userId, limit);
    res.json(logs);
  } catch (error: any) {
    console.error('Get user activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getCompanyActivity = async (req: AuthRequest, res: Response) => {
  try {
    const { companyId } = req.params;
    const limit = req.query.limit ? parseInt(req.query.limit as string) : 100;
    const logs = await auditService.getCompanyActivity(companyId, limit);
    res.json(logs);
  } catch (error: any) {
    console.error('Get company activity error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getAuditStats = async (req: AuthRequest, res: Response) => {
  try {
    const companyId = req.query.company_id as string;
    const stats = await auditService.getAuditStats(companyId);
    res.json(stats);
  } catch (error: any) {
    console.error('Get audit stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
