const express = require('express');
const { param, body } = require('express-validator');

const stockController = require('../controllers/stockController');

const router = express.Router();

router.get('/', stockController.listStocks);

router.post(
  '/bulk-prices',
  [
    body('symbols').isArray().withMessage('symbols must be an array'),
    body('symbols.*').trim().notEmpty().withMessage('each symbol is required')
  ],
  stockController.getMultiplePrices
);

router.get(
  '/:symbol/price',
  [param('symbol').trim().notEmpty().withMessage('symbol is required')],
  stockController.getLivePrice
);

router.get(
  '/:symbol/chart',
  [param('symbol').trim().notEmpty().withMessage('symbol is required')],
  stockController.getChartData
);

module.exports = router;
