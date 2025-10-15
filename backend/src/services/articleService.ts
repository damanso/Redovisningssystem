import { query } from '../config/database.js';
import {
  Article,
  CreateArticleDto,
  UpdateArticleDto,
  ArticleFilters,
  ArticleListResponse
} from '../types/article.types.js';
import * as auditService from './auditService.js';

// Article CRUD operations
export const createArticle = async (
  companyId: string,
  userId: string,
  data: CreateArticleDto
): Promise<Article> => {
  const result = await query(
    `INSERT INTO articles (
      company_id, name, description, article_number, price, unit,
      vat_rate, account_number, category, created_by
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
    RETURNING *`,
    [
      companyId,
      data.name,
      data.description || null,
      data.article_number || null,
      data.price,
      data.unit || 'st',
      data.vat_rate,
      data.account_number || null,
      data.category || null,
      userId
    ]
  );

  const article = result.rows[0];

  // Log action
  await auditService.logAction(userId, 'article.create', 'article', {
    companyId,
    entityId: article.id,
  });

  return article;
};

export const getArticles = async (
  companyId: string,
  filters?: ArticleFilters
): Promise<ArticleListResponse> => {
  let queryText = `
    SELECT * FROM articles
    WHERE company_id = $1
  `;

  const params: any[] = [companyId];
  let paramCount = 2;

  console.log('DEBUG getArticles: companyId =', companyId);
  console.log('DEBUG getArticles: filters =', JSON.stringify(filters));

  if (filters?.is_active !== undefined) {
    queryText += ` AND is_active = $${paramCount}`;
    params.push(filters.is_active);
    paramCount++;
  }

  if (filters?.search) {
    queryText += ` AND (name ILIKE $${paramCount} OR article_number ILIKE $${paramCount} OR description ILIKE $${paramCount})`;
    params.push(`%${filters.search}%`);
    paramCount++;
  }

  if (filters?.category) {
    queryText += ` AND category = $${paramCount}`;
    params.push(filters.category);
    paramCount++;
  }

  console.log('DEBUG getArticles: queryText =', queryText);
  console.log('DEBUG getArticles: params =', JSON.stringify(params));

  // Get total count
  const countResult = await query(queryText.replace('SELECT *', 'SELECT COUNT(*)'), params);
  const total = parseInt(countResult.rows[0].count);

  console.log('DEBUG getArticles: total =', total);

  // Add ordering and pagination
  queryText += ` ORDER BY name ASC`;

  if (filters?.limit) {
    queryText += ` LIMIT $${paramCount}`;
    params.push(filters.limit);
    paramCount++;
  }

  if (filters?.offset) {
    queryText += ` OFFSET $${paramCount}`;
    params.push(filters.offset);
  }

  const result = await query(queryText, params);

  console.log('DEBUG getArticles: result.rows.length =', result.rows.length);

  return {
    articles: result.rows,
    total
  };
};

export const getArticleById = async (
  articleId: string,
  companyId: string
): Promise<Article | null> => {
  const result = await query(
    'SELECT * FROM articles WHERE id = $1 AND company_id = $2',
    [articleId, companyId]
  );

  return result.rows[0] || null;
};

export const updateArticle = async (
  articleId: string,
  companyId: string,
  userId: string,
  updates: UpdateArticleDto
): Promise<Article> => {
  // Get current article for audit
  const before = await getArticleById(articleId, companyId);

  const fields: string[] = [];
  const values: any[] = [];
  let paramCount = 1;

  Object.entries(updates).forEach(([key, value]) => {
    if (value !== undefined) {
      fields.push(`${key} = $${paramCount}`);
      values.push(value);
      paramCount++;
    }
  });

  if (fields.length === 0) {
    throw new Error('No fields to update');
  }

  values.push(articleId, companyId);

  const result = await query(
    `UPDATE articles
     SET ${fields.join(', ')}, updated_at = CURRENT_TIMESTAMP
     WHERE id = $${paramCount} AND company_id = $${paramCount + 1}
     RETURNING *`,
    values
  );

  if (result.rows.length === 0) {
    throw new Error('Article not found');
  }

  const article = result.rows[0];

  // Log action with changes
  await auditService.logAction(userId, 'article.update', 'article', {
    companyId,
    entityId: article.id,
    changes: {
      before,
      after: article
    }
  });

  return article;
};

export const deleteArticle = async (
  articleId: string,
  companyId: string,
  userId: string
): Promise<void> => {
  await query(
    'UPDATE articles SET is_active = false, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND company_id = $2',
    [articleId, companyId]
  );

  // Log action
  await auditService.logAction(userId, 'article.delete', 'article', {
    companyId,
    entityId: articleId,
  });
};

// Statistics
export const getArticleStats = async (companyId: string): Promise<any> => {
  const result = await query(
    `SELECT
      COUNT(*) as total_articles,
      COUNT(CASE WHEN is_active = true THEN 1 END) as active_articles,
      COUNT(CASE WHEN is_active = false THEN 1 END) as inactive_articles,
      COUNT(DISTINCT category) as categories_count
     FROM articles
     WHERE company_id = $1`,
    [companyId]
  );

  return result.rows[0];
};

// Get popular articles (most used in invoices - placeholder for now)
export const getPopularArticles = async (
  companyId: string,
  limit: number = 10
): Promise<Article[]> => {
  const result = await query(
    `SELECT * FROM articles
     WHERE company_id = $1 AND is_active = true
     ORDER BY created_at DESC
     LIMIT $2`,
    [companyId, limit]
  );

  return result.rows;
};
