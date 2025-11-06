import { google } from 'googleapis';
import { OAuth2Client } from 'google-auth-library';
import pool from '../config/database.js';
import fs from 'fs/promises';
import path from 'path';

const SCOPES = ['https://www.googleapis.com/auth/drive.file'];

interface DriveCredentials {
  id: string;
  company_id: string;
  access_token: string;
  refresh_token: string;
  token_expiry: Date;
  root_folder_id: string | null;
  root_folder_name: string;
  is_active: boolean;
}

interface SyncResult {
  success: boolean;
  driveFileId?: string;
  driveFileName?: string;
  webViewLink?: string;
  error?: string;
}

class GoogleDriveService {
  /**
   * Get OAuth2 client configured with credentials
   */
  private getOAuth2Client(): OAuth2Client {
    const clientId = process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
    const redirectUri = process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/api/v1/integrations/google/callback';

    if (!clientId || !clientSecret) {
      throw new Error('Google OAuth credentials not configured');
    }

    return new google.auth.OAuth2(clientId, clientSecret, redirectUri);
  }

  /**
   * Generate OAuth2 authorization URL
   */
  async getAuthorizationUrl(companyId: string): Promise<string> {
    const oauth2Client = this.getOAuth2Client();

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: SCOPES,
      state: companyId, // Pass company ID in state for callback
      prompt: 'consent', // Force consent to get refresh token
    });

    return authUrl;
  }

  /**
   * Exchange authorization code for tokens and save credentials
   */
  async handleOAuthCallback(
    code: string,
    companyId: string,
    userId: string
  ): Promise<void> {
    const oauth2Client = this.getOAuth2Client();

    // Exchange code for tokens
    const { tokens } = await oauth2Client.getToken(code);

    if (!tokens.access_token || !tokens.refresh_token) {
      throw new Error('Failed to obtain access tokens');
    }

    const expiryDate = new Date(tokens.expiry_date || Date.now() + 3600 * 1000);

    // Save credentials to database
    const query = `
      INSERT INTO google_drive_credentials
        (company_id, access_token, refresh_token, token_expiry, scope, created_by)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (company_id)
      DO UPDATE SET
        access_token = EXCLUDED.access_token,
        refresh_token = EXCLUDED.refresh_token,
        token_expiry = EXCLUDED.token_expiry,
        scope = EXCLUDED.scope,
        is_active = true,
        updated_at = CURRENT_TIMESTAMP
      RETURNING id;
    `;

    await pool.query(query, [
      companyId,
      tokens.access_token,
      tokens.refresh_token,
      expiryDate,
      SCOPES.join(' '),
      userId,
    ]);

    // Create root folder in Google Drive
    await this.ensureRootFolder(companyId);
  }

  /**
   * Get credentials for a company
   */
  private async getCredentials(companyId: string): Promise<DriveCredentials | null> {
    const query = `
      SELECT id, company_id, access_token, refresh_token, token_expiry,
             root_folder_id, root_folder_name, is_active
      FROM google_drive_credentials
      WHERE company_id = $1 AND is_active = true;
    `;

    const result = await pool.query(query, [companyId]);

    if (result.rows.length === 0) {
      return null;
    }

    return result.rows[0];
  }

  /**
   * Get authenticated Drive client
   */
  private async getDriveClient(companyId: string) {
    const credentials = await this.getCredentials(companyId);

    if (!credentials) {
      throw new Error('Google Drive not connected for this company');
    }

    const oauth2Client = this.getOAuth2Client();

    // Set credentials
    oauth2Client.setCredentials({
      access_token: credentials.access_token,
      refresh_token: credentials.refresh_token,
      expiry_date: credentials.token_expiry.getTime(),
    });

    // Check if token needs refresh
    if (new Date() >= credentials.token_expiry) {
      const { credentials: newTokens } = await oauth2Client.refreshAccessToken();

      // Update database with new tokens
      await pool.query(
        `UPDATE google_drive_credentials
         SET access_token = $1, token_expiry = $2, updated_at = CURRENT_TIMESTAMP
         WHERE company_id = $3`,
        [newTokens.access_token, new Date(newTokens.expiry_date!), companyId]
      );

      oauth2Client.setCredentials(newTokens);
    }

    const drive = google.drive({ version: 'v3', auth: oauth2Client });

    return { drive, credentials };
  }

  /**
   * Ensure root folder exists in Google Drive
   */
  private async ensureRootFolder(companyId: string): Promise<string> {
    const { drive, credentials } = await this.getDriveClient(companyId);

    // Check if root folder already exists
    if (credentials.root_folder_id) {
      try {
        await drive.files.get({ fileId: credentials.root_folder_id });
        return credentials.root_folder_id;
      } catch (error) {
        // Folder doesn't exist, create new one
      }
    }

    // Create root folder
    const folderMetadata = {
      name: credentials.root_folder_name || 'Redovisning',
      mimeType: 'application/vnd.google-apps.folder',
    };

    const folder = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id, name',
    });

    const folderId = folder.data.id!;

    // Update database
    await pool.query(
      `UPDATE google_drive_credentials
       SET root_folder_id = $1, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = $2`,
      [folderId, companyId]
    );

    return folderId;
  }

  /**
   * Create or get subfolder in Drive
   */
  private async getOrCreateSubfolder(
    drive: any,
    parentFolderId: string,
    folderName: string
  ): Promise<string> {
    // Search for existing folder
    const query = `name='${folderName}' and '${parentFolderId}' in parents and mimeType='application/vnd.google-apps.folder' and trashed=false`;

    const searchResult = await drive.files.list({
      q: query,
      fields: 'files(id, name)',
      spaces: 'drive',
    });

    if (searchResult.data.files && searchResult.data.files.length > 0) {
      return searchResult.data.files[0].id;
    }

    // Create new subfolder
    const folderMetadata = {
      name: folderName,
      mimeType: 'application/vnd.google-apps.folder',
      parents: [parentFolderId],
    };

    const folder = await drive.files.create({
      requestBody: folderMetadata,
      fields: 'id',
    });

    return folder.data.id;
  }

  /**
   * Upload file to Google Drive
   */
  private async uploadFile(
    drive: any,
    filePath: string,
    fileName: string,
    mimeType: string,
    folderId: string
  ): Promise<{ fileId: string; webViewLink: string }> {
    const fileMetadata = {
      name: fileName,
      parents: [folderId],
    };

    const media = {
      mimeType: mimeType,
      body: await fs.readFile(filePath).then(buffer => {
        const { Readable } = require('stream');
        const stream = new Readable();
        stream.push(buffer);
        stream.push(null);
        return stream;
      }),
    };

    const file = await drive.files.create({
      requestBody: fileMetadata,
      media: media,
      fields: 'id, webViewLink',
    });

    return {
      fileId: file.data.id,
      webViewLink: file.data.webViewLink,
    };
  }

  /**
   * Sync invoice PDF to Google Drive
   */
  async syncInvoice(
    invoiceId: string,
    companyId: string,
    userId: string,
    pdfPath: string,
    invoiceNumber: string
  ): Promise<SyncResult> {
    try {
      const { drive, credentials } = await this.getDriveClient(companyId);

      // Ensure root folder exists
      const rootFolderId = await this.ensureRootFolder(companyId);

      // Get or create "Invoices" subfolder
      const invoicesFolderId = await this.getOrCreateSubfolder(
        drive,
        rootFolderId,
        'Fakturor'
      );

      // Generate filename
      const fileName = `Faktura_${invoiceNumber}.pdf`;

      // Check if already synced
      const existingSyncQuery = `
        SELECT id, drive_file_id
        FROM google_drive_sync
        WHERE document_type = 'invoice' AND document_id = $1
      `;
      const existingSync = await pool.query(existingSyncQuery, [invoiceId]);

      let driveFileId: string;
      let webViewLink: string;

      if (existingSync.rows.length > 0) {
        // Update existing file
        const existingFileId = existingSync.rows[0].drive_file_id;

        try {
          // Delete old file
          await drive.files.delete({ fileId: existingFileId });
        } catch (error) {
          // File might already be deleted, continue
        }

        // Upload new version
        const uploadResult = await this.uploadFile(
          drive,
          pdfPath,
          fileName,
          'application/pdf',
          invoicesFolderId
        );

        driveFileId = uploadResult.fileId;
        webViewLink = uploadResult.webViewLink;

        // Update sync record
        await pool.query(
          `UPDATE google_drive_sync
           SET drive_file_id = $1, drive_file_name = $2, web_view_link = $3,
               last_synced_at = CURRENT_TIMESTAMP, sync_status = 'synced',
               error_message = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [driveFileId, fileName, webViewLink, existingSync.rows[0].id]
        );
      } else {
        // Upload new file
        const uploadResult = await this.uploadFile(
          drive,
          pdfPath,
          fileName,
          'application/pdf',
          invoicesFolderId
        );

        driveFileId = uploadResult.fileId;
        webViewLink = uploadResult.webViewLink;

        // Get file size
        const stats = await fs.stat(pdfPath);

        // Create sync record
        await pool.query(
          `INSERT INTO google_drive_sync
            (company_id, document_type, document_id, drive_file_id, drive_file_name,
             drive_folder_id, file_size, mime_type, web_view_link, sync_status, created_by)
           VALUES ($1, 'invoice', $2, $3, $4, $5, $6, 'application/pdf', $7, 'synced', $8)`,
          [
            companyId,
            invoiceId,
            driveFileId,
            fileName,
            invoicesFolderId,
            stats.size,
            webViewLink,
            userId,
          ]
        );
      }

      return {
        success: true,
        driveFileId,
        driveFileName: fileName,
        webViewLink,
      };
    } catch (error: any) {
      console.error('Error syncing invoice to Google Drive:', error);

      // Log failed sync
      await pool.query(
        `INSERT INTO google_drive_sync
          (company_id, document_type, document_id, drive_file_id, drive_file_name,
           drive_folder_id, sync_status, error_message, created_by)
         VALUES ($1, 'invoice', $2, 'failed', $3, 'failed', 'failed', $4, $5)
         ON CONFLICT (document_type, document_id)
         DO UPDATE SET sync_status = 'failed', error_message = $4, updated_at = CURRENT_TIMESTAMP`,
        [companyId, invoiceId, `Faktura_${invoiceNumber}.pdf`, error.message, userId]
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Sync receipt to Google Drive
   */
  async syncReceipt(
    receiptId: string,
    companyId: string,
    userId: string,
    filePath: string,
    fileName: string,
    mimeType: string
  ): Promise<SyncResult> {
    try {
      const { drive, credentials } = await this.getDriveClient(companyId);

      // Ensure root folder exists
      const rootFolderId = await this.ensureRootFolder(companyId);

      // Get or create "Receipts" subfolder
      const receiptsFolderId = await this.getOrCreateSubfolder(
        drive,
        rootFolderId,
        'Kvitton'
      );

      // Check if already synced
      const existingSyncQuery = `
        SELECT id, drive_file_id
        FROM google_drive_sync
        WHERE document_type = 'receipt' AND document_id = $1
      `;
      const existingSync = await pool.query(existingSyncQuery, [receiptId]);

      let driveFileId: string;
      let webViewLink: string;

      if (existingSync.rows.length > 0) {
        // Update existing file
        const existingFileId = existingSync.rows[0].drive_file_id;

        try {
          await drive.files.delete({ fileId: existingFileId });
        } catch (error) {
          // Continue if file already deleted
        }

        // Upload new version
        const uploadResult = await this.uploadFile(
          drive,
          filePath,
          fileName,
          mimeType,
          receiptsFolderId
        );

        driveFileId = uploadResult.fileId;
        webViewLink = uploadResult.webViewLink;

        // Update sync record
        await pool.query(
          `UPDATE google_drive_sync
           SET drive_file_id = $1, drive_file_name = $2, web_view_link = $3,
               last_synced_at = CURRENT_TIMESTAMP, sync_status = 'synced',
               error_message = NULL, updated_at = CURRENT_TIMESTAMP
           WHERE id = $4`,
          [driveFileId, fileName, webViewLink, existingSync.rows[0].id]
        );
      } else {
        // Upload new file
        const uploadResult = await this.uploadFile(
          drive,
          filePath,
          fileName,
          mimeType,
          receiptsFolderId
        );

        driveFileId = uploadResult.fileId;
        webViewLink = uploadResult.webViewLink;

        // Get file size
        const stats = await fs.stat(filePath);

        // Create sync record
        await pool.query(
          `INSERT INTO google_drive_sync
            (company_id, document_type, document_id, drive_file_id, drive_file_name,
             drive_folder_id, file_size, mime_type, web_view_link, sync_status, created_by)
           VALUES ($1, 'receipt', $2, $3, $4, $5, $6, $7, $8, 'synced', $9)`,
          [
            companyId,
            receiptId,
            driveFileId,
            fileName,
            receiptsFolderId,
            stats.size,
            mimeType,
            webViewLink,
            userId,
          ]
        );
      }

      return {
        success: true,
        driveFileId,
        driveFileName: fileName,
        webViewLink,
      };
    } catch (error: any) {
      console.error('Error syncing receipt to Google Drive:', error);

      // Log failed sync
      await pool.query(
        `INSERT INTO google_drive_sync
          (company_id, document_type, document_id, drive_file_id, drive_file_name,
           drive_folder_id, sync_status, error_message, created_by)
         VALUES ($1, 'receipt', $2, 'failed', $3, 'failed', 'failed', $4, $5)
         ON CONFLICT (document_type, document_id)
         DO UPDATE SET sync_status = 'failed', error_message = $4, updated_at = CURRENT_TIMESTAMP`,
        [companyId, receiptId, fileName, error.message, userId]
      );

      return {
        success: false,
        error: error.message,
      };
    }
  }

  /**
   * Get sync status for a document
   */
  async getSyncStatus(documentType: string, documentId: string) {
    const query = `
      SELECT id, drive_file_id, drive_file_name, web_view_link,
             last_synced_at, sync_status, error_message
      FROM google_drive_sync
      WHERE document_type = $1 AND document_id = $2
    `;

    const result = await pool.query(query, [documentType, documentId]);

    return result.rows.length > 0 ? result.rows[0] : null;
  }

  /**
   * Check if company has Google Drive connected
   */
  async isConnected(companyId: string): Promise<boolean> {
    const credentials = await this.getCredentials(companyId);
    return credentials !== null && credentials.is_active;
  }

  /**
   * Disconnect Google Drive for a company
   */
  async disconnect(companyId: string): Promise<void> {
    await pool.query(
      `UPDATE google_drive_credentials
       SET is_active = false, updated_at = CURRENT_TIMESTAMP
       WHERE company_id = $1`,
      [companyId]
    );
  }

  /**
   * Get sync statistics for a company
   */
  async getSyncStats(companyId: string) {
    const query = `
      SELECT
        document_type,
        sync_status,
        COUNT(*) as count
      FROM google_drive_sync
      WHERE company_id = $1
      GROUP BY document_type, sync_status
    `;

    const result = await pool.query(query, [companyId]);

    return result.rows;
  }
}

export default new GoogleDriveService();
