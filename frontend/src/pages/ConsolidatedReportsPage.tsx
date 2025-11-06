/**
 * FAS 4.1: Multi-Company Management
 * Consolidated Reports Page
 */

import React, { useState } from 'react';
import { useReportConfigs } from '../hooks/useConsolidatedReport';
import { useCompanies } from '../hooks/useCompany';

const ConsolidatedReportsPage: React.FC = () => {
  const { data: configs = [], isLoading } = useReportConfigs();
  const { data: companies = [] } = useCompanies();

  const [selectedConfig, setSelectedConfig] = useState<string | null>(null);

  const getReportTypeName = (type: string) => {
    switch (type) {
      case 'profit_loss': return 'Profit & Loss';
      case 'balance_sheet': return 'Balance Sheet';
      case 'cash_flow': return 'Cash Flow';
      case 'custom': return 'Custom';
      default: return type;
    }
  };

  if (isLoading) {
    return <div className="page-loading">Loading reports...</div>;
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1>Consolidated Reports</h1>
          <p>View reports across multiple companies</p>
        </div>
      </div>

      <div className="stats-grid">
        <div className="stat-card">
          <div className="stat-label">Total Companies</div>
          <div className="stat-value">{companies.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Saved Configurations</div>
          <div className="stat-value">{configs.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-label">Active Reports</div>
          <div className="stat-value">-</div>
        </div>
      </div>

      <div className="section">
        <h2>Report Configurations</h2>
        {configs.length > 0 ? (
          <div className="configs-list">
            {configs.map((config) => (
              <div key={config.id} className="config-card">
                <div className="config-header">
                  <h3>{config.name}</h3>
                  <span className="report-type-badge">
                    {getReportTypeName(config.report_type)}
                  </span>
                </div>
                {config.description && (
                  <p className="config-description">{config.description}</p>
                )}
                <div className="config-details">
                  <div className="config-detail">
                    <span className="detail-label">Companies:</span>
                    <span className="detail-value">{config.company_ids.length}</span>
                  </div>
                  {config.group_ids && config.group_ids.length > 0 && (
                    <div className="config-detail">
                      <span className="detail-label">Groups:</span>
                      <span className="detail-value">{config.group_ids.length}</span>
                    </div>
                  )}
                  <div className="config-detail">
                    <span className="detail-label">Currency:</span>
                    <span className="detail-value">{config.currency}</span>
                  </div>
                </div>
                <div className="config-actions">
                  <button className="btn-primary">Generate Report</button>
                  <button className="btn-secondary">Edit</button>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="empty-state">
            <p>No report configurations yet. Create your first configuration to get started!</p>
            <button className="btn-primary">Create Configuration</button>
          </div>
        )}
      </div>

      <div className="section">
        <h2>Quick Report</h2>
        <div className="quick-report-card">
          <p>Generate a quick report by selecting companies and report type</p>
          <div className="quick-report-form">
            <div className="form-group">
              <label>Select Companies</label>
              <select multiple style={{ height: '120px' }}>
                {companies.map((company) => (
                  <option key={company.id} value={company.id}>
                    {company.name}
                  </option>
                ))}
              </select>
              <small>Hold Ctrl/Cmd to select multiple companies</small>
            </div>
            <div className="form-group">
              <label>Report Type</label>
              <select>
                <option value="profit_loss">Profit & Loss</option>
                <option value="balance_sheet">Balance Sheet</option>
                <option value="cash_flow">Cash Flow</option>
                <option value="custom">Custom</option>
              </select>
            </div>
            <button className="btn-primary">Generate Report</button>
          </div>
        </div>
      </div>

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

        .stats-grid {
          display: grid;
          grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
          gap: 16px;
          margin-bottom: 32px;
        }

        .stat-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
        }

        .stat-label {
          font-size: 14px;
          color: #6b7280;
          margin-bottom: 8px;
        }

        .stat-value {
          font-size: 32px;
          font-weight: 600;
          color: #111827;
        }

        .section {
          margin-bottom: 32px;
        }

        .section h2 {
          margin: 0 0 16px 0;
          font-size: 18px;
          font-weight: 600;
        }

        .configs-list {
          display: grid;
          grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
          gap: 16px;
        }

        .config-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
        }

        .config-header {
          display: flex;
          justify-content: space-between;
          align-items: flex-start;
          margin-bottom: 8px;
        }

        .config-header h3 {
          margin: 0;
          font-size: 16px;
          font-weight: 600;
        }

        .report-type-badge {
          padding: 4px 8px;
          background: #eff6ff;
          color: #1e40af;
          border-radius: 4px;
          font-size: 12px;
          font-weight: 500;
        }

        .config-description {
          margin: 8px 0;
          font-size: 14px;
          color: #6b7280;
        }

        .config-details {
          display: flex;
          gap: 16px;
          margin: 12px 0;
          padding: 12px 0;
          border-top: 1px solid #e5e7eb;
          border-bottom: 1px solid #e5e7eb;
        }

        .config-detail {
          display: flex;
          gap: 6px;
          font-size: 14px;
        }

        .detail-label {
          color: #6b7280;
        }

        .detail-value {
          font-weight: 500;
          color: #111827;
        }

        .config-actions {
          display: flex;
          gap: 8px;
          margin-top: 16px;
        }

        .btn-primary {
          padding: 8px 16px;
          background: #3b82f6;
          color: white;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-primary:hover {
          background: #2563eb;
        }

        .btn-secondary {
          padding: 8px 16px;
          background: white;
          color: #374151;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
          font-weight: 500;
          cursor: pointer;
        }

        .btn-secondary:hover {
          background: #f9fafb;
        }

        .quick-report-card {
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          padding: 20px;
        }

        .quick-report-card > p {
          margin: 0 0 16px 0;
          color: #6b7280;
        }

        .quick-report-form {
          display: flex;
          flex-direction: column;
          gap: 16px;
        }

        .form-group {
          display: flex;
          flex-direction: column;
          gap: 6px;
        }

        .form-group label {
          font-size: 14px;
          font-weight: 500;
        }

        .form-group select {
          padding: 8px 12px;
          border: 1px solid #d1d5db;
          border-radius: 6px;
          font-size: 14px;
        }

        .form-group small {
          font-size: 12px;
          color: #6b7280;
        }

        .empty-state {
          text-align: center;
          padding: 48px;
          background: white;
          border-radius: 8px;
          border: 1px solid #e5e7eb;
        }

        .empty-state p {
          margin: 0 0 16px 0;
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

export default ConsolidatedReportsPage;
