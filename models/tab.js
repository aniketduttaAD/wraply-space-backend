const mongoose = require('mongoose');

const tabSchema = new mongoose.Schema({
    username: { type: String, required: true },
    title: { type: String, required: true },
    url: { type: String, required: true },
    group: { type: String, default: 'default' },
    status: { type: String, enum: ['active', 'closed'], default: 'active' },
}, { timestamps: true });

const Tab = mongoose.model('Tab', tabSchema);
module.exports = Tab;