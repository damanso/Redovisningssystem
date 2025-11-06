import express from 'express';
import * as projectController from '../controllers/projectController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

router.use(authenticate);

// Project CRUD operations
router.post('/', projectController.createProject);
router.get('/', projectController.getProjects);
router.get('/:id', projectController.getProjectById);
router.put('/:id', projectController.updateProject);
router.delete('/:id', projectController.deleteProject);

// Project operations
router.post('/:id/deactivate', projectController.deactivateProject);
router.get('/:id/summary', projectController.getProjectSummary);

// Time entries
router.post('/time-entries', projectController.createTimeEntry);
router.get('/time-entries', projectController.getTimeEntries);
router.get('/time-entries/:id', projectController.getTimeEntryById);
router.put('/time-entries/:id', projectController.updateTimeEntry);
router.delete('/time-entries/:id', projectController.deleteTimeEntry);

// Project invoices
router.post('/invoices', projectController.createProjectInvoice);
router.get('/:projectId/invoices', projectController.getProjectInvoices);
router.post('/time-entries/mark-invoiced', projectController.markTimeEntriesAsInvoiced);

export default router;
