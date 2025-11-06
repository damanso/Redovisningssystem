/**
 * Payslip Controller
 * REST API endpoints for payslip management
 */

import { Request, Response } from 'express';
import { PayslipService } from '../services/payslipService.js';
import { PayslipPdfService } from '../services/payslipPdfService.js';
import { EmployeeService } from '../services/employeeService.js';
import emailService from '../services/emailService.js';
import type { CreatePayslipDto, UpdatePayslipDto } from '../types/salary.types.js';
import fs from 'fs';

export class PayslipController {

  /**
   * Create new payslip
   * POST /api/payslips
   */
  static async createPayslip(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.id;
      const data: CreatePayslipDto = req.body;

      const payslip = await PayslipService.createPayslip(data, userId);

      res.status(201).json({
        success: true,
        data: payslip,
        message: 'Payslip created successfully'
      });
    } catch (error: any) {
      console.error('Error creating payslip:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to create payslip'
      });
    }
  }

  /**
   * Get payslip by ID
   * GET /api/payslips/:id
   */
  static async getPayslip(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const payslip = await PayslipService.getPayslip(id);

      if (!payslip) {
        res.status(404).json({
          success: false,
          error: 'Payslip not found'
        });
        return;
      }

      res.json({
        success: true,
        data: payslip
      });
    } catch (error: any) {
      console.error('Error getting payslip:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payslip'
      });
    }
  }

  /**
   * Get payslip with full details
   * GET /api/payslips/:id/details
   */
  static async getPayslipWithDetails(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const payslip = await PayslipService.getPayslipWithDetails(id);

      if (!payslip) {
        res.status(404).json({
          success: false,
          error: 'Payslip not found'
        });
        return;
      }

      res.json({
        success: true,
        data: payslip
      });
    } catch (error: any) {
      console.error('Error getting payslip details:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payslip details'
      });
    }
  }

  /**
   * Get all payslips for a salary period
   * GET /api/payslips/period/:periodId
   */
  static async getPayslipsForPeriod(req: Request, res: Response): Promise<void> {
    try {
      const { periodId } = req.params;
      const payslips = await PayslipService.getPayslipsForPeriod(periodId);

      res.json({
        success: true,
        data: payslips
      });
    } catch (error: any) {
      console.error('Error getting payslips for period:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payslips'
      });
    }
  }

  /**
   * Get all payslips for an employee
   * GET /api/payslips/employee/:employeeId
   */
  static async getPayslipsForEmployee(req: Request, res: Response): Promise<void> {
    try {
      const { employeeId } = req.params;
      const payslips = await PayslipService.getPayslipsForEmployee(employeeId);

      res.json({
        success: true,
        data: payslips
      });
    } catch (error: any) {
      console.error('Error getting payslips for employee:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to get payslips'
      });
    }
  }

  /**
   * Update payslip
   * PUT /api/payslips/:id
   */
  static async updatePayslip(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const data: UpdatePayslipDto = req.body;

      const payslip = await PayslipService.updatePayslip(id, data);

      res.json({
        success: true,
        data: payslip,
        message: 'Payslip updated successfully'
      });
    } catch (error: any) {
      console.error('Error updating payslip:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to update payslip'
      });
    }
  }

  /**
   * Approve payslip
   * POST /api/payslips/:id/approve
   */
  static async approvePayslip(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.id;

      const payslip = await PayslipService.approvePayslip(id, userId);

      res.json({
        success: true,
        data: payslip,
        message: 'Payslip approved successfully'
      });
    } catch (error: any) {
      console.error('Error approving payslip:', error);
      res.status(400).json({
        success: false,
        error: error.message || 'Failed to approve payslip'
      });
    }
  }

  /**
   * Generate PDF for payslip
   * GET /api/payslips/:id/pdf
   */
  static async generatePdf(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const payslipDetails = await PayslipService.getPayslipWithDetails(id);

      if (!payslipDetails) {
        res.status(404).json({
          success: false,
          error: 'Payslip not found'
        });
        return;
      }

      // Get company info (you'd typically get this from database)
      const companyInfo = {
        name: 'Företaget AB',
        orgNumber: '556000-0000',
        address: 'Företagsgatan 1',
        postalCode: '123 45',
        city: 'Stockholm'
      };

      const pdfPath = await PayslipPdfService.generatePayslipPdf(payslipDetails, companyInfo);

      // Update payslip with PDF path
      await PayslipService.updatePayslip(id, { pdfPath } as any);

      // Send file
      res.download(pdfPath, `lonespec_${payslipDetails.employee.lastName}_${Date.now()}.pdf`);

    } catch (error: any) {
      console.error('Error generating PDF:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to generate PDF'
      });
    }
  }

  /**
   * Send payslip via email
   * POST /api/payslips/:id/send
   */
  static async sendPayslipEmail(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const { email } = req.body;

      const payslipDetails = await PayslipService.getPayslipWithDetails(id);

      if (!payslipDetails) {
        res.status(404).json({
          success: false,
          error: 'Payslip not found'
        });
        return;
      }

      // Generate PDF if not exists
      let pdfPath = payslipDetails.payslip.pdfPath;
      if (!pdfPath || !fs.existsSync(pdfPath)) {
        const companyInfo = {
          name: 'Företaget AB',
          orgNumber: '556000-0000',
          address: 'Företagsgatan 1',
          postalCode: '123 45',
          city: 'Stockholm'
        };

        pdfPath = await PayslipPdfService.generatePayslipPdf(payslipDetails, companyInfo);
        await PayslipService.updatePayslip(id, { pdfPath } as any);
      }

      // Send email
      const recipientEmail = email || payslipDetails.employee.email;

      await emailService.sendEmail({
        to: recipientEmail,
        subject: `Lönespecifikation - ${payslipDetails.salaryPeriod.periodName}`,
        html: `
          <h2>Lönespecifikation</h2>
          <p>Hej ${payslipDetails.employee.firstName}!</p>
          <p>Bifogat finner du din lönespecifikation för ${payslipDetails.salaryPeriod.periodName}.</p>
          <p><strong>Nettolön att betala: ${payslipDetails.payslip.netSalary.toLocaleString('sv-SE')} SEK</strong></p>
          <p>Utbetalningsdatum: ${new Date(payslipDetails.salaryPeriod.paymentDate).toLocaleDateString('sv-SE')}</p>
          <br/>
          <p>Vänliga hälsningar,<br/>Lönesystemet</p>
        `,
        attachments: [{
          filename: `lonespec_${payslipDetails.salaryPeriod.periodName}.pdf`,
          path: pdfPath
        }]
      });

      // Mark as sent
      await PayslipService.markPayslipSent(id, recipientEmail);

      res.json({
        success: true,
        message: `Payslip sent to ${recipientEmail}`
      });

    } catch (error: any) {
      console.error('Error sending payslip email:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to send payslip email'
      });
    }
  }

  /**
   * Bulk send payslips for a period
   * POST /api/payslips/period/:periodId/send-all
   */
  static async sendAllPayslipsForPeriod(req: Request, res: Response): Promise<void> {
    try {
      const { periodId } = req.params;
      const payslips = await PayslipService.getPayslipsForPeriod(periodId);

      let successCount = 0;
      let errorCount = 0;

      for (const payslip of payslips) {
        try {
          const employee = await EmployeeService.getEmployeeById(payslip.employeeId);
          if (employee && employee.email) {
            // Trigger send for each payslip (reusing the sendPayslipEmail logic)
            await this.sendPayslipEmailInternal(payslip.id, employee.email);
            successCount++;
          }
        } catch (error) {
          console.error(`Error sending payslip ${payslip.id}:`, error);
          errorCount++;
        }
      }

      res.json({
        success: true,
        message: `Sent ${successCount} payslips successfully. ${errorCount} errors.`,
        data: { successCount, errorCount, total: payslips.length }
      });

    } catch (error: any) {
      console.error('Error sending payslips:', error);
      res.status(500).json({
        success: false,
        error: error.message || 'Failed to send payslips'
      });
    }
  }

  /**
   * Internal method to send payslip email
   */
  private static async sendPayslipEmailInternal(payslipId: string, email: string): Promise<void> {
    const payslipDetails = await PayslipService.getPayslipWithDetails(payslipId);
    if (!payslipDetails) return;

    let pdfPath = payslipDetails.payslip.pdfPath;
    if (!pdfPath || !fs.existsSync(pdfPath)) {
      const companyInfo = {
        name: 'Företaget AB',
        orgNumber: '556000-0000',
        address: 'Företagsgatan 1',
        postalCode: '123 45',
        city: 'Stockholm'
      };
      pdfPath = await PayslipPdfService.generatePayslipPdf(payslipDetails, companyInfo);
      await PayslipService.updatePayslip(payslipId, { pdfPath } as any);
    }

    await emailService.sendEmail({
      to: email,
      subject: `Lönespecifikation - ${payslipDetails.salaryPeriod.periodName}`,
      html: `
        <h2>Lönespecifikation</h2>
        <p>Hej ${payslipDetails.employee.firstName}!</p>
        <p>Bifogat finner du din lönespecifikation för ${payslipDetails.salaryPeriod.periodName}.</p>
        <p><strong>Nettolön att betala: ${payslipDetails.payslip.netSalary.toLocaleString('sv-SE')} SEK</strong></p>
        <br/>
        <p>Vänliga hälsningar,<br/>Lönesystemet</p>
      `,
      attachments: [{
        filename: `lonespec_${payslipDetails.salaryPeriod.periodName}.pdf`,
        path: pdfPath
      }]
    });

    await PayslipService.markPayslipSent(payslipId, email);
  }
}

export default PayslipController;
