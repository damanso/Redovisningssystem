/**
 * FAS 4.1: Multi-Company Management
 * Company Context - Manages active company state
 */

import React, { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { Company } from '../types/company.types';
import { useCompanies } from '../hooks/useCompany';

interface CompanyContextType {
  activeCompany: Company | null;
  setActiveCompany: (company: Company | null) => void;
  companies: Company[];
  isLoading: boolean;
  switchCompany: (companyId: string) => void;
}

const CompanyContext = createContext<CompanyContextType | undefined>(undefined);

const ACTIVE_COMPANY_KEY = 'activeCompanyId';

interface CompanyProviderProps {
  children: ReactNode;
}

export const CompanyProvider: React.FC<CompanyProviderProps> = ({ children }) => {
  const [activeCompany, setActiveCompanyState] = useState<Company | null>(null);
  const { data: companies = [], isLoading } = useCompanies();

  // Load active company from localStorage on mount
  useEffect(() => {
    const savedCompanyId = localStorage.getItem(ACTIVE_COMPANY_KEY);
    if (savedCompanyId && companies.length > 0) {
      const company = companies.find((c) => c.id === savedCompanyId);
      if (company) {
        setActiveCompanyState(company);
      } else if (companies.length > 0) {
        // If saved company not found, default to first company
        setActiveCompanyState(companies[0]);
        localStorage.setItem(ACTIVE_COMPANY_KEY, companies[0].id);
      }
    } else if (companies.length > 0 && !activeCompany) {
      // No saved company, default to first
      setActiveCompanyState(companies[0]);
      localStorage.setItem(ACTIVE_COMPANY_KEY, companies[0].id);
    }
  }, [companies]);

  const setActiveCompany = (company: Company | null) => {
    setActiveCompanyState(company);
    if (company) {
      localStorage.setItem(ACTIVE_COMPANY_KEY, company.id);
    } else {
      localStorage.removeItem(ACTIVE_COMPANY_KEY);
    }
  };

  const switchCompany = (companyId: string) => {
    const company = companies.find((c) => c.id === companyId);
    if (company) {
      setActiveCompany(company);
    }
  };

  return (
    <CompanyContext.Provider
      value={{
        activeCompany,
        setActiveCompany,
        companies,
        isLoading,
        switchCompany
      }}
    >
      {children}
    </CompanyContext.Provider>
  );
};

export const useCompanyContext = (): CompanyContextType => {
  const context = useContext(CompanyContext);
  if (context === undefined) {
    throw new Error('useCompanyContext must be used within a CompanyProvider');
  }
  return context;
};
