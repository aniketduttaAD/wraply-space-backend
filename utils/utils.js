const NodeCache = require("node-cache");
const { query } = require("express-validator");
const logger = require("./logger");
const axios = require("axios");

const cache = new NodeCache({ stdTTL: 600, checkperiod: 120 });

const getIP = async (req) => {
    let ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
        .split(",")[0]
        .trim();
    if (["::1", "127.0.0.1"].includes(ip)) {
        try {
            const { data } = await axios.get("https://api64.ipify.org?format=json");
            ip = data.ip;
        } catch (error) {
            logger.warn("Failed to fetch external IP, using UNKNOWN.");
            ip = "UNKNOWN";
        }
    }
    return ip;
};

const getGeoData = async (ip) => {
    try {
        const { data } = await axios.get(`http://ip-api.com/json/${ip}`);
        return data?.countryCode || "ALL";
    } catch (error) {
        logger.error(`GeoData API error for IP ${ip}: ${error.message}`);
        return "ALL";
    }
};

const freshnessMap = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
};

const validateSearch = [
    query("q")
        .trim()
        .isLength({ min: 2 })
        .withMessage("Query must be at least 2 characters."),
    query("page")
        .optional()
        .isInt({ min: 1 })
        .withMessage("Page must be a positive integer."),
    query("limit")
        .optional()
        .isInt({ min: 1, max: 20 })
        .withMessage("Limit must be between 1 and 20."),
    query("safesearch")
        .optional()
        .isIn(["off", "moderate", "strict"])
        .withMessage("Invalid safesearch value."),
    query("freshness")
        .optional()
        .isIn(["day", "week", "month", "year"])
        .withMessage("Invalid freshness value."),
    query("type")
        .optional()
        .isIn(["news", "video", "image", null])
        .withMessage("Invalid type value."),
];

module.exports = { cache, validateSearch, freshnessMap, getGeoData, getIP };
