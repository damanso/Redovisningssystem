import express from 'express';
import * as supplierController from '../controllers/supplierController.js';
import { authenticate } from '../middleware/authenticate.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Supplier CRUD operations
router.post('/', supplierController.createSupplier);
router.get('/', supplierController.getSuppliers);
router.get('/stats', supplierController.getSupplierStats);
router.get('/:id', supplierController.getSupplierById);
router.put('/:id', supplierController.updateSupplier);
router.delete('/:id', supplierController.deleteSupplier);

// Supplier Contacts
router.post('/:id/contacts', supplierController.addSupplierContact);
router.get('/:id/contacts', supplierController.getSupplierContacts);
router.delete('/:id/contacts/:contactId', supplierController.deleteSupplierContact);

// Supplier Notes
router.post('/:id/notes', supplierController.addSupplierNote);
router.get('/:id/notes', supplierController.getSupplierNotes);
router.delete('/:id/notes/:noteId', supplierController.deleteSupplierNote);

export default router;
