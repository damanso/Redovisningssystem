/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Types (Frontend)
 */

export interface CompanyGroup {
  id: string;
  name: string;
  description?: string;
  color?: string;
  created_by: string;
  created_at: string;
  updated_at: string;
}

export interface CompanyGroupWithCompanies extends CompanyGroup {
  company_count: number;
  companies: Array<{
    company_id: string;
    company_name: string;
    added_at: string;
  }>;
}

export interface CreateCompanyGroupDto {
  name: string;
  description?: string;
  color?: string;
}

export interface UpdateCompanyGroupDto {
  name?: string;
  description?: string;
  color?: string;
}

export interface AddCompanyToGroupDto {
  company_id: string;
}
