import { Router } from 'express';
import * as kpiController from '../controllers/kpiController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All KPI routes require authentication
router.use(authenticate);

// KPI definition CRUD
router.get('/definitions', kpiController.getAllKPIDefinitions);
router.get('/definitions/:id', kpiController.getKPIDefinitionById);
router.post('/definitions', kpiController.createKPIDefinition);
router.put('/definitions/:id', kpiController.updateKPIDefinition);
router.delete('/definitions/:id', kpiController.deleteKPIDefinition);

// KPI values
router.get('/definitions/:kpiId/values', kpiController.getKPIValues);
router.post('/values', kpiController.createKPIValue);

// KPI calculation
router.get('/calculate/:code', kpiController.calculateKPI);
router.post('/calculate/:code', kpiController.calculateAndSaveKPI);
router.post('/calculate-all', kpiController.calculateAllKPIs);

// KPI dashboard & reporting
router.get('/dashboard', kpiController.getKPIDashboard);
router.get('/definitions/:kpiId/trend', kpiController.getKPITrend);

// KPI targets
router.get('/definitions/:kpiId/targets', kpiController.getKPITargets);
router.post('/definitions/:kpiId/targets', kpiController.createKPITarget);

export default router;
