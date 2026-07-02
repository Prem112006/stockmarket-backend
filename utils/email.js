const nodemailer = require('nodemailer');

let transporter;

const initTransporter = async () => {
  if (transporter) return transporter;
  
  if (process.env.SMTP_USER && process.env.SMTP_PASS && process.env.SMTP_USER !== 'your-email@gmail.com' && process.env.SMTP_PASS !== 'your-gmail-app-password') {
    transporter = nodemailer.createTransport({
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: process.env.SMTP_PORT || 587,
      secure: false, // true for 465, false for other ports
      auth: {
        user: process.env.SMTP_USER,
        pass: process.env.SMTP_PASS
      },
      tls: {
        rejectUnauthorized: false
      }
    });
    console.log('✅ Email transporter configured with SMTP for:', process.env.SMTP_USER);
  } else {
    // Development mode - use ethereal.email for testing
    console.log('🔧 Initializing Ethereal test email account...');
    const account = await nodemailer.createTestAccount();
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
    console.log('📧 To use real email, update SMTP_USER and SMTP_PASS in .env');
  }
  return transporter;
};

const sendEmail = async (options) => {
  try {
    const t = await initTransporter();
    const info = await t.sendMail(options);
    
    if (nodemailer.getTestMessageUrl) {
      const previewUrl = nodemailer.getTestMessageUrl(info);
      if (previewUrl) {
        console.log('🔧 Email preview URL:', previewUrl);
        info.previewUrl = previewUrl;
      }
    }
    
    return info;
  } catch (error) {
    console.error('❌ Send email error:', error);
    throw error;
  }
};

module.exports = { sendEmail, initTransporter };
