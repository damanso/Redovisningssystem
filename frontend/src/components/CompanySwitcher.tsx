/**
 * FAS 4.1: Multi-Company Management
 * Company Switcher Component
 *
 * Dropdown component for switching between companies
 */

import React, { useState } from 'react';
import { useCompanyContext } from '../contexts/CompanyContext';

const CompanySwitcher: React.FC = () => {
  const { activeCompany, companies, switchCompany, isLoading } = useCompanyContext();
  const [isOpen, setIsOpen] = useState(false);

  const handleCompanySwitch = (companyId: string) => {
    switchCompany(companyId);
    setIsOpen(false);
  };

  if (isLoading) {
    return (
      <div className="company-switcher">
        <div className="company-switcher-button loading">
          Loading...
        </div>
      </div>
    );
  }

  if (!activeCompany) {
    return null;
  }

  return (
    <div className="company-switcher">
      <button
        className="company-switcher-button"
        onClick={() => setIsOpen(!isOpen)}
        aria-expanded={isOpen}
        aria-haspopup="true"
      >
        <div className="company-switcher-current">
          <div className="company-name">{activeCompany.name}</div>
          <div className="company-role">{activeCompany.user_role || 'Member'}</div>
        </div>
        <svg
          className={`company-switcher-icon ${isOpen ? 'open' : ''}`}
          width="20"
          height="20"
          viewBox="0 0 20 20"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M5 7.5L10 12.5L15 7.5"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>

      {isOpen && (
        <>
          <div
            className="company-switcher-overlay"
            onClick={() => setIsOpen(false)}
          />
          <div className="company-switcher-dropdown">
            <div className="company-switcher-header">
              <h3>Switch Company</h3>
              <p>{companies.length} {companies.length === 1 ? 'company' : 'companies'}</p>
            </div>
            <div className="company-switcher-list">
              {companies.map((company) => (
                <button
                  key={company.id}
                  className={`company-switcher-item ${
                    company.id === activeCompany.id ? 'active' : ''
                  }`}
                  onClick={() => handleCompanySwitch(company.id)}
                >
                  <div className="company-item-info">
                    <div className="company-item-name">{company.name}</div>
                    <div className="company-item-details">
                      <span className="company-item-role">
                        {company.user_role || 'Member'}
                      </span>
                      {company.org_number && (
                        <>
                          <span className="company-item-separator">•</span>
                          <span className="company-item-org">{company.org_number}</span>
                        </>
                      )}
                    </div>
                  </div>
                  {company.id === activeCompany.id && (
                    <svg
                      className="company-item-check"
                      width="20"
                      height="20"
                      viewBox="0 0 20 20"
                      fill="none"
                      xmlns="http://www.w3.org/2000/svg"
                    >
                      <path
                        d="M16.6667 5L7.5 14.1667L3.33334 10"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </button>
              ))}
            </div>
          </div>
        </>
      )}

      <style>{`
        .company-switcher {
          position: relative;
        }

        .company-switcher-button {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          padding: 8px 12px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          cursor: pointer;
          transition: all 0.2s;
          min-width: 200px;
        }

        .company-switcher-button:hover {
          background: #f9fafb;
          border-color: #d1d5db;
        }

        .company-switcher-button.loading {
          color: #9ca3af;
        }

        .company-switcher-current {
          display: flex;
          flex-direction: column;
          align-items: flex-start;
          gap: 2px;
        }

        .company-name {
          font-size: 14px;
          font-weight: 600;
          color: #111827;
        }

        .company-role {
          font-size: 12px;
          color: #6b7280;
          text-transform: capitalize;
        }

        .company-switcher-icon {
          transition: transform 0.2s;
          color: #6b7280;
        }

        .company-switcher-icon.open {
          transform: rotate(180deg);
        }

        .company-switcher-overlay {
          position: fixed;
          inset: 0;
          z-index: 40;
        }

        .company-switcher-dropdown {
          position: absolute;
          top: calc(100% + 8px);
          left: 0;
          min-width: 300px;
          background: white;
          border: 1px solid #e5e7eb;
          border-radius: 8px;
          box-shadow: 0 10px 15px -3px rgba(0, 0, 0, 0.1),
                      0 4px 6px -2px rgba(0, 0, 0, 0.05);
          z-index: 50;
          overflow: hidden;
        }

        .company-switcher-header {
          padding: 16px;
          border-bottom: 1px solid #e5e7eb;
        }

        .company-switcher-header h3 {
          margin: 0 0 4px 0;
          font-size: 16px;
          font-weight: 600;
          color: #111827;
        }

        .company-switcher-header p {
          margin: 0;
          font-size: 13px;
          color: #6b7280;
        }

        .company-switcher-list {
          max-height: 400px;
          overflow-y: auto;
        }

        .company-switcher-item {
          display: flex;
          align-items: center;
          justify-content: space-between;
          width: 100%;
          padding: 12px 16px;
          background: white;
          border: none;
          border-bottom: 1px solid #f3f4f6;
          cursor: pointer;
          transition: background 0.15s;
          text-align: left;
        }

        .company-switcher-item:last-child {
          border-bottom: none;
        }

        .company-switcher-item:hover {
          background: #f9fafb;
        }

        .company-switcher-item.active {
          background: #eff6ff;
        }

        .company-item-info {
          display: flex;
          flex-direction: column;
          gap: 4px;
        }

        .company-item-name {
          font-size: 14px;
          font-weight: 500;
          color: #111827;
        }

        .company-item-details {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: #6b7280;
        }

        .company-item-role {
          text-transform: capitalize;
        }

        .company-item-separator {
          color: #d1d5db;
        }

        .company-item-check {
          color: #3b82f6;
          flex-shrink: 0;
        }
      `}</style>
    </div>
  );
};

export default CompanySwitcher;
