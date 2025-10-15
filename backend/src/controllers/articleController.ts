import { Response } from 'express';
import * as articleService from '../services/articleService.js';
import { CreateArticleDto, UpdateArticleDto } from '../types/article.types.js';
import { AuthRequest } from '../middleware/authenticate.js';

export const createArticle = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const data: CreateArticleDto = req.body;
    const article = await articleService.createArticle(company_id, userId, data);

    res.status(201).json(article);
  } catch (error: any) {
    console.error('Create article error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getArticles = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, search, category, is_active, limit, offset } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const result = await articleService.getArticles(company_id as string, {
      search: search as string,
      category: category as string,
      is_active: is_active !== undefined ? is_active === 'true' : undefined,
      limit: limit ? parseInt(limit as string) : undefined,
      offset: offset ? parseInt(offset as string) : undefined
    });

    res.json(result);
  } catch (error: any) {
    console.error('Get articles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getArticleById = async (req: AuthRequest, res: Response) => {
  try {
    const { id } = req.params;
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const article = await articleService.getArticleById(id, company_id as string);

    if (!article) {
      return res.status(404).json({ error: 'Article not found' });
    }

    res.json(article);
  } catch (error: any) {
    console.error('Get article error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const updateArticle = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id, ...updates } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const article = await articleService.updateArticle(
      id,
      company_id,
      userId,
      updates as UpdateArticleDto
    );

    res.json(article);
  } catch (error: any) {
    if (error.message === 'Article not found') {
      return res.status(404).json({ error: error.message });
    }
    console.error('Update article error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const deleteArticle = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    const { id } = req.params;
    const { company_id } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Not authenticated' });
    }

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    await articleService.deleteArticle(id, company_id, userId);
    res.json({ message: 'Article deactivated successfully' });
  } catch (error: any) {
    console.error('Delete article error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getArticleStats = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const stats = await articleService.getArticleStats(company_id as string);
    res.json(stats);
  } catch (error: any) {
    console.error('Get article stats error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const getPopularArticles = async (req: AuthRequest, res: Response) => {
  try {
    const { company_id, limit } = req.query;

    if (!company_id) {
      return res.status(400).json({ error: 'company_id is required' });
    }

    const articles = await articleService.getPopularArticles(
      company_id as string,
      limit ? parseInt(limit as string) : 10
    );

    res.json(articles);
  } catch (error: any) {
    console.error('Get popular articles error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};
