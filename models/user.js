const mongoose = require('mongoose');

const userSchema = new mongoose.Schema({
    username: { type: String, required: true },
    email: { type: String, required: true },
    totpSecret: { type: String, required: true },
    userStatus: { type: String, default: 'init' },
    sessionToken: { type: String, default: null },
    isBan: {
        IP: { type: String, default: null },
        bannedTime: { type: Number, default: null },
    },
});

const User = mongoose.model('User', userSchema);

module.exports = User;
