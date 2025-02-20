const mongoose = require('mongoose');

const historySchema = new mongoose.Schema({
    username: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    timestamp: { type: Date, default: Date.now }
});

const History = mongoose.model('History', historySchema);
module.exports = History;
