export interface Article {
  id: string;
  company_id: string;
  name: string;
  description?: string;
  article_number?: string;
  price: number;
  unit: string;
  vat_rate: number;
  account_number?: number;
  category?: string;
  is_active: boolean;
  created_by: string;
  created_at: Date;
  updated_at: Date;
}

export interface CreateArticleDto {
  name: string;
  description?: string;
  article_number?: string;
  price: number;
  unit?: string;
  vat_rate: number;
  account_number?: number;
  category?: string;
}

export interface UpdateArticleDto extends Partial<CreateArticleDto> {
  is_active?: boolean;
}

export interface ArticleFilters {
  search?: string;
  category?: string;
  is_active?: boolean;
  limit?: number;
  offset?: number;
}

export interface ArticleListResponse {
  articles: Article[];
  total: number;
}
