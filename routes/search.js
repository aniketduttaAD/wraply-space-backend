const express = require("express");
const axios = require("axios");
const logger = require("../utils/logger");
const cache = require("../utils/cache");
const router = express.Router();
const { query, validationResult } = require("express-validator");

// 🔍 Search Suggest API
router.get("/suggest", async (req, res) => {
    const { q } = req.query;
    if (!q || q.trim().length < 2) {
        logger.warn(`Invalid suggest query: "${q}"`);
        return res.status(400).json({ error: "Invalid query." });
    }

    const cacheKey = `suggest-${q}`;
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) return res.status(200).json(cachedResponse);

    try {
        const { data } = await axios.get(
            "https://api.search.brave.com/res/v1/suggest/search",
            {
                headers: {
                    Accept: "application/json",
                    "X-Subscription-Token": process.env.BRAVE_SUGGEST_API_KEY,
                },
                params: { q, count: 5 },
            }
        );

        if (!data.results) {
            logger.warn(
                `Brave Suggest API returned empty response for query: "${q}"`
            );
        }

        const suggestions = data.results.map((item) => item.query);
        cache.set(cacheKey, { status: 200, suggestions });

        res.status(200).json({ status: 200, suggestions });
    } catch (error) {
        logger.error(`Suggest API error for query "${q}": ${error.message}`, {
            status: error.response?.status,
            response: error.response?.data,
        });
        res
            .status(error.response?.status || 500)
            .json({ error: "Error fetching data from Brave API" });
    }
});

// 🌍 Get user's IP
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

// 🌎 Get user country from IP
const getGeoData = async (ip) => {
    try {
        const { data } = await axios.get(`http://ip-api.com/json/${ip}`);
        return data?.countryCode || "ALL";
    } catch (error) {
        logger.error(`GeoData API error for IP ${ip}: ${error.message}`);
        return "ALL";
    }
};

// 🔄 Freshness Mapping
const freshnessMap = {
    day: "pd",
    week: "pw",
    month: "pm",
    year: "py",
};

// ✅ Search Query Validation
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
    query("result_filter")
        .optional()
        .isIn([
            "discussions",
            "faq",
            "infobox",
            "news",
            "query",
            "summarizer",
            "videos",
            "web",
            "locations",
        ])
        .withMessage("Invalid result filter."),
];

// 🔍 Main Search API
router.get("/search", validateSearch, async (req, res) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        logger.warn("Invalid search request", { errors: errors.array() });
        return res.status(400).json({ error: errors.array() });
    }

    const {
        q,
        page = 1,
        limit = 10,
        safesearch = "moderate",
        freshness = "py",
        result_filter = "web",
    } = req.query;
    const offset = (page - 1) * limit;
    const ip = await getIP(req);
    let country = await getGeoData(ip);

    if (country === "ALL") {
        logger.warn(`GeoData API failed for IP: ${ip}. Defaulting to IN`);
        country = "IN";
    }

    const cacheKey = `${q}-${page}-${limit}-${country}-${safesearch}-${freshness}-${result_filter}`;
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) return res.status(200).json(cachedResponse);

    try {
        const { data } = await axios.get(
            "https://api.search.brave.com/res/v1/web/search",
            {
                headers: {
                    Accept: "application/json",
                    "Accept-Encoding": "gzip",
                    "X-Subscription-Token": process.env.BRAVE_API_KEY,
                },
                params: {
                    q,
                    count: limit,
                    offset,
                    country,
                    safesearch,
                    freshness: freshnessMap[freshness] || freshness,
                    result_filter,
                },
            }
        );

        if (
            data.query?.country &&
            data.query?.country.toLowerCase() !== country.toLowerCase()
        ) {
            country = data.query.country;
        }

        const items = (data.web?.results || []).map((item) => ({
            title: item.title,
            link: item.url,
            description: item.description,
            image: item.profile?.img || item.meta_url?.favicon || null,
        }));

        const result = { page, country, items };
        cache.set(cacheKey, result);
        res.status(200).json(result);
    } catch (error) {
        logger.error("Brave API Error", {
            query: q,
            page,
            country,
            status: error.response?.status,
            message: error.message,
            response: error.response?.data,
        });

        res
            .status(error.response?.status || 500)
            .json({ error: "Error fetching data from Brave API" });
    }
});

module.exports = router;
