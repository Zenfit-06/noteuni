const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: Number(process.env.SMTP_PORT),
  secure: false,
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
  },
});

async function sendOtpEmail(toEmail, otp) {
  try {
    await transporter.sendMail({
      from: process.env.SMTP_FROM,
      to: toEmail,
      subject: 'Your Noteversity login OTP',
      html: `
        <div style="font-family:sans-serif;max-width:420px;margin:auto">
          <h2 style="color:#1E3A5F">Noteversity — Parul University</h2>
          <p>Your one-time login code is:</p>
          <p style="font-size:28px;font-weight:700;letter-spacing:4px;color:#1E3A5F">${otp}</p>
          <p>This code expires in ${process.env.OTP_EXPIRY_MINUTES} minutes. Do not share it with anyone.</p>
        </div>
      `,
    });
    console.log(`[Mailer] OTP email sent to ${toEmail}`);
  } catch (err) {
    console.warn(`[Mailer Dev Fallback] SMTP send failed: ${err.message}`);
    console.log(`=========================================`);
    console.log(`[DEV OTP] For ${toEmail}: ${otp}`);
    console.log(`=========================================`);
  }
}

module.exports = { sendOtpEmail };
