/**
 * Employee Controller
 * REST API endpoints for employee management
 */

import { Request, Response } from 'express';
import { EmployeeService } from '../services/employeeService.js';
import type { CreateEmployeeDto, UpdateEmployeeDto, SalaryConfigurationDto } from '../types/employee.types.js';

export class EmployeeController {

  /**
   * Create new employee
   * POST /api/employees
   */
  static async createEmployee(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const data: CreateEmployeeDto = req.body;

      const employee = await EmployeeService.createEmployee(data, userId);

      res.status(201).json({
        success: true,
        data: employee,
        message: 'Employee created successfully'
      });
    } catch (error: any) {
      console.error('Error creating employee:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create employee'
      });
    }
  }

  /**
   * Get all employees
   * GET /api/employees
   */
  static async getEmployees(req: Request, res: Response): Promise<void> {
    try {
      const query = {
        companyId: req.query.companyId as string,
        isActive: req.query.isActive === 'true',
        department: req.query.department as string,
        employmentType: req.query.employmentType as any,
        search: req.query.search as string,
        page: parseInt(req.query.page as string) || 1,
        limit: parseInt(req.query.limit as string) || 50,
        sortBy: req.query.sortBy as string,
        sortOrder: req.query.sortOrder as 'asc' | 'desc'
      };

      const result = await EmployeeService.getEmployees(query);

      res.json({
        success: true,
        data: result.employees,
        meta: {
          total: result.total,
          page: query.page,
          limit: query.limit,
          totalPages: Math.ceil(result.total / query.limit)
        }
      });
    } catch (error: any) {
      console.error('Error getting employees:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get employees'
      });
    }
  }

  /**
   * Get employee by ID
   * GET /api/employees/:id
   */
  static async getEmployeeById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const employee = await EmployeeService.getEmployeeById(id);

      if (!employee) {
        res.status(404).json({
          success: false,
          error: 'Employee not found'
        });
        return;
      }

      res.json({
        success: true,
        data: employee
      });
    } catch (error: any) {
      console.error('Error getting employee:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get employee'
      });
    }
  }

  /**
   * Get employee with full configuration
   * GET /api/employees/:id/full
   */
  static async getEmployeeWithConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const employee = await EmployeeService.getEmployeeWithConfiguration(id);

      if (!employee) {
        res.status(404).json({
          success: false,
          error: 'Employee not found'
        });
        return;
      }

      res.json({
        success: true,
        data: employee
      });
    } catch (error: any) {
      console.error('Error getting employee configuration:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get employee configuration'
      });
    }
  }

  /**
   * Update employee
   * PUT /api/employees/:id
   */
  static async updateEmployee(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;
      const data: UpdateEmployeeDto = req.body;

      const employee = await EmployeeService.updateEmployee(id, data, userId);

      res.json({
        success: true,
        data: employee,
        message: 'Employee updated successfully'
      });
    } catch (error: any) {
      console.error('Error updating employee:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update employee'
      });
    }
  }

  /**
   * Delete employee (soft delete)
   * DELETE /api/employees/:id
   */
  static async deleteEmployee(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      await EmployeeService.deleteEmployee(id, userId);

      res.json({
        success: true,
        message: 'Employee deleted successfully'
      });
    } catch (error: any) {
      console.error('Error deleting employee:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to delete employee'
      });
    }
  }

  /**
   * Get or create salary configuration
   * GET /api/employees/:id/salary-configuration
   */
  static async getSalaryConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const config = await EmployeeService.getSalaryConfiguration(id);

      if (!config) {
        res.status(404).json({
          success: false,
          error: 'Salary configuration not found'
        });
        return;
      }

      res.json({
        success: true,
        data: config
      });
    } catch (error: any) {
      console.error('Error getting salary configuration:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get salary configuration'
      });
    }
  }

  /**
   * Update salary configuration
   * PUT /api/employees/:id/salary-configuration
   */
  static async updateSalaryConfiguration(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data: SalaryConfigurationDto = {
        ...req.body,
        employeeId: id
      };

      const config = await EmployeeService.updateSalaryConfiguration(id, data);

      res.json({
        success: true,
        data: config,
        message: 'Salary configuration updated successfully'
      });
    } catch (error: any) {
      console.error('Error updating salary configuration:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update salary configuration'
      });
    }
  }

  /**
   * Get employee statistics for company
   * GET /api/employees/statistics/:companyId
   */
  static async getEmployeeStatistics(req: Request, res: Response): Promise<void> {
    try {
      const { companyId } = req.params;
      const statistics = await EmployeeService.getEmployeeStatistics(companyId);

      res.json({
        success: true,
        data: statistics
      });
    } catch (error: any) {
      console.error('Error getting employee statistics:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get employee statistics'
      });
    }
  }
}

export default EmployeeController;
