const express = require("express");
const axios = require("axios");
const logger = require("../utils/logger");
const {
    cache,
    validateSearch,
    freshnessMap,
    getGeoData,
    getIP,
} = require("../utils/utils");
const { validationResult } = require("express-validator");

const router = express.Router();

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

        const suggestions = data.results?.map((item) => item.query) || [];
        cache.set(cacheKey, { status: 200, suggestions });

        res.status(200).json({ status: 200, suggestions });
    } catch (error) {
        logger.error(`Suggest API error for query "${q}": ${error.message}`, {
            status: error.response?.status,
            response: error.response?.data,
        });
        res.status(error.response?.status || 500).json({
            error: "Error fetching data from Brave API",
        });
    }
});

// 🟢 **Search API**
router.get("/search-online", validateSearch, async (req, res) => {
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
        type = null,
    } = req.query;

    const offset = page - 1;
    const ip = await getIP(req);
    let country = await getGeoData(ip);

    if (country === "ALL") {
        logger.warn(`GeoData API failed for IP: ${ip}. Defaulting to IN`);
        country = "IN";
    }

    const apiEndpoints = {
        news: "https://api.search.brave.com/res/v1/news/search",
        video: "https://api.search.brave.com/res/v1/videos/search",
        image: "https://api.search.brave.com/res/v1/images/search",
        web: "https://api.search.brave.com/res/v1/web/search",
    };

    const apiUrl = apiEndpoints[type] || apiEndpoints.web;

    const cacheKey = `${q}-${page}-${limit}-${country}-${safesearch}-${freshness}-${type}`;
    const cachedResponse = cache.get(cacheKey);
    if (cachedResponse) return res.status(200).json(cachedResponse);

    try {
        let params = {
            q,
            count: limit,
            offset,
            country,
            safesearch,
            freshness: freshnessMap[freshness] || freshness,
        };

        if (type === "image") {
            delete params.freshness;
            delete params.offset;
            params.safesearch = "strict"
        }

        const { data } = await axios.get(apiUrl, {
            headers: {
                Accept: "application/json",
                "Accept-Encoding": "gzip",
                "X-Subscription-Token": process.env.BRAVE_API_KEY,
            },
            params,
        });

        if (
            data.query?.country &&
            data.query?.country.toLowerCase() !== country.toLowerCase()
        ) {
            country = data.query.country;
        }

        let items = [];
        const processMetaData = (item) => ({
            creator:
                item.video?.creator ||
                item.source ||
                item.profile?.name ||
                item.meta_url?.hostname ||
                null,
            image: item.thumbnail?.original || item.meta_url?.favicon || null,
            thumbnail: item.thumbnail?.src || item.meta_url?.favicon || null,
            creatorChannel: item.video?.author?.url || null,
            duration: item.video?.duration || null,
            views: item.video?.views || null,
        });

        if (type === "news") {
            items = (data.results || []).map((item) => ({
                type: "news",
                title: item.title || "Untitled",
                description: item.description || "No description available",
                link: item.url,
                published: item.age || "Unknown",
                meta_data: processMetaData(item),
            }));
        } else if (type === "video") {
            items = (data.results || []).map((item) => ({
                type: "video",
                title: item.title || "Untitled",
                description: item.description || "No description available",
                link: item.url,
                published: item.age || "Unknown",
                meta_data: processMetaData(item),
            }));
        } else if (type === "image") {
            items = (data.results || []).map((item) => ({
                type: "image",
                title: item.title || "Untitled",
                link: item.url,
                description: item.description || null,
                published: item.age || null,
                meta_data: processMetaData(item),
            }));
        } else {
            items = (data.web?.results || []).map((item) => ({
                type: "web",
                title: item.title || "Untitled",
                link: item.url,
                description: item.description || "No description available",
                published: item.age || "Unknown",
                meta_data: processMetaData(item),
            }));
        }

        // 📌 **Cache & Return Result**
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
            response: error.response,
        });

        res.status(error.response?.status || 500).json({
            error: "Error fetching data from Brave API",
        });
    }
});

module.exports = router;
