const http = require("http");
const express = require("express");
const helmet = require("helmet");
const cors = require("cors");
const rateLimit = require("express-rate-limit");
const connectDB = require("./config/db");
const logger = require("./utils/logger");
const { userCleanupJob } = require("./jobs/userCleanup");
const { initializeWebSocketServer } = require("./utils/websocket");
const User = require("./models/user");

const app = express();
app.use(express.json());

connectDB();
userCleanupJob.start();

const bannedIPs = new Map();

app.use(async (req, res, next) => {
    const ip = (req.headers["x-forwarded-for"] || req.socket.remoteAddress || "")
        .split(",")[0]
        .trim();
    const currentTime = Date.now();

    bannedIPs.forEach((unbanTime, bannedIp) => {
        if (currentTime > unbanTime) bannedIPs.delete(bannedIp);
    });

    if (bannedIPs.has(ip) && bannedIPs.get(ip) > currentTime) {
        return res
            .status(403)
            .json({ error: "You are temporarily banned. Try again later." });
    }

    if (
        req.path.startsWith("/auth/register") ||
        req.path.startsWith("/auth/verify") ||
        req.path.startsWith("/auth/request-email-otp")
    )
        return next();

    const sessionToken =
        req.headers["sessiontoken"] || req.headers["sessionToken"];

    if (!sessionToken) {
        logger.warn(`Unauthorized request from IP: ${ip}`);
        return res.status(403).json({ error: "Forbidden. Missing credentials." });
    }

    const user = await User.findOne({ sessionToken });

    if (!user || user.sessionToken !== sessionToken) {
        logger.warn(`Unauthorized request from IP: ${ip}`);
        return res.status(403).json({ error: "Forbidden. Invalid session." });
    }

    if (
        user.isBan &&
        user.isBan.IP === ip &&
        user.isBan.bannedTime > currentTime
    ) {
        return res
            .status(403)
            .json({ error: "You are temporarily banned. Try again later." });
    }

    next();
});

const globalLimiter = rateLimit({
    windowMs: 10 * 1000,
    max: 20,
    message: { error: "Too many requests, slow down." },
    handler: async (req, res) => {
        const ip = (
            req.headers["x-forwarded-for"] ||
            req.socket.remoteAddress ||
            ""
        )
            .split(",")[0]
            .trim();
        logger.warn(`Rate limit exceeded for IP: ${ip}`);
        bannedIPs.set(ip, Date.now() + 10 * 60 * 1000);

        const user = await User.findOne({
            sessionToken: req.headers["sessiontoken"] || req.headers["sessionToken"],
        });
        if (user) {
            user.isBan = { IP: ip, bannedTime: Date.now() + 10 * 60 * 1000 };
            await user.save();
        }

        res
            .status(429)
            .json({ error: "Too many requests. You are temporarily banned." });
    },
    keyGenerator: (req) => {
        const forwarded = req.headers["x-forwarded-for"];
        return (
            forwarded ? forwarded.split(",")[0] : req.socket.remoteAddress || ""
        ).trim();
    },
});

app.use(globalLimiter);

const createRateLimiter = (maxRequests, windowMs) =>
    rateLimit({
        windowMs,
        max: maxRequests,
        message: { error: "Too many requests, slow down." },
        handler: async (req, res) => {
            const ip = (
                req.headers["x-forwarded-for"] ||
                req.socket.remoteAddress ||
                ""
            )
                .split(",")[0]
                .trim();
            logger.warn(`Rate limit exceeded for IP: ${ip}`);
            bannedIPs.set(ip, Date.now() + 10 * 60 * 1000);

            const user = await User.findOne({
                sessionToken:
                    req.headers["sessiontoken"] || req.headers["sessionToken"],
            });
            if (user) {
                user.isBan = { IP: ip, bannedTime: Date.now() + 10 * 60 * 1000 };
                await user.save();
            }

            res
                .status(429)
                .json({ error: "Too many requests. You are temporarily banned." });
        },
        keyGenerator: (req) => {
            const forwarded = req.headers["x-forwarded-for"];
            return (
                forwarded ? forwarded.split(",")[0] : req.socket.remoteAddress || ""
            ).trim();
        },
    });

const searchLimiter = createRateLimiter(5, 1000);
const authLimiter = createRateLimiter(10, 60000);

app.use(helmet());
app.use(cors({ origin: "*" }));

app.use("/auth", authLimiter, require("./routes/auth"));
app.use("/session", require("./routes/session"));
app.use("/search", searchLimiter, require("./routes/search"));

const PORT = process.env.PORT || 5001;
const server = http.createServer(app);
initializeWebSocketServer(server);

server.listen(PORT, () => logger.info(`Server is running on port ${PORT}`));
