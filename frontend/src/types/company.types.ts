export interface Company {
  id: string;
  name: string;
  org_number: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  vat_number?: string;
  fiscal_year_start?: string;
  accounting_method?: 'accrual' | 'cash';
  currency?: string;
  logo_url?: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  user_role?: string;
}

export interface CreateCompanyDto {
  name: string;
  org_number: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  vat_number?: string;
  fiscal_year_start?: string;
  accounting_method?: 'accrual' | 'cash';
  currency?: string;
}

export interface UpdateCompanyDto {
  name?: string;
  address?: string;
  postal_code?: string;
  city?: string;
  country?: string;
  phone?: string;
  email?: string;
  website?: string;
  vat_number?: string;
  fiscal_year_start?: string;
  accounting_method?: 'accrual' | 'cash';
  currency?: string;
  logo_url?: string;
}

export interface CompanyUser {
  id: string;
  email: string;
  name: string;
  phone?: string;
  avatar_url?: string;
  user_role: string;
  company_role: string;
  joined_at: string;
}
