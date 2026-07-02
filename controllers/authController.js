// Password recovery handlers
const passwordRecovery = require('./passwordRecovery');
exports.forgotPassword = passwordRecovery.forgotPassword;
exports.resetPassword = passwordRecovery.resetPassword;
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { validationResult } = require('express-validator');

const User = require('../models/User');

const signToken = (userId) => {
  return jwt.sign({ id: userId }, process.env.JWT_SECRET, { expiresIn: '7d' });
};

exports.register = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const { name, email, password } = req.body;

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(409).json({ message: 'Email already registered' });
    }

    const hashed = await bcrypt.hash(password, 10);

    const defaultBalance = Number(process.env.DEFAULT_BALANCE || 0);

    const user = await User.create({
      name,
      email,
      password: hashed,
      balance: defaultBalance
    });

    const token = signToken(user._id);

    return res.status(201).json({
      message: 'Registered successfully',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance
      }
    });
  } catch (err) {
    return next(err);
  }
};

exports.getProfile = async (req, res, next) => {
  try {
    const user = await User.findById(req.user.id).select('-password');
    if (!user) {
      return res.status(404).json({ message: 'User not found' });
    }

    return res.json({
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt
      }
    });
  } catch (err) {
    return next(err);
  }
};

exports.login = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const { email, password } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Generate a 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    
    // Save to user model
    user.loginOtp = otp;
    user.loginOtpExpires = Date.now() + 5 * 60 * 1000; // 5 minutes
    await user.save();

    // Send email using nodemailer
    try {
      const { sendEmail } = require('../utils/email');
      const mailOptions = {
        to: user.email,
        from: `"Stock Market App" <${process.env.SMTP_FROM || 'no-reply@example.com'}>`,
        subject: 'Your Login Validation OTP',
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; text-align: center;">
            <h2>Secure Login</h2>
            <p>Your One-Time Password (OTP) for login is:</p>
            <h1 style="color: #4CAF50; font-size: 36px; letter-spacing: 5px; margin: 20px 0;">${otp}</h1>
            <p>This OTP will expire in 5 minutes.</p>
            <p style="font-size: 12px; color: #777;">If you did not request this, please ignore this email.</p>
          </div>
        `
      };
      
      const emailInfo = await sendEmail(mailOptions);
      console.log(`[AUTH] Login OTP sent to ${user.email}`);
      
      return res.json({
        message: 'OTP Sent to your email',
        requiresOtp: true,
        email: user.email,
        devPreviewUrl: emailInfo.previewUrl || null
      });
    } catch (emailErr) {
      console.error('Failed to send OTP email:', emailErr);
      return res.status(500).json({ message: 'Error sending OTP email. Please try again.' });
    }
  } catch (err) {
    return next(err);
  }
};

exports.verifyLoginOtp = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }

    const { email, otp } = req.body;

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: 'Invalid credentials' });
    }

    // Check if OTP exists and is not expired
    if (!user.loginOtp || !user.loginOtpExpires || Date.now() > user.loginOtpExpires) {
      return res.status(401).json({ message: 'OTP has expired or is invalid' });
    }

    // Check if OTP matches
    if (user.loginOtp !== otp) {
      return res.status(401).json({ message: 'Incorrect OTP' });
    }

    // Clear the OTP fields
    user.loginOtp = undefined;
    user.loginOtpExpires = undefined;
    await user.save();

    // Issue Token
    const token = signToken(user._id);

    return res.json({
      message: 'Login successful',
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        balance: user.balance
      }
    });
  } catch (err) {
    return next(err);
  }
};
