const cron = require('cron');
const User = require('../models/user');
const logger = require('../utils/logger');

const userCleanupJob = new cron.CronJob('0 */30 * * * *', async () => {
    try {
        const result = await User.deleteMany({ userStatus: 'init' });
        logger.info(`Cleanup complete: Deleted ${result.deletedCount} unverified users.`);
    } catch (err) {
        logger.error(`Error during user cleanup: ${err.message}`);
    }
});

module.exports = { userCleanupJob };
