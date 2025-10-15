import express from 'express';
import * as customerController from '../controllers/customerController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Customer CRUD operations
router.post('/', customerController.createCustomer);
router.get('/', customerController.getCustomers);
router.get('/stats', customerController.getCustomerStats);
router.get('/:id', customerController.getCustomerById);
router.put('/:id', customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);

// Customer Contacts
router.post('/:id/contacts', customerController.addCustomerContact);
router.get('/:id/contacts', customerController.getCustomerContacts);
router.delete('/:id/contacts/:contactId', customerController.deleteCustomerContact);

// Customer Notes
router.post('/:id/notes', customerController.addCustomerNote);
router.get('/:id/notes', customerController.getCustomerNotes);
router.delete('/:id/notes/:noteId', customerController.deleteCustomerNote);

export default router;
