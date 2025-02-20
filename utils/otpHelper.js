const speakeasy = require('speakeasy');
const qrcode = require('qrcode');
const logger = require('./logger');

const generateTotpSecretAndQr = async (username) => {
    const secret = speakeasy.generateSecret({
        name: `Wraply Space-${username}`,
        length: 20,
    });

    try {
        const qrCodeUrl = await qrcode.toDataURL(secret.otpauth_url);
        return { secret: secret.base32, qrCodeUrl };
    } catch (err) {
        logger.error(`Error generating QR Code: ${err.message}`);
        throw err;
    }
};

const generateOtp = (secret, timestamp) => {
    const otp = speakeasy.totp({
        secret: secret,
        encoding: 'base32',
        step: 30,
        time: timestamp,
    });
    return otp;
};

module.exports = { generateTotpSecretAndQr, generateOtp };
