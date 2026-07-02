const express = require('express');
const router = express.Router();
const adminController = require('../controllers/adminController');

const { requireAdmin } = adminController;

// Public: Admin login
router.post('/login', adminController.adminLogin);

// Public: Submit feedback/help (users can post without admin token)
router.post('/feedback', adminController.submitFeedback);

// Protected: all below require X-Admin-Token header
router.get('/dashboard',              requireAdmin, adminController.getDashboardStats);
router.get('/users',                  requireAdmin, adminController.getAllUsers);
router.get('/users/:id',              requireAdmin, adminController.getUserDetail);
router.put('/users/:id/balance',      requireAdmin, adminController.updateUserBalance);
router.delete('/users/:id',           requireAdmin, adminController.deleteUser);
router.get('/trades',                 requireAdmin, adminController.getAllTrades);
router.get('/watchlists',             requireAdmin, adminController.getAllWatchlists);
router.get('/portfolios',             requireAdmin, adminController.getAllPortfolios);
router.get('/system',                 requireAdmin, adminController.getSystemStats);
router.get('/feedbacks',              requireAdmin, adminController.getFeedbacks);
router.put('/feedbacks/:id/status',   requireAdmin, adminController.updateFeedbackStatus);

module.exports = router;

