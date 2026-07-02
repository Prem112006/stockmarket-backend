const mongoose = require('mongoose');

const holdingSchema = new mongoose.Schema(
  {
    userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stockId: { type: mongoose.Schema.Types.ObjectId, ref: 'Stock', required: true, index: true },
    quantity: { type: Number, required: true, min: 0 }
  },
  { timestamps: true }
);

holdingSchema.index({ userId: 1, stockId: 1 }, { unique: true });

module.exports = mongoose.model('Holding', holdingSchema);
