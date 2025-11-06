import { Router } from 'express';
import * as budgetController from '../controllers/budgetController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All budget routes require authentication
router.use(authenticate);

// Budget CRUD
router.get('/', budgetController.getAllBudgets);
router.get('/:id', budgetController.getBudgetById);
router.post('/', budgetController.createBudget);
router.put('/:id', budgetController.updateBudget);
router.delete('/:id', budgetController.deleteBudget);

// Budget lines
router.get('/:budgetId/lines', budgetController.getBudgetLines);
router.post('/:budgetId/lines', budgetController.createBudgetLine);
router.put('/:budgetId/lines/:lineId', budgetController.updateBudgetLine);
router.delete('/:budgetId/lines/:lineId', budgetController.deleteBudgetLine);

// Budget analysis
router.get('/:budgetId/vs-actual', budgetController.getBudgetVsActual);
router.get('/:budgetId/summary', budgetController.getBudgetSummary);

// Budget revisions
router.get('/:budgetId/revisions', budgetController.getBudgetRevisions);
router.post('/:budgetId/revisions', budgetController.createBudgetRevision);

// Bulk operations
router.post('/with-lines', budgetController.createBudgetWithLines);
router.post('/:budgetId/copy', budgetController.copyBudget);

export default router;
