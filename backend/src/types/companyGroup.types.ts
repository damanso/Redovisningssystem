/**
 * FAS 4.1: Multi-Company Management
 * Company Groups Types
 */

export interface CompanyGroup {
  id: string;
  name: string;
  description?: string;
  color?: string; // Hex color code
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CompanyGroupWithCompanies extends CompanyGroup {
  company_count: number;
  companies: Array<{
    company_id: string;
    company_name: string;
    added_at: Date;
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

export interface CompanyGroupMember {
  group_id: string;
  company_id: string;
  added_at: Date;
  added_by: string;
}
