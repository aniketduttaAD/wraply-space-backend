const mongoose = require("mongoose");
const logger = require("../utils/logger");
require("dotenv").config();

const connectDB = async () => {
    try {
        await mongoose.connect(process.env.MONGODB_URI);
        logger.info("Successfully connected to MongoDB");
    } catch (err) {
        logger.error(`Failed to connect to MongoDB: ${err.message}`);
        process.exit(1);
    }
};

module.exports = connectDB;
