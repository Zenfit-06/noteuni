const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const User = require('../models/User');
const { sendOtpEmail } = require('../config/mailer');
const { syncUsersToJson } = require('../services/jsonStore');

const router = express.Router();

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000));
}

// POST /api/auth/request-otp
router.post('/request-otp', async (req, res) => {
  try {
    const { name, email, rollNumber, branch, semester } = req.body;

    if (!email || !email.toLowerCase().endsWith('@' + process.env.ALLOWED_EMAIL_DOMAIN)) {
      return res.status(400).json({ message: `Use your official @${process.env.ALLOWED_EMAIL_DOMAIN} email` });
    }

    const otp = generateOtp();
    const otpHash = await bcrypt.hash(otp, 10);
    const otpExpiresAt = new Date(Date.now() + Number(process.env.OTP_EXPIRY_MINUTES) * 60 * 1000);

    let user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      user = new User({ name: name || email.split('@')[0], email: email.toLowerCase(), rollNumber, branch, semester });
    }
    user.otpHash = otpHash;
    user.otpExpiresAt = otpExpiresAt;
    await user.save();

    await sendOtpEmail(user.email, otp);

    res.json({ message: 'OTP sent to your email' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to send OTP' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    const user = await User.findOne({ email: (email || '').toLowerCase() });

    if (!user || !user.otpHash || !user.otpExpiresAt) {
      return res.status(400).json({ message: 'Request an OTP first' });
    }
    if (user.otpExpiresAt < new Date()) {
      return res.status(400).json({ message: 'OTP expired, request a new one' });
    }

    const isMatch = await bcrypt.compare(otp, user.otpHash);
    if (!isMatch) {
      return res.status(400).json({ message: 'Incorrect OTP' });
    }

    user.isVerified = true;
    user.otpHash = undefined;
    user.otpExpiresAt = undefined;
    await user.save();

    const token = jwt.sign({ userId: user._id }, process.env.JWT_SECRET, {
      expiresIn: process.env.JWT_EXPIRES_IN,
    });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        branch: user.branch,
        semester: user.semester,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Verification failed' });
  }
});

// POST /api/auth/demo-session
router.post('/demo-session', async (req, res) => {
  try {
    let user = await User.findOne({ email: 'admin@paruluniversity.ac.in' });
    if (!user) {
      user = await User.create({
        name: 'Parul Admin',
        email: 'admin@paruluniversity.ac.in',
        rollNumber: '2113101',
        branch: 'Computer Science & Engineering',
        semester: 5,
        isVerified: true,
      });
    }

    const secret = process.env.JWT_SECRET || 'noteversity_dev_secret_key_2026_jwt_token_secure';
    const token = jwt.sign({ userId: user._id }, secret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        branch: user.branch,
        semester: user.semester,
      },
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ message: 'Failed to create demo session' });
  }
});

// POST /api/auth/signup
router.post('/signup', async (req, res) => {
  try {
    const { name, email, password, rollNumber, branch, semester } = req.body;
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || 'paruluniversity.ac.in';
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.endsWith('@' + allowedDomain)) {
      return res.status(400).json({ message: `Only official @${allowedDomain} emails are allowed` });
    }

    if (!name || !name.trim()) {
      return res.status(400).json({ message: 'Full name is required' });
    }

    if (!password || password.length < 6) {
      return res.status(400).json({ message: 'Password must be at least 6 characters long' });
    }

    const existing = await User.findOne({ email: normalizedEmail });
    if (existing) {
      return res.status(400).json({ message: 'An account with this college email already exists. Please sign in instead.' });
    }

    const semNum = Number(semester || 5);
    if (semNum !== 5) {
      return res.status(400).json({ message: 'Only Semester 5 is currently available. We are working on other semesters!' });
    }

    const passwordHash = await bcrypt.hash(password, 10);
    const user = await User.create({
      name: name.trim(),
      email: normalizedEmail,
      passwordHash,
      rollNumber: rollNumber ? rollNumber.trim() : undefined,
      branch: branch ? branch.trim() : 'CSE',
      semester: semester ? Number(semester) : 5,
      isVerified: true,
    });

    await syncUsersToJson(User);

    const secret = process.env.JWT_SECRET || 'noteversity_dev_secret_key_2026_jwt_token_secure';
    const token = jwt.sign({ userId: user._id }, secret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.status(201).json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        rollNumber: user.rollNumber,
        branch: user.branch,
        semester: user.semester,
      },
    });
  } catch (err) {
    console.error('Signup error:', err);
    res.status(500).json({ message: 'Signup failed. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const allowedDomain = process.env.ALLOWED_EMAIL_DOMAIN || 'paruluniversity.ac.in';
    const normalizedEmail = (email || '').trim().toLowerCase();

    if (!normalizedEmail || !normalizedEmail.endsWith('@' + allowedDomain)) {
      return res.status(400).json({ message: `Please enter a valid @${allowedDomain} email` });
    }

    if (!password) {
      return res.status(400).json({ message: 'Please enter your password' });
    }

    const user = await User.findOne({ email: normalizedEmail });
    if (!user) {
      return res.status(404).json({ message: 'No account found with this email. Please sign up first.' });
    }

    if (user.passwordHash) {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (!isMatch) {
        return res.status(400).json({ message: 'Incorrect password. Please try again.' });
      }
    } else {
      user.passwordHash = await bcrypt.hash(password, 10);
      await user.save();
    }

    const secret = process.env.JWT_SECRET || 'noteversity_dev_secret_key_2026_jwt_token_secure';
    const token = jwt.sign({ userId: user._id }, secret, {
      expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    });

    res.json({
      token,
      user: {
        id: user._id,
        name: user.name,
        email: user.email,
        rollNumber: user.rollNumber,
        branch: user.branch,
        semester: user.semester,
      },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

module.exports = router;
