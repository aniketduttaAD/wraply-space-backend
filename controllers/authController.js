const express = require('express');
const User = require('../models/user');
const Tab = require('../models/tab');
const logger = require('../utils/logger');
const { generateTotpSecretAndQr, generateOtp } = require('../utils/otpHelper');
const { MailerSend, EmailParams, Sender, Recipient } = require("mailersend");
const jwt = require('jsonwebtoken');
require('dotenv').config();

const usernameRegex = /^[a-zA-Z0-9_]{3,20}$/;
const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const mailerSend = new MailerSend({
    apiKey: process.env.API_KEY,
});

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'wraply_space';

const generateSessionToken = (username) => {
    return jwt.sign({ username }, JWT_SECRET);
};

const sendOtpEmail = async (toEmail, subject, otp, username) => {
    const sentFrom = new Sender("noreply@trial-351ndgwjzzxlzqx8.mlsender.net", "Wraply Space");
    const recipients = [new Recipient(toEmail, username)];
    const emailParams = new EmailParams()
        .setFrom(sentFrom)
        .setTo(recipients)
        .setSubject(subject)
        .setText(`Your OTP: ${otp}`)
        .setHtml(`<p>Your OTP: <strong>${otp}</strong></p>`);

    try {
        await mailerSend.email.send(emailParams);
        logger.info(`OTP sent to ${toEmail}`);
    } catch (err) {
        logger.error(`Error sending email to ${toEmail}: ${err.message}`);
    }
};

// ✅ Register User
router.post('/register', async (req, res) => {
    const { username, email } = req.body;
    try {
        if (!username || !email) {
            return res.status(400).json({ message: 'Username and email are required.' });
        }
        if (!usernameRegex.test(username)) {
            return res.status(400).json({ message: 'Invalid username. Use 3-20 characters: letters, numbers, underscores.' });
        }
        if (!emailRegex.test(email)) {
            return res.status(400).json({ message: 'Invalid email format.' });
        }

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) {
            return res.status(400).json({ message: 'You are already registered, enter the OTP.' });
        }

        const { secret, qrCodeUrl } = await generateTotpSecretAndQr(username);

        const newUser = new User({
            username,
            email,
            totpSecret: secret,
        });

        await newUser.save();
        logger.info(`New user registered: ${username}`);
        return res.status(201).json({ message: 'Registration successful. Scan the QR code.', qrCodeUrl });
    } catch (err) {
        logger.error(`Error during registration: ${err.message}`);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ✅ Request OTP
router.post('/request-email-otp', async (req, res) => {
    const { username } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid username' });
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const otp = generateOtp(user.totpSecret, currentTime);

        await sendOtpEmail(user.email, 'Your OTP Code', otp, user.username);
        logger.info(`OTP generated and sent for ${username}`);
        return res.status(200).json({ message: 'OTP sent successfully' });
    } catch (err) {
        logger.error(`Error generating OTP: ${err.message}`);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ✅ Verify OTP and Login
router.post('/verify', async (req, res) => {
    const { username, otp, type } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'Invalid username' });
        }

        const currentTime = Math.floor(Date.now() / 1000);
        const interval = type === 'email' ? 600 : 30;
        const validOtps = [
            generateOtp(user.totpSecret, currentTime - interval),
            generateOtp(user.totpSecret, currentTime),
            generateOtp(user.totpSecret, currentTime + interval)
        ];

        if (!validOtps.includes(otp)) {
            return res.status(400).json({ message: 'Invalid OTP, please try again' });
        }

        // ✅ Invalidate old session & set new session token
        const sessionToken = generateSessionToken(user.username);
        user.sessionToken = sessionToken;
        user.userStatus = 'verified';
        await user.save();

        // ✅ Restore all active tabs
        const activeTabs = await Tab.find({ username: user.username, status: 'active' });

        logger.info(`User verified: ${username}`);
        return res.status(200).json({ message: 'Login successful', sessionToken, tabs: activeTabs });
    } catch (err) {
        logger.error(`Error during verification: ${err.message}`);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ✅ Logout User
router.post('/logout', async (req, res) => {
    const sessionToken = req.headers.authorization?.split(' ')[1];

    if (!sessionToken) {
        return res.status(400).json({ message: 'No session token provided' });
    }

    try {
        const user = await User.findOne({ sessionToken });

        if (!user) {
            return res.status(400).json({ message: 'Invalid session' });
        }

        user.sessionToken = null;
        await user.save();

        return res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ✅ Delete Session Data (Keep User)
router.post('/delete-session', async (req, res) => {
    const { username } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        await Tab.deleteMany({ username });
        user.sessionToken = null;
        await user.save();

        return res.status(200).json({ message: 'Session data cleared, user account remains.' });
    } catch (err) {
        logger.error(`Error deleting session data: ${err.message}`);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

// ✅ Delete User & All Data
router.post('/delete-user', async (req, res) => {
    const { username } = req.body;

    try {
        const user = await User.findOne({ username });
        if (!user) {
            return res.status(400).json({ message: 'User not found' });
        }

        await Tab.deleteMany({ username });
        await User.deleteOne({ username });

        return res.status(200).json({ message: 'User account and all data deleted.' });
    } catch (err) {
        logger.error(`Error deleting user: ${err.message}`);
        return res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
