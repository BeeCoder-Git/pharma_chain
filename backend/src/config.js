'use strict';

const path = require('path');
require('dotenv').config();

module.exports = {
    port: process.env.PORT || 3000,
    nodeEnv: process.env.NODE_ENV || 'development',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    googleMapsApiKey: process.env.GOOGLE_MAPS_API_KEY || '',

    // Force or toggle mock ledger simulation (set to 'false' to connect to live Fabric network)
    useMockLedger: process.env.USE_MOCK_LEDGER !== 'false',

    // Production Fabric Gateway connection settings
    fabric: {
        channelName: process.env.FABRIC_CHANNEL || 'pharma-tracking-channel',
        chaincodeName: process.env.FABRIC_CHAINCODE || 'pharma-chaincode',
        mspId: process.env.FABRIC_MSP_ID || 'ManufacturerMSP',
        cryptoPath: process.env.FABRIC_CRYPTO_PATH || path.resolve(__dirname, '../../test-network/organizations'),
        peerEndpoint: process.env.FABRIC_PEER_ENDPOINT || 'localhost:7051',
        peerHostAlias: process.env.FABRIC_PEER_HOST_ALIAS || 'peer0.org1.example.com',
        tlsCertPath: process.env.FABRIC_TLS_CERT_PATH || '',
        userCertPath: process.env.FABRIC_USER_CERT_PATH || '',
        keyDirectoryPath: process.env.FABRIC_KEY_DIR_PATH || ''
    }
};
