const mongoose = require('mongoose');

const bookmarkSchema = new mongoose.Schema({
    username: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const Bookmark = mongoose.model('Bookmark', bookmarkSchema);
module.exports = Bookmark;
