const express = require('express');

const sentimentController = require('../controllers/sentimentController');

const router = express.Router();

router.get('/market', sentimentController.getMarketSentiment);

module.exports = router;
