const mongoose = require('mongoose');

const noteSchema = new mongoose.Schema({
    username: { type: String, required: true },
    content: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const Note = mongoose.model('Note', noteSchema);
module.exports = Note;
