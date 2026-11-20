'use strict';

const rateLimit = require('express-rate-limit');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'PHARMA_CONSORTIUM_SECURE_JWT_SECRET_2026';

/**
 * General API Rate Limiter
 */
const generalLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Too many requests from this IP, please try again after 15 minutes.' }
});

/**
 * Anti-Brute-Force Rate Limiter for QR Verification & Dispensing
 */
const verificationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000, // 5 minutes
    max: 60,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Rate limit exceeded for token verification. Possible brute-force attack mitigated.' }
});

/**
 * Rate Limiter for State Mutation Transactions
 */
const mutationLimiter = rateLimit({
    windowMs: 5 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { success: false, error: 'Transaction submission rate limit reached.' }
});

/**
 * Issue role-based JWT token for network actors
 */
function generateActorToken(role, orgMsp, userId) {
    return jwt.sign(
        {
            role,
            orgMsp,
            userId,
            iss: 'PharmaTrust-Consortium-CA'
        },
        JWT_SECRET,
        { expiresIn: '8h' }
    );
}

/**
 * Verify JWT Role-Based Authorization
 */
function verifyRole(allowedRoles = []) {
    return (req, res, next) => {
        // Allow in local dev or if no Authorization header provided during initial testing
        const authHeader = req.headers['authorization'];
        if (!authHeader) {
            // Provide default identity if bypass active
            req.actor = {
                role: req.body?.callerRole || 'DEVELOPER',
                orgMsp: req.body?.callerMsp || 'DevOrgMSP',
                userId: req.body?.callerId || 'DEV_USER'
            };
            return next();
        }

        const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            if (allowedRoles.length > 0 && !allowedRoles.includes(decoded.role)) {
                return res.status(403).json({
                    success: false,
                    error: `Access Denied: Role '${decoded.role}' is not authorized for this transaction. Required: ${allowedRoles.join(', ')}`
                });
            }
            req.actor = decoded;
            next();
        } catch (err) {
            return res.status(401).json({ success: false, error: `Invalid or expired authorization token: ${err.message}` });
        }
    };
}

/**
 * Sanitizer for string inputs
 */
function sanitizeInput(str) {
    if (typeof str !== 'string') return str;
    return str.replace(/[<>'"`;]/g, '');
}

module.exports = {
    generalLimiter,
    verificationLimiter,
    mutationLimiter,
    generateActorToken,
    verifyRole,
    sanitizeInput
};
