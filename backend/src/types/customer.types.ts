export interface Customer {
  id: string;
  company_id: string;
  name: string;
  org_number?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country: string;
  payment_terms: number;
  discount_percentage?: number;
  currency: string;
  vat_number?: string;
  notes?: string;
  tags?: string[];
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateCustomerDto {
  name: string;
  org_number?: string;
  contact_person?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  website?: string;
  address_street?: string;
  address_postal_code?: string;
  address_city?: string;
  address_country?: string;
  payment_terms?: number;
  discount_percentage?: number;
  currency?: string;
  vat_number?: string;
  notes?: string;
  tags?: string[];
}

export interface UpdateCustomerDto extends Partial<CreateCustomerDto> {}

export interface CustomerContact {
  id: string;
  customer_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary: boolean;
  created_at: Date;
}

export interface CreateCustomerContactDto {
  customer_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary?: boolean;
}

export interface CustomerNote {
  id: string;
  customer_id: string;
  user_id: string;
  note: string;
  created_at: Date;
}

export interface CreateCustomerNoteDto {
  customer_id: string;
  note: string;
}

export interface CustomerFilters {
  search?: string;
  is_active?: boolean;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface CustomerListResponse {
  customers: Customer[];
  total: number;
}
