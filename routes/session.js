const express = require('express');
const User = require('../models/user');
const Tab = require('../models/tab');
const logger = require('../utils/logger');

const router = express.Router();

// ✅ Logout User
router.post('/logout', async (req, res) => {
    const sessionToken = req.headers.authorization?.split(' ')[1];

    if (!sessionToken) return res.status(400).json({ message: 'No session token provided' });

    try {
        const user = await User.findOne({ sessionToken });
        if (!user) return res.status(400).json({ message: 'Invalid session' });

        user.sessionToken = null;
        await user.save();
        res.status(200).json({ message: 'Logged out successfully' });
    } catch (err) {
        res.status(500).json({ message: 'Internal server error' });
    }
});

// ✅ Delete Session Data
router.post('/delete-session', async (req, res) => {
    const { username } = req.body;
    try {
        const user = await User.findOne({ username });
        if (!user) return res.status(400).json({ message: 'User not found' });

        await Tab.deleteMany({ username });
        user.sessionToken = null;
        await user.save();

        res.status(200).json({ message: 'Session data cleared, user account remains.' });
    } catch (err) {
        logger.error(`Error deleting session data: ${err.message}`);
        res.status(500).json({ message: 'Internal server error' });
    }
});

module.exports = router;
