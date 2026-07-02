const mongoose = require('mongoose');

const userSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, index: true },
    password: { type: String, required: true },
    balance: { type: Number, default: 0 },
    resetPasswordToken: { type: String },
    resetPasswordExpires: { type: Date },
    loginOtp: { type: String },
    loginOtpExpires: { type: Date }
  },
  { timestamps: true }
);

module.exports = mongoose.model('User', userSchema);
