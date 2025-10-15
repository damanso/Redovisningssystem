export interface Supplier {
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
  category?: string; // Additional field for suppliers
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateSupplierDto {
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
  category?: string;
}

export interface UpdateSupplierDto extends Partial<CreateSupplierDto> {}

export interface SupplierContact {
  id: string;
  supplier_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary: boolean;
  created_at: Date;
}

export interface CreateSupplierContactDto {
  supplier_id: string;
  name: string;
  title?: string;
  email?: string;
  phone?: string;
  mobile?: string;
  is_primary?: boolean;
}

export interface SupplierNote {
  id: string;
  supplier_id: string;
  user_id: string;
  note: string;
  created_at: Date;
}

export interface CreateSupplierNoteDto {
  supplier_id: string;
  note: string;
}

export interface SupplierFilters {
  search?: string;
  is_active?: boolean;
  category?: string;
  tags?: string[];
  limit?: number;
  offset?: number;
}

export interface SupplierListResponse {
  suppliers: Supplier[];
  total: number;
}
