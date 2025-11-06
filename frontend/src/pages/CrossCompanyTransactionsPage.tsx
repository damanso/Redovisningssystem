/**
 * FAS 4.1: Multi-Company Management
 * Cross-Company Transactions Page
 */

import React, { useState } from 'react';
import { useCrossCompanyTransactions } from '../hooks/useCrossCompanyTransaction';
import { useCompanies } from '../hooks/useCompany';

const CrossCompanyTransactionsPage: React.FC = () => {
  const [filters, setFilters] = useState<{
    status?: 'pending' | 'approved' | 'completed' | 'cancelled';
  }>({});

  const { data: transactions = [], isLoading } = useCrossCompanyTransactions(filters);
  const { data: companies = [] } = useCompanies();

  const formatDate = (dateString: string) => {
    return new Date(dateString).toLocaleDateString('sv-SE');
  };

  const formatAmount = (amount: number, currency: string) => {
    return new Intl.NumberFormat('sv-SE', {
      style: 'currency',
      currency: currency || 'SEK'
    }).format(amount);
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10b981';
      case 'approved': return '#3b82f6';
      case 'pending': return '#f59e0b';
      case 'cancelled': return '#ef4444';
      default: return '#6b7280';
    }
  };

  if (isLoading) {
    return <div className="page-loading">Loading transactions...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Cross-Company Transactions</h1>
          <p>View and manage transactions between your companies</p>
        </div>
      </div>

      <div className="filters-card">
        <div className="filter-group">
          <label>Status</label>
          <select
            value={filters.status || ''}
            onChange={(e) => setFilters({ ...filters, status: e.target.value as any })}
          >
            <option value="">All Statuses</option>
            <option value="pending">Pending</option>
            <option value="approved">Approved</option>
            <option value="completed">Completed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>
      </div>

      <div className="transactions-list">
        {transactions.map((transaction) => (
          <div key={transaction.id} className="transaction-card">
            <div className="transaction-header">
              <div className="transaction-flow">
                <span className="company-name">{transaction.from_company_name}</span>
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <path
                    d="M4 10H16M16 10L12 6M16 10L12 14"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="company-name">{transaction.to_company_name}</span>
              </div>
              <span
                className="status-badge"
                style={{ backgroundColor: getStatusColor(transaction.status) }}
              >
                {transaction.status}
              </span>
            </div>
            <div className="transaction-body">
              <p className="transaction-description">{transaction.description}</p>
              <div className="transaction-details">
                <div className="detail-item">
                  <span className="detail-label">Type:</span>
                  <span className="detail-value">{transaction.transaction_type}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Date:</span>
                  <span className="detail-value">{formatDate(transaction.transaction_date)}</span>
                </div>
                <div className="detail-item">
                  <span className="detail-label">Amount:</span>
                  <span className="detail-value amount">
                    {formatAmount(transaction.amount, transaction.currency)}
                  </span>
                </div>
                {transaction.is_reconciled && (
                  <div className="detail-item">
                    <span className="reconciled-badge">✓ Reconciled</span>
                  </div>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>

      {transactions.length === 0 && (
        <div className="empty-state">
          <p>No cross-company transactions found</p>
        </div>
      )}

      <style>{`
        .page-container {
          padding: 24px;
          max-width: 1200px;
          margin: 0 auto;
        }

        .page-header {
          margin-bottom: 24px;
        }

        .page-header h1 {
          margin: 0 0 8px 0;
          font-size: 24px;
          font-weight: 600;
        }

        .page-header p {
          margin: 0;
          color: #6b7280;
        }

        .filters-card {
          background: white;
          border-radius: 8px;
          padding: 16px;
          margin-bottom: 24px;
          box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1);
        }

        .filter-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .filter-group label {
          font-size: 14px;
          font-weight: 500;
        }

        .filter-group select {
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          max-width: 200px;
        }

        .transactions-list {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .transaction-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 16px;
        }

        .transaction-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
          padding-bottom: 12px;
          border-bottom: 1px solid #e5e7eb;
        }

        .transaction-flow {
          display: flex;
          align-items: center;
          gap: 12px;
          color: #6b7280;
        }

        .company-name {
          font-weight: 600;
          color: #111827;
        }

        .status-badge {
          padding: 4px 12px;
          border-radius: 12px;
          font-size: 12px;
          font-weight: 500;
          color: white;
          text-transform: capitalize;
        }

        .transaction-body {
          display: flex;
          flex-direction: column;
          gap: 12px;
        }

        .transaction-description {
          margin: 0;
          color: #374151;
        }

        .transaction-details {
          display: flex;
          flex-wrap: wrap;
          gap: 16px;
        }

        .detail-item {
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .detail-label {
          font-size: 14px;
          color: #6b7280;
        }

        .detail-value {
          font-size: 14px;
          font-weight: 500;
          color: #111827;
          text-transform: capitalize;
        }

        .detail-value.amount {
          color: #059669;
        }

        .reconciled-badge {
          padding: 4px 8px;
          background: #d1fae5;
          color: #065f46;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }

        .empty-state {
          text-align: center;
          padding: 48px;
          color: #6b7280;
        }

        .page-loading {
          text-align: center;
          padding: 48px;
          color: #6b7280;
        }
      `}</style>
    </div>
  );
};

export default CrossCompanyTransactionsPage;
