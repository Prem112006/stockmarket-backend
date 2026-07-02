const express = require('express');
const { body } = require('express-validator');

const authController = require('../controllers/authController');
const authMiddleware = require('../middleware/authMiddleware');

const router = express.Router();

router.get('/profile', authMiddleware, authController.getProfile);

router.post(
  '/register',
  [
    body('name').trim().notEmpty().withMessage('name is required'),
    body('email').isEmail().withMessage('valid email is required'),
    body('password').isLength({ min: 6 }).withMessage('password must be at least 6 chars')
  ],
  authController.register
);

router.post(
  '/login',
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('password').notEmpty().withMessage('password is required')
  ],
  authController.login
);

router.post(
  '/verify-otp',
  [
    body('email').isEmail().withMessage('valid email is required'),
    body('otp').isLength({ min: 6, max: 6 }).withMessage('valid 6-digit OTP is required')
  ],
  authController.verifyLoginOtp
);

router.post(
  '/forgot-password',
  [body('email').isEmail().withMessage('valid email is required')],
  authController.forgotPassword
);

router.post(
  '/reset-password',
  [
    body('token').notEmpty().withMessage('reset token is required'),
    body('password').isLength({ min: 6 }).withMessage('password must be at least 6 chars')
  ],
  authController.resetPassword
);

module.exports = router;
