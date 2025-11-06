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
  fiscal_year_start?: string; // MM-DD format
  accounting_method?: 'accrual' | 'cash';
  currency?: string;
  logo_url?: string;
  bank_account?: string;
  bank_clearing?: string;
  bank_name?: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
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
  bank_account?: string;
  bank_clearing?: string;
  bank_name?: string;
}

export interface UserCompany {
  user_id: string;
  company_id: string;
  role: 'owner' | 'admin' | 'accountant' | 'member' | 'viewer';
  created_at: Date;
}

export interface AddUserToCompanyDto {
  user_id: string;
  role: 'owner' | 'admin' | 'accountant' | 'member' | 'viewer';
}

export interface UpdateUserCompanyRoleDto {
  role: 'owner' | 'admin' | 'accountant' | 'member' | 'viewer';
}
