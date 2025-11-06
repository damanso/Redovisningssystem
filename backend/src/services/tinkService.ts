/**
 * Tink API Integration Service
 * Handles communication with Tink Open Banking API
 */

import axios, { AxiosInstance } from 'axios';
import {
  TinkAuthorizationRequest,
  TinkTokenRequest,
  TinkTokenResponse,
  TinkAccount,
  TinkTransaction,
} from '../types/bank.types';

class TinkService {
  private apiClient: AxiosInstance;
  private clientId: string;
  private clientSecret: string;
  private redirectUri: string;
  private baseUrl: string;

  constructor() {
    this.clientId = process.env.TINK_CLIENT_ID || '';
    this.clientSecret = process.env.TINK_CLIENT_SECRET || '';
    this.redirectUri = process.env.TINK_REDIRECT_URI || '';
    this.baseUrl = process.env.TINK_API_URL || 'https://api.tink.com';

    this.apiClient = axios.create({
      baseURL: this.baseUrl,
      timeout: 30000,
      headers: {
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Generate authorization URL for user to connect their bank
   */
  generateAuthorizationUrl(state?: string): string {
    if (!this.clientId) {
      throw new Error('Tink Client ID not configured');
    }

    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: this.redirectUri,
      scope: 'accounts:read,transactions:read',
      market: 'SE',
      locale: 'sv_SE',
      response_type: 'code',
    });

    if (state) {
      params.append('state', state);
    }

    return `${this.baseUrl}/link/1.0/authorize?${params.toString()}`;
  }

  /**
   * Exchange authorization code for access token
   */
  async exchangeAuthorizationCode(code: string): Promise<TinkTokenResponse> {
    try {
      const response = await this.apiClient.post<TinkTokenResponse>(
        '/api/v1/oauth/token',
        {
          code,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'authorization_code',
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('Tink token exchange error:', error.response?.data || error.message);
      throw new Error(`Failed to exchange authorization code: ${error.message}`);
    }
  }

  /**
   * Refresh access token using refresh token
   */
  async refreshAccessToken(refreshToken: string): Promise<TinkTokenResponse> {
    try {
      const response = await this.apiClient.post<TinkTokenResponse>(
        '/api/v1/oauth/token',
        {
          refresh_token: refreshToken,
          client_id: this.clientId,
          client_secret: this.clientSecret,
          grant_type: 'refresh_token',
        }
      );

      return response.data;
    } catch (error: any) {
      console.error('Tink token refresh error:', error.response?.data || error.message);
      throw new Error(`Failed to refresh access token: ${error.message}`);
    }
  }

  /**
   * Get accounts for a user
   */
  async getAccounts(accessToken: string): Promise<TinkAccount[]> {
    try {
      const response = await this.apiClient.get<{ accounts: TinkAccount[] }>(
        '/data/v2/accounts',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      return response.data.accounts || [];
    } catch (error: any) {
      console.error('Tink get accounts error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch accounts: ${error.message}`);
    }
  }

  /**
   * Get transactions for an account
   */
  async getTransactions(
    accessToken: string,
    accountId: string,
    fromDate?: Date,
    toDate?: Date
  ): Promise<TinkTransaction[]> {
    try {
      const params: any = {
        accountIdIn: accountId,
      };

      if (fromDate) {
        params.bookedDateGte = fromDate.toISOString().split('T')[0];
      }

      if (toDate) {
        params.bookedDateLte = toDate.toISOString().split('T')[0];
      }

      const response = await this.apiClient.get<{ transactions: TinkTransaction[] }>(
        '/data/v2/transactions',
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
          params,
        }
      );

      return response.data.transactions || [];
    } catch (error: any) {
      console.error('Tink get transactions error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch transactions: ${error.message}`);
    }
  }

  /**
   * Get account balance
   */
  async getAccountBalance(
    accessToken: string,
    accountId: string
  ): Promise<{ balance: number; availableBalance?: number }> {
    try {
      const response = await this.apiClient.get(`/data/v2/accounts/${accountId}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });

      const account = response.data;
      return {
        balance: account.balance || 0,
        availableBalance: account.availableBalance,
      };
    } catch (error: any) {
      console.error('Tink get balance error:', error.response?.data || error.message);
      throw new Error(`Failed to fetch account balance: ${error.message}`);
    }
  }

  /**
   * Revoke access token
   */
  async revokeAccess(accessToken: string): Promise<void> {
    try {
      await this.apiClient.post(
        '/api/v1/oauth/revoke',
        {
          token: accessToken,
        },
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );
    } catch (error: any) {
      console.error('Tink revoke access error:', error.response?.data || error.message);
      throw new Error(`Failed to revoke access: ${error.message}`);
    }
  }

  /**
   * Check if Tink is properly configured
   */
  isConfigured(): boolean {
    return !!(this.clientId && this.clientSecret && this.redirectUri);
  }

  /**
   * Validate access token
   */
  async validateToken(accessToken: string): Promise<boolean> {
    try {
      await this.apiClient.get('/api/v1/user', {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      });
      return true;
    } catch (error) {
      return false;
    }
  }
}

export default new TinkService();
