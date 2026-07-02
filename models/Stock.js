const mongoose = require('mongoose');

const stockSchema = new mongoose.Schema(
  {
    symbol: { type: String, required: true, uppercase: true, unique: true, index: true },
    name: { type: String, default: '' },
    currentPrice: { type: Number, required: true },
    currency: { type: String, default: 'USD' }
  },
  { timestamps: true }
);

module.exports = mongoose.model('Stock', stockSchema);
