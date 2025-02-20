const mongoose = require('mongoose');

const shortcutSchema = new mongoose.Schema({
    username: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true }
});

const Shortcut = mongoose.model('Shortcut', shortcutSchema);
module.exports = Shortcut;
