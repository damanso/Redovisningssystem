import express from 'express';
import * as userController from '../controllers/userController.js';
import { authenticate } from '../middleware/authenticate.js';
import { authorize } from '../middleware/authorize.js';

const router = express.Router();

// All routes require authentication
router.use(authenticate);

// Get current user
router.get('/me', userController.getCurrentUser);

// Update current user
router.put('/me', userController.updateCurrentUser);

// Change password
router.post('/me/change-password', userController.changePassword);

// Get user by ID (admin only)
router.get('/:id', authorize(['admin']), userController.getUserById);

// Get all users (admin only)
router.get('/', authorize(['admin']), userController.getAllUsers);

// Deactivate user (admin only)
router.post('/:id/deactivate', authorize(['admin']), userController.deactivateUser);

// Activate user (admin only)
router.post('/:id/activate', authorize(['admin']), userController.activateUser);

export default router;
