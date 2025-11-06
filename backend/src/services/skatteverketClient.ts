/**
 * Skatteverket API Client
 *
 * This client provides integration with Skatteverket's API for VAT report submission.
 *
 * IMPORTANT: This is a placeholder implementation. To use the real Skatteverket API:
 * 1. Register your application with Skatteverket
 * 2. Obtain API credentials (certificate or API key)
 * 3. Update the configuration in .env file
 * 4. Replace the mock implementation with real API calls
 *
 * For more information: https://skatteverket.se/foretag/moms/momsdeklaration.4.html
 */

import axios, { AxiosInstance } from 'axios';
import { query } from '../config/database';
import {
  SkatteverketConfig,
  SkatteverketCredentials,
  SkatteverketVATSubmission,
  SkatteverketSubmissionResponse,
  SkatteverketSubmission,
  CreateSubmissionInput,
  UpdateSubmissionInput,
  SubmissionStatus,
  SubmissionMethod,
} from '../types/vat.types';
import { VATReport } from '../types/vat.types';

// ============================================================================
// CONFIGURATION
// ============================================================================

/**
 * Get Skatteverket configuration from environment
 */
const getConfig = (): SkatteverketConfig => {
  return {
    apiUrl: process.env.SKATTEVERKET_API_URL || 'https://api.skatteverket.se/test',
    testMode: process.env.SKATTEVERKET_TEST_MODE === 'true',
    certificatePath: process.env.SKATTEVERKET_CERTIFICATE_PATH,
    certificatePassword: process.env.SKATTEVERKET_CERTIFICATE_PASSWORD,
    apiKey: process.env.SKATTEVERKET_API_KEY,
    timeout: parseInt(process.env.SKATTEVERKET_TIMEOUT || '30000'),
  };
};

// ============================================================================
// SKATTEVERKET API CLIENT
// ============================================================================

class SkatteverketAPIClient {
  private config: SkatteverketConfig;
  private httpClient: AxiosInstance;

