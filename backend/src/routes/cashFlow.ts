import { Router } from 'express';
import * as cashFlowController from '../controllers/cashFlowController';
import { authenticate } from '../middleware/auth';

const router = Router();

// All cash flow routes require authentication
router.use(authenticate);

// Forecast CRUD
router.get('/forecasts', cashFlowController.getAllForecasts);
router.get('/forecasts/:id', cashFlowController.getForecastById);
router.post('/forecasts', cashFlowController.createForecast);
router.put('/forecasts/:id', cashFlowController.updateForecast);
router.delete('/forecasts/:id', cashFlowController.deleteForecast);

// Forecast lines
router.get('/forecasts/:forecastId/lines', cashFlowController.getForecastLines);
router.post('/forecasts/:forecastId/lines', cashFlowController.createForecastLine);
router.delete('/forecasts/:forecastId/lines/:lineId', cashFlowController.deleteForecastLine);

// Forecast generation
router.post('/forecasts/:forecastId/regenerate', cashFlowController.regenerateForecast);

// Payment patterns
router.post('/patterns/calculate', cashFlowController.calculatePaymentPatterns);
router.get('/patterns', cashFlowController.getPaymentPatterns);

// Projections
router.get('/forecasts/:forecastId/projection', cashFlowController.getForecastProjection);
router.get('/forecasts/:forecastId/summary', cashFlowController.getForecastSummary);
router.get('/quick-projection', cashFlowController.getQuickProjection);

// Scenarios
router.get('/scenarios', cashFlowController.getScenarios);
router.post('/scenarios', cashFlowController.createScenario);
router.post('/scenarios/compare', cashFlowController.compareScenarios);

export default router;
