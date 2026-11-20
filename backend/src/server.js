'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const path = require('path');
const config = require('./config');
const medicineRoutes = require('./routes/medicineRoutes');
const { generalLimiter } = require('./middleware/security');
const { initFabricGateway } = require('./fabric/fabricGateway');

const app = express();

// 1. Security Headers with Helmet
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: [
                "'self'",
                "'unsafe-inline'",
                "'unsafe-eval'",
                "https://unpkg.com",
                "https://maps.googleapis.com",
                "https://cdnjs.cloudflare.com"
            ],
            styleSrc: [
                "'self'",
                "'unsafe-inline'",
                "https://unpkg.com",
                "https://fonts.googleapis.com",
                "https://cdnjs.cloudflare.com"
            ],
            fontSrc: [
                "'self'",
                "https://fonts.gstatic.com",
                "https://cdnjs.cloudflare.com"
            ],
            imgSrc: [
                "'self'",
                "data:",
                "blob:",
                "https://*.openstreetmap.org",
                "https://maps.googleapis.com",
                "https://maps.gstatic.com"
            ],
            connectSrc: [
                "'self'",
                "https://*.openstreetmap.org",
                "https://maps.googleapis.com"
            ]
        }
    },
    crossOriginEmbedderPolicy: false
}));

// 2. CORS configuration
app.use(cors({
    origin: config.frontendUrl || true,
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization']
}));

// 3. Body Parsing & General Rate Limiting
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true, limit: '1mb' }));
app.use('/api', generalLimiter);

// 4. Static Frontend Serving
const frontendPath = path.resolve(__dirname, '../../frontend');
app.use(express.static(frontendPath));

// 5. API Routes
app.use('/api', medicineRoutes);

// 6. Health check
app.get('/health', (req, res) => {
    res.json({
        status: 'UP',
        security: 'ENHANCED (Helmet CSP, RateLimiting, HashPointerChain, JWT RBAC)',
        service: 'Pharma Supply Chain Fabric Gateway API',
        timestamp: new Date().toISOString()
    });
});

// Root fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
});

// Global Error Handler (Prevents stack trace leakage in responses)
app.use((err, req, res, next) => {
    console.error('Unhandled Server Error:', err);
    res.status(500).json({
        success: false,
        error: process.env.NODE_ENV === 'production' ? 'Internal server error occurred.' : err.message
    });
});

// Start Server
async function startServer() {
    if (!config.useMockLedger) {
        console.log('Attempting connection to Hyperledger Fabric network...');
        await initFabricGateway();
    } else {
        console.log('Running in Hyperledger Fabric Simulated Mode (Hardened Security).');
    }

    app.listen(config.port, () => {
        console.log(`
======================================================================
  PHARMACEUTICAL SUPPLY CHAIN TRACKING PLATFORM [SECURED]
======================================================================
  Security:   Helmet CSP, Rate Limiting, Hash-Chained Ledgers, JWT
  Mode:       ${config.useMockLedger ? 'Fabric Simulator' : 'Live Fabric Network'}
  Server:     http://localhost:${config.port}
======================================================================
        `);
    });
}

startServer();
