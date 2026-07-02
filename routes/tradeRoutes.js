const express = require('express');
const { body } = require('express-validator');

const authMiddleware = require('../middleware/authMiddleware');
const tradeController = require('../controllers/tradeController');

const router = express.Router();

router.post(
  '/buy',
  authMiddleware,
  [
    body('symbol').trim().notEmpty().withMessage('symbol is required'),
    body('quantity').isNumeric().withMessage('quantity must be a number'),
    body('price').isNumeric().withMessage('price must be a number')
  ],
  tradeController.buyStock
);

router.post(
  '/sell',
  authMiddleware,
  [
    body('symbol').trim().notEmpty().withMessage('symbol is required'),
    body('quantity').isNumeric().withMessage('quantity must be a number'),
    body('price').isNumeric().withMessage('price must be a number')
  ],
  tradeController.sellStock
);

router.get('/portfolio', authMiddleware, tradeController.getPortfolio);
router.get('/transactions', authMiddleware, tradeController.getTransactions);

module.exports = router;
