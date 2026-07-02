const crypto = require('crypto');
const nodemailer = require('nodemailer');
const bcrypt = require('bcryptjs');
const { validationResult } = require('express-validator');
const User = require('../models/User');

// Configure nodemailer with fallback for development
let transporter;

// Check if SMTP is properly configured
if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_USER !== 'your-email@gmail.com' && process.env.SMTP_PASS !== 'your-gmail-app-password') {
  transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: process.env.SMTP_PORT,
    secure: false, // true for 465, false for other ports
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS
    },
    tls: {
      rejectUnauthorized: false // helps with connection issues
    }
  });
  console.log('✅ Email transporter configured with SMTP for:', process.env.SMTP_USER);
} else {
  // Development mode - use ethereal.email for testing
  nodemailer.createTestAccount((err, account) => {
    if (err) {
      console.error('❌ Failed to create test email account:', err);
      return;
    }
    transporter = nodemailer.createTransport({
      host: 'smtp.ethereal.email',
      port: 587,
      secure: false,
      auth: {
        user: account.user,
        pass: account.pass
      }
    });
    console.log('🔧 Development mode: Using test email account');
    console.log('📧 To use real email, update SMTP_PASS in .env with Gmail App Password');
    console.log('📧 Get App Password: https://myaccount.google.com/apppasswords');
  });
}

exports.forgotPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }
    const { email } = req.body;
    const user = await User.findOne({ email });
    if (!user) {
      // Do not reveal if user exists
      return res.json({ message: 'If that email is registered, a reset link has been sent.' });
    }
    
    // Generate token
    const token = crypto.randomBytes(32).toString('hex');
    user.resetPasswordToken = token;
    user.resetPasswordExpires = Date.now() + 1000 * 60 * 30; // 30 min
    await user.save();
    
    // Send email
    const resetUrl = `${process.env.FRONTEND_URL || 'http://localhost:5000'}/reset-password.html?token=${token}`;
    
    // Check if transporter is available
    if (!transporter) {
      console.error('❌ Email transporter not available');
      // In development, log the reset link to console
      console.log('🔧 Development mode - Reset link (copy this):', resetUrl);
      return res.json({ 
        message: 'If that email is registered, a reset link has been sent.',
        developmentMode: true,
        resetLink: resetUrl 
      });
    }
    
    const mailOptions = {
      to: user.email,
      from: `"Stock Market App" <${process.env.SMTP_FROM || 'no-reply@example.com'}>`,
      subject: 'Password Reset',
      html: `<p>You requested a password reset.</p><p>Click <a href="${resetUrl}">here</a> to reset your password. This link is valid for 30 minutes.</p>`
    };
    
    const info = await transporter.sendMail(mailOptions);
    console.log('📧 Password reset email sent:', info.messageId);
    
    // In development with ethereal, provide preview URL
    if (process.env.NODE_ENV === 'development' && nodemailer.getTestMessageUrl) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log('🔧 Email preview URL:', previewUrl);
        return res.json({ 
          message: 'If that email is registered, a reset link has been sent.',
          developmentMode: true,
          previewUrl: previewUrl,
          resetLink: resetUrl
        });
      }
    }
    
    return res.json({ message: 'If that email is registered, a reset link has been sent.' });
  } catch (err) {
    console.error('❌ Forgot password error:', err);
    return next(err);
  }
};

exports.resetPassword = async (req, res, next) => {
  try {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ message: 'Validation error', errors: errors.array() });
    }
    const { token, password } = req.body;
    const user = await User.findOne({
      resetPasswordToken: token,
      resetPasswordExpires: { $gt: Date.now() }
    });
    if (!user) {
      return res.status(400).json({ message: 'Invalid or expired reset token' });
    }
    user.password = await bcrypt.hash(password, 10);
    user.resetPasswordToken = undefined;
    user.resetPasswordExpires = undefined;
    await user.save();
    return res.json({ message: 'Password reset successful' });
  } catch (err) {
    return next(err);
  }
};
