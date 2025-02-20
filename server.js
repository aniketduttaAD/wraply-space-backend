const http = require('http');
const express = require('express');
const connectDB = require('./config/db');
const logger = require('./utils/logger');
const { userCleanupJob } = require('./jobs/userCleanup');
const authRoutes = require('./controllers/authController');
const { initializeWebSocketServer } = require('./utils/websocket');

const app = express();
app.use(express.json());
connectDB();
app.use('/api', authRoutes);
userCleanupJob.start();

const PORT = process.env.PORT || 5001;
const server = http.createServer(app);
initializeWebSocketServer(server);

server.listen(PORT, () => logger.info(`Server is running on port ${PORT}`));
