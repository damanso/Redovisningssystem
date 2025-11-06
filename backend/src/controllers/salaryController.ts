/**
 * Salary Controller
 * REST API endpoints for salary periods and calculations
 */

import { Request, Response } from 'express';
import { PayslipService } from '../services/payslipService.js';
import { VacationService } from '../services/vacationService.js';
import type { CreateSalaryPeriodDto, UpdateSalaryPeriodDto } from '../types/salary.types.js';

export class SalaryController {

  /**
   * Create new salary period
   * POST /api/salary/periods
   */
  static async createSalaryPeriod(req: Request, res: Response): Promise<void> {
    try {
      const data: CreateSalaryPeriodDto = req.body;
      const period = await PayslipService.createSalaryPeriod(data);

      res.status(201).json({
        success: true,
        data: period,
        message: 'Salary period created successfully'
      });
    } catch (error: any) {
      console.error('Error creating salary period:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create salary period'
      });
    }
  }

  /**
   * Get all salary periods for company
   * GET /api/salary/periods
   */
  static async getSalaryPeriods(req: Request, res: Response): Promise<void> {
    try {
      const companyId = req.query.companyId as string;
      if (!companyId) {
        res.status(400).json({
          success: false,
          error: 'Company ID is required'
        });
        return;
      }

      const periods = await PayslipService.getSalaryPeriods(companyId);

      res.json({
        success: true,
        data: periods
      });
    } catch (error: any) {
      console.error('Error getting salary periods:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get salary periods'
      });
    }
  }

  /**
   * Get salary period by ID
   * GET /api/salary/periods/:id
   */
  static async getSalaryPeriod(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const period = await PayslipService.getSalaryPeriod(id);

      if (!period) {
        res.status(404).json({
          success: false,
          error: 'Salary period not found'
        });
        return;
      }

      res.json({
        success: true,
        data: period
      });
    } catch (error: any) {
      console.error('Error getting salary period:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get salary period'
      });
    }
  }

  /**
   * Update salary period
   * PUT /api/salary/periods/:id
   */
  static async updateSalaryPeriod(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data: UpdateSalaryPeriodDto = req.body;

      const period = await PayslipService.updateSalaryPeriod(id, data);

      res.json({
        success: true,
        data: period,
        message: 'Salary period updated successfully'
      });
    } catch (error: any) {
      console.error('Error updating salary period:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update salary period'
      });
    }
  }

  /**
   * Generate payslips for all employees in period
   * POST /api/salary/periods/:id/generate
   */
  static async generatePayslipsForPeriod(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { companyId } = req.body;
      const userId = (req as any).user?.id;

      if (!companyId) {
        res.status(400).json({
          success: false,
          error: 'Company ID is required'
        });
        return;
      }

      const payslips = await PayslipService.generatePayslipsForPeriod(id, companyId, userId);

      res.json({
        success: true,
        data: payslips,
        message: `Generated ${payslips.length} payslips successfully`
      });
    } catch (error: any) {
      console.error('Error generating payslips:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate payslips'
      });
    }
  }

  /**
   * Get vacation balance for employee
   * GET /api/salary/vacation/:employeeId
   */
  static async getVacationBalance(req: Request, res: Response): Promise<void> {
    try {
      const { employeeId } = req.params;
      const balance = await VacationService.getCurrentVacationBalance(employeeId);

      res.json({
        success: true,
        data: balance
      });
    } catch (error: any) {
      console.error('Error getting vacation balance:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get vacation balance'
      });
    }
  }

  /**
   * Get vacation history for employee
   * GET /api/salary/vacation/:employeeId/history
   */
  static async getVacationHistory(req: Request, res: Response): Promise<void> {
    try {
      const { employeeId } = req.params;
      const history = await VacationService.getEmployeeVacationHistory(employeeId);

      res.json({
        success: true,
        data: history
      });
    } catch (error: any) {
      console.error('Error getting vacation history:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get vacation history'
      });
    }
  }

  /**
   * Calculate vacation compensation on termination
   * GET /api/salary/vacation/:employeeId/termination-compensation
   */
  static async calculateTerminationCompensation(req: Request, res: Response): Promise<void> {
    try {
      const { employeeId } = req.params;
      const compensation = await VacationService.calculateVacationCompensationOnTermination(employeeId);

      res.json({
        success: true,
        data: { compensation },
        message: `Vacation compensation: ${compensation} SEK`
      });
    } catch (error: any) {
      console.error('Error calculating termination compensation:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to calculate termination compensation'
      });
    }
  }
}

export default SalaryController;
