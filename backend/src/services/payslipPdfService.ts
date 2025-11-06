/**
 * Payslip PDF Generation Service
 * Generates professional Swedish payslips (lönespecifikationer) in PDF format
 */

import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import type { PayslipWithDetails } from '../types/salary.types.js';

export class PayslipPdfService {

  /**
   * Generate PDF for a payslip
   */
  static async generatePayslipPdf(
    payslipDetails: PayslipWithDetails,
    companyInfo: {
      name: string;
      orgNumber: string;
      address: string;
      postalCode: string;
      city: string;
    }
  ): Promise<string> {

    const { payslip, employee, employerContributions, salaryPeriod } = payslipDetails;

    // Create PDF directory if it doesn't exist
    const pdfDir = path.join(process.cwd(), 'uploads', 'payslips');
    if (!fs.existsSync(pdfDir)) {
      fs.mkdirSync(pdfDir, { recursive: true });
    }

    const filename = `payslip_${employee.id}_${salaryPeriod.id}_${Date.now()}.pdf`;
    const filepath = path.join(pdfDir, filename);

    return new Promise((resolve, reject) => {
      try {
        const doc = new PDFDocument({ size: 'A4', margin: 50 });
        const stream = fs.createWriteStream(filepath);

        doc.pipe(stream);

        // Header
        doc.fontSize(20).text('LÖNESPECIFIKATION', { align: 'center' });
        doc.moveDown();

        // Company info (left)
        doc.fontSize(10);
        doc.text(companyInfo.name, 50, 100);
        doc.text(`Org.nr: ${companyInfo.orgNumber}`);
        doc.text(companyInfo.address);
        doc.text(`${companyInfo.postalCode} ${companyInfo.city}`);

        // Employee info (right)
        doc.text(`${employee.firstName} ${employee.lastName}`, 350, 100);
        doc.text(`Personnummer: ${employee.personalNumber}`);
        doc.text(`Befattning: ${employee.position}`);
        if (employee.department) {
          doc.text(`Avdelning: ${employee.department}`);
        }

        doc.moveDown(2);

        // Period info
        doc.fontSize(12).text(`Löneperiod: ${salaryPeriod.periodName}`, 50);
        doc.text(`Utbetalningsdatum: ${this.formatDate(salaryPeriod.paymentDate)}`);
        doc.moveDown();

        // Draw line
        doc.strokeColor('#000000').lineWidth(1);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown();

        // Income section
        doc.fontSize(12).text('INKOMSTER', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);

        this.addLine(doc, 'Grundlön', payslip.baseSalary);
        if (payslip.overtimePay > 0) {
          this.addLine(doc, `Övertid (${payslip.overtimeHours} tim)`, payslip.overtimePay);
        }
        if (payslip.bonus > 0) {
          this.addLine(doc, 'Bonus', payslip.bonus);
        }
        if (payslip.commission > 0) {
          this.addLine(doc, 'Provision', payslip.commission);
        }
        if (payslip.vacationPay > 0) {
          this.addLine(doc, 'Semesterlön', payslip.vacationPay);
        }
        if (payslip.otherCompensation > 0) {
          this.addLine(doc, 'Övrig ersättning', payslip.otherCompensation);
        }

        doc.moveDown(0.5);

        // Benefits section
        if (payslip.totalBenefits > 0) {
          doc.fontSize(12).text('FÖRMÅNER', { underline: true });
          doc.moveDown(0.5);
          doc.fontSize(10);

          if (payslip.carBenefit > 0) {
            this.addLine(doc, 'Bilförmån', payslip.carBenefit);
          }
          if (payslip.housingBenefit > 0) {
            this.addLine(doc, 'Bostadsförmån', payslip.housingBenefit);
          }
          if (payslip.otherBenefits > 0) {
            this.addLine(doc, 'Övriga förmåner', payslip.otherBenefits);
          }

          doc.moveDown(0.5);
        }

        // Gross salary
        doc.fontSize(12);
        this.addLine(doc, 'BRUTTOLÖN', payslip.totalGrossSalary, true);
        doc.moveDown();

        // Deductions section
        doc.fontSize(12).text('AVDRAG', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);

        this.addLine(doc, 'Preliminärskatt', -payslip.preliminaryTax);
        if (payslip.vacationDeduction > 0) {
          this.addLine(doc, 'Semesteruttag', -payslip.vacationDeduction);
        }
        if (payslip.unionFee > 0) {
          this.addLine(doc, 'Fackavgift', -payslip.unionFee);
        }
        if (payslip.unemploymentInsurance > 0) {
          this.addLine(doc, 'A-kassa', -payslip.unemploymentInsurance);
        }
        if (payslip.otherDeductions > 0) {
          this.addLine(doc, 'Övriga avdrag', -payslip.otherDeductions);
        }

        doc.moveDown();

        // Net salary - highlighted
        doc.strokeColor('#000000').lineWidth(2);
        doc.moveTo(50, doc.y).lineTo(550, doc.y).stroke();
        doc.moveDown(0.5);
        doc.fontSize(14);
        this.addLine(doc, 'ATT BETALA (NETTOLÖN)', payslip.netSalary, true);
        doc.strokeColor('#000000').lineWidth(2);
        doc.moveTo(50, doc.y + 5).lineTo(550, doc.y + 5).stroke();
        doc.moveDown(2);

        // Vacation info
        doc.fontSize(12).text('SEMESTERINFORMATION', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);

        this.addLine(doc, 'Intjänade semesterdagar denna period', payslip.vacationDaysEarned);
        this.addLine(doc, 'Uttagna semesterdagar', payslip.vacationDaysTaken);
        this.addLine(doc, 'Återstående semesterdagar', payslip.vacationDaysBalance);
        this.addLine(doc, 'Semesterlöneskuld', payslip.vacationPayBalance);
        doc.moveDown();

        // Employer costs (new page if needed)
        if (doc.y > 650) {
          doc.addPage();
        }

        doc.fontSize(12).text('ARBETSGIVARENS KOSTNADER', { underline: true });
        doc.moveDown(0.5);
        doc.fontSize(10);

        this.addLine(doc, 'Bruttolön och förmåner', employerContributions.baseAmount);
        doc.moveDown(0.3);

        doc.fontSize(10).text('Socialavgifter:');
        this.addLine(doc, '  Sjukförsäkring (3.55%)', employerContributions.sicknessInsurance);
        this.addLine(doc, '  Föräldraförsäkring (2.60%)', employerContributions.parentalInsurance);
        this.addLine(doc, '  Ålderspension (10.21%)', employerContributions.oldAgePension);
        this.addLine(doc, '  Efterlevandepension (0.60%)', employerContributions.survivorPension);
        this.addLine(doc, '  Arbetsmarknadsavgift (2.64%)', employerContributions.laborMarketFee);
        this.addLine(doc, '  Arbetsskadeavgift (0.20%)', employerContributions.occupationalInjury);
        this.addLine(doc, '  Allmän löneavgift (11.62%)', employerContributions.generalWageTax);
        this.addLine(doc, 'Summa socialavgifter', employerContributions.totalSocialFees);
        doc.moveDown(0.3);

        if (employerContributions.totalPension > 0) {
          doc.text('Tjänstepension:');
          if (employerContributions.itp1Basic > 0) {
            this.addLine(doc, '  ITP1 (4.5%)', employerContributions.itp1Basic);
          }
          if (employerContributions.itp1High > 0) {
            this.addLine(doc, '  ITP1 hög (30%)', employerContributions.itp1High);
          }
          if (employerContributions.itpk > 0) {
            this.addLine(doc, '  ITPK (2%)', employerContributions.itpk);
          }
          if (employerContributions.customPension > 0) {
            this.addLine(doc, '  Övrig pension', employerContributions.customPension);
          }
          this.addLine(doc, 'Summa tjänstepension', employerContributions.totalPension);
          doc.moveDown(0.3);
        }

        doc.fontSize(12);
        this.addLine(doc, 'TOTAL ARBETSGIVARKOSTNAD', employerContributions.totalEmployerCost, true);

        // Footer
        doc.fontSize(8).text(
          `Detta är en automatiskt genererad lönespecifikation från ${companyInfo.name}`,
          50,
          750,
          { align: 'center' }
        );

        doc.end();

        stream.on('finish', () => {
          resolve(filepath);
        });

        stream.on('error', (error) => {
          reject(error);
        });

      } catch (error) {
        reject(error);
      }
    });
  }

  /**
   * Add a line with label and value
   */
  private static addLine(
    doc: PDFKit.PDFDocument,
    label: string,
    value: number | string,
    bold: boolean = false
  ): void {
    const y = doc.y;
    const fontSize = doc._fontSize;

    if (bold) {
      doc.font('Helvetica-Bold');
    }

    doc.text(label, 50, y);

    if (typeof value === 'number') {
      doc.text(this.formatCurrency(value), 400, y, { width: 150, align: 'right' });
    } else {
      doc.text(value, 400, y, { width: 150, align: 'right' });
    }

    if (bold) {
      doc.font('Helvetica');
    }

    doc.moveDown(0.5);
  }

  /**
   * Format currency (SEK)
   */
  private static formatCurrency(amount: number): string {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: 'SEK',
      minimumFractionDigits: 2,
      maximumFractionDigits: 2
    }).format(amount);
  }

  /**
   * Format date (Swedish format)
   */
  private static formatDate(date: Date): string {
    return new Intl.DateTimeFormat('sv-SE', {
      year: 'numeric',
      month: 'long',
      day: 'numeric'
    }).format(date);
  }
}

export default PayslipPdfService;