  constructor(config?: SkatteverketConfig) {
    this.config = config || getConfig();
    this.httpClient = axios.create({
      baseURL: this.config.apiUrl,
      timeout: this.config.timeout,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Submit VAT report to Skatteverket
   *
   * NOTE: This is a MOCK implementation. Replace with real API call when credentials are available.
   */
  async submitVATReport(
    submission: SkatteverketVATSubmission,
    credentials: SkatteverketCredentials
  ): Promise<SkatteverketSubmissionResponse> {
    // MOCK IMPLEMENTATION - Replace with real API call
    if (this.config.testMode) {
      console.log('[MOCK] Skatteverket VAT submission:', {
        organizationNumber: submission.organizationNumber,
        reportingYear: submission.reportingYear,
        reportingPeriod: submission.reportingPeriod,
        netVAT: submission.box49,
      });

      // Simulate API response
      return {
        success: true,
        requestId: `TEST-${Date.now()}`,
        status: 'accepted',
        message: 'VAT report submitted successfully (TEST MODE)',
        submissionDate: new Date().toISOString(),
        referenceNumber: `REF-${Date.now()}`,
      };
    }

    // REAL IMPLEMENTATION - Uncomment and modify when credentials are available
    /*
    try {
      const response = await this.httpClient.post('/moms/deklaration', {
        ...submission,
        organizationNumber: credentials.organizationNumber,
      }, {
        headers: {
          'Authorization': `Bearer ${credentials.apiKey}`,
          // Add certificate authentication headers if needed
        },
      });

      return {
        success: true,
        requestId: response.data.requestId,
        status: response.data.status,
        message: response.data.message,
        submissionDate: response.data.submissionDate,
        referenceNumber: response.data.referenceNumber,
      };
    } catch (error: any) {
      return {
        success: false,
        status: 'error',
        message: error.response?.data?.message || error.message,
        errors: error.response?.data?.errors || [],
      };
    }
    */

    throw new Error(
      'Skatteverket API integration requires valid credentials. ' +
      'Please contact Skatteverket to obtain API access and update the configuration.'
    );
  }

  /**
   * Check submission status
   *
   * NOTE: This is a MOCK implementation.
   */
  async getSubmissionStatus(requestId: string): Promise<SkatteverketSubmissionResponse> {
    if (this.config.testMode) {
      return {
        success: true,
        requestId,
        status: 'accepted',
        message: 'VAT report has been processed (TEST MODE)',
        submissionDate: new Date().toISOString(),
      };
    }

    // REAL IMPLEMENTATION - Uncomment when credentials are available
    /*
    const response = await this.httpClient.get(`/moms/deklaration/${requestId}`);
    return response.data;
    */

    throw new Error('Skatteverket API integration not configured');
  }

  /**
   * Validate organization number with Skatteverket
   */
  async validateOrganizationNumber(orgNumber: string): Promise<boolean> {
    // Basic format validation (Swedish org number: 10 digits, format XXXXXX-XXXX)
    const orgNumberRegex = /^\d{6}-?\d{4}$/;
    return orgNumberRegex.test(orgNumber);
  }
}

// Export singleton instance
export const skatteverketClient = new SkatteverketAPIClient();

// ============================================================================
// SUBMISSION MANAGEMENT (Database Operations)
// ============================================================================

/**
 * Create a submission record
 */
export const createSubmission = async (
  data: CreateSubmissionInput
): Promise<SkatteverketSubmission> => {
  const result = await query(
    `INSERT INTO skatteverket_submissions (
      vat_report_id, company_id, submission_method, status, submitted_by
    ) VALUES ($1, $2, $3, $4, $5)
    RETURNING *`,
    [
      data.vat_report_id,
      data.company_id,
      data.submission_method,
      SubmissionStatus.PENDING,
      data.submitted_by || null,
    ]
  );
  return result.rows[0];
};

/**
 * Update submission record
 */
export const updateSubmission = async (
  submissionId: string,
  updates: UpdateSubmissionInput
): Promise<SkatteverketSubmission | null> => {
  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  if (updates.status !== undefined) {
    fields.push(`status = $${paramCount}`);
    values.push(updates.status);
    paramCount++;
  }

  if (updates.api_request_id !== undefined) {
    fields.push(`api_request_id = $${paramCount}`);
    values.push(updates.api_request_id);
    paramCount++;
  }

  if (updates.api_response_status !== undefined) {
    fields.push(`api_response_status = $${paramCount}`);
    values.push(updates.api_response_status);
    paramCount++;
  }

  if (updates.api_response_message !== undefined) {
    fields.push(`api_response_message = $${paramCount}`);
    values.push(updates.api_response_message);
    paramCount++;
  }

  if (updates.api_response_data !== undefined) {
    fields.push(`api_response_data = $${paramCount}`);
    values.push(JSON.stringify(updates.api_response_data));
    paramCount++;
  }

  if (fields.length === 0) {
    const result = await query('SELECT * FROM skatteverket_submissions WHERE id = $1', [
      submissionId,
    ]);
    return result.rows[0] || null;
  }

  values.push(submissionId);
  const result = await query(
    `UPDATE skatteverket_submissions SET ${fields.join(', ')}
     WHERE id = $${paramCount}
     RETURNING *`,
    values
  );

  return result.rows[0] || null;
};

/**
 * Get submissions for a VAT report
 */
export const getSubmissionsByReport = async (
  reportId: string
): Promise<SkatteverketSubmission[]> => {
  const result = await query(
    'SELECT * FROM skatteverket_submissions WHERE vat_report_id = $1 ORDER BY created_at DESC',
    [reportId]
  );
  return result.rows;
};

/**
 * Get submission by ID
 */
export const getSubmissionById = async (
  submissionId: string
): Promise<SkatteverketSubmission | null> => {
  const result = await query('SELECT * FROM skatteverket_submissions WHERE id = $1', [
    submissionId,
  ]);
  return result.rows[0] || null;
};

// ============================================================================
// VAT REPORT SUBMISSION WORKFLOW
// ============================================================================

/**
 * Submit VAT report to Skatteverket
 * This creates a submission record and attempts to send to Skatteverket API
 */
export const submitVATReportToSkatteverket = async (
  report: VATReport,
  companyId: string,
  userId: string,
  credentials: SkatteverketCredentials
): Promise<SkatteverketSubmission> => {
  // Create submission record
  const submission = await createSubmission({
    vat_report_id: report.id,
    company_id: companyId,
    submission_method: SubmissionMethod.API,
    submitted_by: userId,
  });

  try {
    // Extract period information
    const periodStart = new Date(report.period_start);
    const reportingYear = periodStart.getFullYear();
    const reportingPeriod = periodStart.getMonth() + 1; // 1-12 for monthly

    // Build Skatteverket submission payload
    const payload: SkatteverketVATSubmission = {
      organizationNumber: credentials.organizationNumber,
      companyName: '', // Should be fetched from company table
      reportingYear,
      reportingPeriod,
      periodType: 'M', // Monthly - could be derived from tax_period
      box05: report.outgoing_vat_25,
      box06: report.outgoing_vat_12,
      box07: report.outgoing_vat_6,
      box10: report.outgoing_vat_0,
      box48: report.incoming_vat,
      box49: report.net_vat_amount,
      declarationType: 'ordinarie',
    };

    // Submit to Skatteverket
    const response = await skatteverketClient.submitVATReport(payload, credentials);

    // Update submission with response
    await updateSubmission(submission.id, {
      status: response.success ? SubmissionStatus.ACCEPTED : SubmissionStatus.REJECTED,
      api_request_id: response.requestId,
      api_response_status: response.status,
      api_response_message: response.message,
      api_response_data: response,
    });

    return (await getSubmissionById(submission.id))!;
  } catch (error: any) {
    // Update submission with error
    await updateSubmission(submission.id, {
      status: SubmissionStatus.FAILED,
      api_response_message: error.message,
    });

    throw error;
  }
};

/**
 * Export VAT report for manual submission
 * Generates a file that can be manually uploaded to Skatteverket
 */
export const exportVATReportForManualSubmission = async (
  report: VATReport,
  format: 'json' | 'xml' = 'json'
): Promise<{ content: string; filename: string }> => {
  const periodStart = new Date(report.period_start);
  const reportingYear = periodStart.getFullYear();
  const reportingPeriod = periodStart.getMonth() + 1;

  const data: SkatteverketVATSubmission = {
    organizationNumber: '', // Should be fetched from company
    companyName: '',
    reportingYear,
    reportingPeriod,
    periodType: 'M',
    box05: report.outgoing_vat_25,
    box06: report.outgoing_vat_12,
    box07: report.outgoing_vat_6,
    box10: report.outgoing_vat_0,
    box48: report.incoming_vat,
    box49: report.net_vat_amount,
    declarationType: 'ordinarie',
  };

  if (format === 'json') {
    return {
      content: JSON.stringify(data, null, 2),
      filename: `vat-report-${report.report_number}.json`,
    };
  }

  // XML format (simplified - should follow Skatteverket XML schema)
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<MomsDeklaration>
  <Organisationsnummer>${data.organizationNumber}</Organisationsnummer>
  <Period>
    <År>${data.reportingYear}</År>
    <Period>${data.reportingPeriod}</Period>
  </Period>
  <Belopp>
    <Ruta05>${data.box05}</Ruta05>
    <Ruta06>${data.box06}</Ruta06>
    <Ruta07>${data.box07}</Ruta07>
    <Ruta10>${data.box10}</Ruta10>
    <Ruta48>${data.box48}</Ruta48>
    <Ruta49>${data.box49}</Ruta49>
  </Belopp>
</MomsDeklaration>`;

  return {
    content: xml,
    filename: `vat-report-${report.report_number}.xml`,
  };
};
