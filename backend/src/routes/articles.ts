import express from 'express';
import * as articleController from '../controllers/articleController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Article CRUD operations
router.post('/', articleController.createArticle);
router.get('/', articleController.getArticles);
router.get('/stats', articleController.getArticleStats);
router.get('/popular', articleController.getPopularArticles);
router.get('/:id', articleController.getArticleById);
router.put('/:id', articleController.updateArticle);
router.delete('/:id', articleController.deleteArticle);

export default router;
