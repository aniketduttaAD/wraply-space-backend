const express = require('express');
const User = require('../models/user');
const { generateTotpSecretAndQr, generateOtp } = require('../utils/otpHelper');
const { MailerSend, EmailParams, Sender, Recipient } = require("mailersend");
const jwt = require('jsonwebtoken');
const logger = require('../utils/logger');
require('dotenv').config();

const router = express.Router();
const JWT_SECRET = process.env.JWT_SECRET || 'wraply_space';

const mailerSend = new MailerSend({ apiKey: process.env.API_KEY });

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
        .setHtml(`
            <div style="font-family: Arial, sans-serif; text-align: center;">
                <h2>Your OTP Code</h2>
                <p style="font-size: 18px;">Use the following OTP to complete your login:</p>
                <p style="font-size: 24px; font-weight: bold; color: #007BFF;">${otp}</p>
                <p>This OTP is valid for a 5 minutes.</p>
            </div>
        `);
    try {
        await mailerSend.email.send(emailParams);
        logger.info(`OTP sent to ${toEmail}`);
    } catch (err) {
        logger.error(`Error sending email to ${toEmail}: ${err.message}`);
    }
};

// Register User
router.post('/register', async (req, res) => {
    const { username, email } = req.body;
    try {
        if (!username || !email) return res.status(400).json({ message: 'Username and email are required.' });

        const existingUser = await User.findOne({ $or: [{ username }, { email }] });
        if (existingUser) return res.status(400).json({ message: 'You are already registered, enter the OTP.' });

        const { secret, qrCodeUrl } = await generateTotpSecretAndQr(username);
        const newUser = new User({ username, email, totpSecret: secret });

        await newUser.save();
        logger.info(`New user registered: ${username}`);
        res.status(201).json({ message: 'Registration successful. Scan the QR code.', qrCodeUrl });
    } catch (err) {
        logger.error(`Error during registration: ${err.message}`);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Request OTP
router.post('/request-email-otp', async (req, res) => {
    const { username } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Invalid username' });

        const otp = generateOtp(user.totpSecret, Math.floor(Date.now() / 1000));
        await sendOtpEmail(user.email, 'Your OTP Code', otp, user.username);

        logger.info(`OTP generated and sent for ${username}`);
        res.status(200).json({ message: 'OTP sent successfully' });
    } catch (err) {
        logger.error(`Error generating OTP: ${err.message}`);
        res.status(500).json({ message: 'Internal server error' });
    }
});

// Verify OTP & Login
router.post('/verify', async (req, res) => {
    const { username, otp, type } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'Invalid username' });

        const currentTime = Math.floor(Date.now() / 1000);
        const interval = type === 'email' ? 600 : 30;
        const validOtps = [generateOtp(user.totpSecret, currentTime - interval), generateOtp(user.totpSecret, currentTime), generateOtp(user.totpSecret, currentTime + interval)];

        if (!validOtps.includes(otp)) return res.status(400).json({ message: 'Invalid OTP, please try again' });

        user.sessionToken = generateSessionToken(user.username);
        user.userStatus = 'verified';
        await user.save();

        logger.info(`User verified: ${username}`);
        res.status(200).json({ message: 'Login successful', sessionToken: user.sessionToken });
    } catch (err) {
        logger.error(`Error during verification: ${err.message}`);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
