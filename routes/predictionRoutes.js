const express = require('express');
const { param } = require('express-validator');

const predictionController = require('../controllers/predictionController');

const router = express.Router();

router.get(
  '/:symbol',
  [param('symbol').trim().notEmpty().withMessage('symbol is required')],
  predictionController.predictNextDay
);

module.exports = router;
