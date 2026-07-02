const mongoose = require('mongoose');

const feedbackSchema = new mongoose.Schema({
  name:    { type: String, required: true, trim: true },
  email:   { type: String, required: true, trim: true },
  type:    { type: String, enum: ['help', 'feedback'], default: 'feedback' },
  rating:  { type: Number, min: 1, max: 5, default: null }, // only for feedback
  subject: { type: String, trim: true },
  message: { type: String, required: true, trim: true },
  status:  { type: String, enum: ['unread', 'read', 'resolved'], default: 'unread' },
}, { timestamps: true });

module.exports = mongoose.model('Feedback', feedbackSchema);
