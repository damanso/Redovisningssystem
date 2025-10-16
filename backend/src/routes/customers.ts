import express from 'express';
import * as customerController from '../controllers/customerController';
import { authenticate } from '../middleware/authenticate';

const router = express.Router();

router.use(authenticate);

// CRUD operations
router.post('/', customerController.createCustomer);
router.get('/', customerController.getCustomers);
router.get('/:id', customerController.getCustomerById);
router.put('/:id', customerController.updateCustomer);
router.delete('/:id', customerController.deleteCustomer);

// Contacts
router.post('/:id/contacts', customerController.addCustomerContact);
router.get('/:id/contacts', customerController.getCustomerContacts);

// Notes
router.post('/:id/notes', customerController.addCustomerNote);
router.get('/:id/notes', customerController.getCustomerNotes);

export default router;
