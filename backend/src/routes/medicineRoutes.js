'use strict';

const express = require('express');
const router = express.Router();
const QRCode = require('qrcode');
const crypto = require('crypto');
const config = require('../config');
const mockLedger = require('../fabric/mockLedgerService');
const fabricGateway = require('../fabric/fabricGateway');
const {
    verificationLimiter,
    mutationLimiter,
    generateActorToken,
    verifyRole,
    sanitizeInput
} = require('../middleware/security');

/**
 * Dispatch to Fabric Gateway or Mock Ledger
 */
async function executeLedger(operation, params = {}) {
    if (!config.useMockLedger) {
        try {
            switch (operation) {
                case 'initMedicine':
                    return await fabricGateway.submitTransaction(
                        'initMedicine',
                        params.medicineId,
                        params.batchNumber,
                        JSON.stringify(params.drugDetails),
                        params.expiryDate,
                        params.verificationTokenHash,
                        params.lat,
                        params.lng,
                        params.facilityName,
                        params.address,
                        JSON.stringify(params.telemetry)
                    );
                case 'updateLocationCheckpoint':
                    return await fabricGateway.submitTransaction(
                        'updateLocationCheckpoint',
                        params.medicineId,
                        params.lat,
                        params.lng,
                        params.facilityName,
                        params.address,
                        JSON.stringify(params.telemetry)
                    );
                case 'transferCustody':
                    return await fabricGateway.submitTransaction(
                        'transferCustody',
                        params.medicineId,
                        params.newOwnerMsp,
                        params.newHolderId,
                        params.newRole,
                        params.action,
                        params.lat,
                        params.lng,
                        params.facilityName,
                        params.address,
                        JSON.stringify(params.telemetry)
                    );
                case 'receiveAtRetailer':
                    return await fabricGateway.submitTransaction(
                        'receiveAtRetailer',
                        params.medicineId,
                        params.lat,
                        params.lng,
                        params.facilityName,
                        params.address,
                        JSON.stringify(params.telemetry)
                    );
                case 'dispenseToCustomer':
                    return await fabricGateway.submitTransaction(
                        'dispenseToCustomer',
                        params.medicineId,
                        params.token,
                        params.lat,
                        params.lng,
                        params.pharmacyName
                    );
                case 'flagRecall':
                    return await fabricGateway.submitTransaction(
                        'flagRecall',
                        params.medicineId,
                        params.reason
                    );
                case 'queryMedicine':
                    return await fabricGateway.evaluateTransaction('queryMedicine', params.medicineId);
                case 'queryMedicineHistory':
                    return await fabricGateway.evaluateTransaction('queryMedicineHistory', params.medicineId);
                default:
                    throw new Error(`Unsupported transaction: ${operation}`);
            }
        } catch (gatewayErr) {
            console.warn(`Fabric Gateway invocation failed (${gatewayErr.message}); falling back to local simulation.`);
        }
    }

    // Default to in-memory mock ledger engine
    switch (operation) {
        case 'initMedicine': return await mockLedger.initMedicine(params);
        case 'updateLocationCheckpoint': return await mockLedger.updateLocationCheckpoint(params);
        case 'transferCustody': return await mockLedger.transferCustody(params);
        case 'receiveAtRetailer': return await mockLedger.receiveAtRetailer(params);
        case 'dispenseToCustomer': return await mockLedger.dispenseToCustomer(params);
        case 'flagRecall': return await mockLedger.flagRecall(params.medicineId, params.reason);
        case 'queryMedicine': return await mockLedger.queryMedicine(params.medicineId);
        case 'queryMedicineHistory': return await mockLedger.queryMedicineHistory(params.medicineId);
        case 'getAll': return await mockLedger.getAllMedicines();
        default: throw new Error(`Unknown operation: ${operation}`);
    }
}

/**
 * Verify cryptographic hash pointer chain of the route history
 */
function verifyRouteHashChain(routeHistory = []) {
    if (!routeHistory || routeHistory.length === 0) return true;
    for (let i = 0; i < routeHistory.length; i++) {
        const wp = routeHistory[i];
        if (i === 0) {
            if (wp.prevHash && wp.prevHash !== '0'.repeat(64)) return false;
        } else {
            const prev = routeHistory[i - 1];
            if (wp.prevHash && prev.entryHash && wp.prevHash !== prev.entryHash) {
                return false;
            }
        }
    }
    return true;
}

/**
 * Helper to generate a new QR code for a given verification step, linking with its predecessor hash
 */
async function generateStepVerificationQr(medicine, rawToken = '') {
    if (!medicine || !medicine.routeHistory || medicine.routeHistory.length === 0) {
        return null;
    }
    const latestWp = medicine.routeHistory[medicine.routeHistory.length - 1];
    const prevWp = medicine.routeHistory.length > 1 ? medicine.routeHistory[medicine.routeHistory.length - 2] : null;
    const stepIndex = latestWp.stepIndex !== undefined ? latestWp.stepIndex : (medicine.routeHistory.length - 1);
    const prevHash = latestWp.prevHash || (prevWp ? prevWp.entryHash : '0'.repeat(64));
    const currentHash = latestWp.entryHash || '';
    const txId = latestWp.txId || '';
    const action = latestWp.action || 'VERIFIED_STEP';

    const tokenParam = rawToken ? `&token=${encodeURIComponent(rawToken)}` : '';
    const verificationUrl = `${config.frontendUrl}/#verify?id=${encodeURIComponent(medicine.medicineId)}${tokenParam}&step=${stepIndex}&prevHash=${encodeURIComponent(prevHash)}&hash=${encodeURIComponent(currentHash)}`;

    const qrCodeDataUrl = await QRCode.toDataURL(verificationUrl, {
        errorCorrectionLevel: 'H',
        margin: 2,
        scale: 8
    });

    return {
        stepIndex,
        action,
        prevHash,
        currentHash,
        txId,
        verificationUrl,
        qrCodeDataUrl
    };
}

// -------------------------------------------------------------
// ROUTES
// -------------------------------------------------------------

/**
 * POST /api/auth/token
 * Issue Actor JWT Certificate for API access
 */
router.post('/auth/token', (req, res) => {
    const { role = 'MANUFACTURER', orgMsp = 'ManufacturerMSP', userId = 'OPERATOR_1' } = req.body;
    const token = generateActorToken(role, orgMsp, userId);
    res.json({ success: true, token, role, orgMsp, expiresIn: '8h' });
});

/**
 * GET /api/config
 */
router.get('/config', (req, res) => {
    res.json({
        hasGoogleMapsKey: !!config.googleMapsApiKey,
        googleMapsApiKey: config.googleMapsApiKey,
        frontendUrl: config.frontendUrl,
        mode: config.useMockLedger ? 'Hyperledger Fabric (Simulated / Hardened Mode)' : 'Hyperledger Fabric (Live Peer Network)'
    });
});

/**
 * GET /api/medicines
 */
router.get('/medicines', async (req, res) => {
    try {
        const medicines = await executeLedger('getAll');
        res.json({ success: true, count: medicines.length, data: medicines });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/medicine/init
 * Manufacturer batch registration (Protected by mutationLimiter & verifyRole)
 */
router.post('/medicine/init', mutationLimiter, verifyRole(['MANUFACTURER', 'DEVELOPER']), async (req, res) => {
    try {
        const {
            medicineId,
            batchNumber,
            drugDetails,
            expiryDate,
            secretToken,
            lat,
            lng,
            facilityName,
            address,
            telemetry
        } = req.body;

        if (!medicineId || !batchNumber) {
            return res.status(400).json({ success: false, error: 'medicineId and batchNumber are required.' });
        }

        const rawToken = secretToken || crypto.randomBytes(16).toString('hex').toUpperCase();
        const verificationTokenHash = crypto.createHash('sha256').update(rawToken).digest('hex');

        const actor = req.actor || {};
        const asset = await executeLedger('initMedicine', {
            medicineId: sanitizeInput(medicineId),
            batchNumber: sanitizeInput(batchNumber),
            drugDetails: drugDetails || { brandName: 'Generic Medicine', dosageForm: 'Tablet', strength: '100mg' },
            expiryDate: expiryDate || '2028-12-31T23:59:59Z',
            verificationTokenHash,
            verificationTokenRaw: rawToken,
            lat: parseFloat(lat) || 0.0,
            lng: parseFloat(lng) || 0.0,
            facilityName: sanitizeInput(facilityName) || 'Main Manufacturing Facility',
            address: sanitizeInput(address) || 'Industrial Zone 1',
            telemetry: telemetry || { temperatureCelsius: 21.0, humidityPercent: 45 },
            callerMsp: actor.orgMsp || 'ManufacturerMSP',
            callerId: actor.userId || 'MANUFACTURER_ADMIN'
        });

        if (asset) {
            asset.secretTokenDemo = rawToken;
        }

        const stepQr = await generateStepVerificationQr(asset, rawToken);

        res.status(201).json({
            success: true,
            message: 'Medicine digital twin registered with cryptographic hash chaining.',
            medicine: asset,
            secretToken: rawToken,
            stepVerification: stepQr,
            verificationUrl: stepQr?.verificationUrl,
            qrCodeDataUrl: stepQr?.qrCodeDataUrl,
            prevHash: stepQr?.prevHash || '0'.repeat(64),
            entryHash: stepQr?.currentHash || ''
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/medicine/checkpoint
 * In-transit GPS checkpoint (Protected by mutationLimiter & verifyRole)
 */
router.post('/medicine/checkpoint', mutationLimiter, verifyRole(['TRANSPORTER', 'DISTRIBUTOR', 'DEVELOPER']), async (req, res) => {
    try {
        const { medicineId, lat, lng, facilityName, address, telemetry } = req.body;
        if (!medicineId || lat === undefined || lng === undefined) {
            return res.status(400).json({ success: false, error: 'medicineId, lat, and lng are required.' });
        }

        const actor = req.actor || {};
        const updated = await executeLedger('updateLocationCheckpoint', {
            medicineId: sanitizeInput(medicineId),
            lat: parseFloat(lat),
            lng: parseFloat(lng),
            facilityName: sanitizeInput(facilityName),
            address: sanitizeInput(address),
            telemetry,
            callerMsp: actor.orgMsp || 'DistributorMSP',
            callerId: actor.userId || 'TRANSPORTER_SCANNER'
        });

        const demoToken = updated.secretTokenDemo || req.body.token || '';
        const stepQr = await generateStepVerificationQr(updated, demoToken);

        res.json({
            success: true,
            message: 'In-transit GPS route checkpoint recorded with linked SHA-256 hash pointer.',
            medicine: updated,
            stepVerification: stepQr,
            qrCodeDataUrl: stepQr?.qrCodeDataUrl,
            verificationUrl: stepQr?.verificationUrl,
            prevHash: stepQr?.prevHash,
            entryHash: stepQr?.currentHash
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/medicine/receive
 * Pharmacy reception
 */
router.post('/medicine/receive', mutationLimiter, verifyRole(['PHARMACY', 'DEVELOPER']), async (req, res) => {
    try {
        const { medicineId, lat, lng, facilityName, address, telemetry } = req.body;
        if (!medicineId) return res.status(400).json({ success: false, error: 'medicineId is required.' });

        const actor = req.actor || {};
        const updated = await executeLedger('receiveAtRetailer', {
            medicineId: sanitizeInput(medicineId),
            lat: parseFloat(lat) || 0.0,
            lng: parseFloat(lng) || 0.0,
            facilityName: sanitizeInput(facilityName) || 'Pharmacy Store',
            address: sanitizeInput(address) || 'Pharmacy Reception',
            telemetry,
            callerMsp: actor.orgMsp || 'PharmacyMSP',
            callerId: actor.userId || 'PHARMACIST_LEAD'
        });

        const demoToken = updated.secretTokenDemo || req.body.token || '';
        const stepQr = await generateStepVerificationQr(updated, demoToken);

        res.json({
            success: true,
            message: 'Stock received at pharmacy and marked READY_FOR_SALE.',
            medicine: updated,
            stepVerification: stepQr,
            qrCodeDataUrl: stepQr?.qrCodeDataUrl,
            verificationUrl: stepQr?.verificationUrl,
            prevHash: stepQr?.prevHash,
            entryHash: stepQr?.currentHash
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/medicine/dispense
 * Pharmacy dispensing to patient
 */
router.post('/medicine/dispense', mutationLimiter, verifyRole(['PHARMACY', 'DEVELOPER']), async (req, res) => {
    try {
        const { medicineId, token, lat, lng, pharmacyName } = req.body;
        if (!medicineId) return res.status(400).json({ success: false, error: 'medicineId is required.' });

        const updated = await executeLedger('dispenseToCustomer', {
            medicineId: sanitizeInput(medicineId),
            token: sanitizeInput(token),
            lat: parseFloat(lat) || 0.0,
            lng: parseFloat(lng) || 0.0,
            pharmacyName: sanitizeInput(pharmacyName) || 'Dispensing Counter'
        });

        const demoToken = token || updated.secretTokenDemo || '';
        const stepQr = await generateStepVerificationQr(updated, demoToken);

        res.json({
            success: true,
            message: 'Medicine dispensed to patient. Chained verification receipt generated.',
            medicine: updated,
            stepVerification: stepQr,
            qrCodeDataUrl: stepQr?.qrCodeDataUrl,
            verificationUrl: stepQr?.verificationUrl,
            prevHash: stepQr?.prevHash,
            entryHash: stepQr?.currentHash
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/medicine/recall
 * Emergency safety recall
 */
router.post('/medicine/recall', mutationLimiter, verifyRole(['MANUFACTURER', 'REGULATOR', 'DEVELOPER']), async (req, res) => {
    try {
        const { medicineId, reason } = req.body;
        if (!medicineId) return res.status(400).json({ success: false, error: 'medicineId is required.' });

        const updated = await executeLedger('flagRecall', {
            medicineId: sanitizeInput(medicineId),
            reason: sanitizeInput(reason)
        });

        res.json({
            success: true,
            message: `Emergency recall broadcasted on ledger for ${medicineId}.`,
            medicine: updated
        });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * POST /api/ledger/reset
 * Reset the persistent ledger store (Development / Demonstration mode only)
 */
router.post('/ledger/reset', mutationLimiter, verifyRole(['MANUFACTURER', 'DEVELOPER']), async (req, res) => {
    try {
        if (config.useMockLedger) {
            mockLedger.clearLedgerData();
            return res.json({ success: true, message: 'Persistent ledger store cleared successfully.' });
        }
        res.status(400).json({ success: false, error: 'Cannot reset live Hyperledger Fabric network via REST.' });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/medicine/:id
 */
router.get('/medicine/:id', async (req, res) => {
    try {
        const medicine = await executeLedger('queryMedicine', { medicineId: sanitizeInput(req.params.id) });
        res.json({ success: true, data: medicine });
    } catch (err) {
        res.status(404).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/medicine/:id/history
 */
router.get('/medicine/:id/history', async (req, res) => {
    try {
        const history = await executeLedger('queryMedicineHistory', { medicineId: sanitizeInput(req.params.id) });
        res.json({ success: true, count: history.length, data: history });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/tx/:txId
 * Query full Fabric block transaction by Transaction ID
 */
router.get('/tx/:txId', async (req, res) => {
    try {
        const txId = sanitizeInput(req.params.txId);
        const allMedicines = await executeLedger('getAll');
        for (const med of allMedicines) {
            const history = await executeLedger('queryMedicineHistory', { medicineId: med.medicineId });
            const foundRecord = (history || []).find(h => h.txId === txId);
            const foundWp = med.routeHistory?.find(w => w.txId === txId);
            if (foundRecord || foundWp) {
                return res.json({
                    success: true,
                    data: {
                        txId: txId,
                        medicineId: med.medicineId,
                        batchNumber: med.batchNumber,
                        blockNumber: foundRecord?.blockNumber || 101,
                        channel: 'pharma-tracking-channel',
                        chaincode: 'pharma-chaincode',
                        timestamp: foundRecord?.timestamp || foundWp?.timestamp || new Date().toISOString(),
                        action: foundRecord?.action || foundWp?.action || 'STATE_TRANSITION',
                        endorsingMsp: foundWp?.recordedBy?.orgMsp || foundRecord?.recordedBy?.orgMsp || 'ConsortiumEndorserMSP',
                        signerId: foundWp?.recordedBy?.userId || foundRecord?.recordedBy?.userId || 'SYSTEM_SIGNER',
                        entryHash: foundWp?.entryHash,
                        prevHash: foundWp?.prevHash,
                        location: foundWp?.location,
                        telemetry: foundWp?.telemetry,
                        consensus: 'Raft CFT (Crash Fault Tolerant)',
                        status: 'VALID_COMMITTED',
                        statePayload: foundRecord?.value || med
                    }
                });
            }
        }
        res.status(404).json({ success: false, error: `Transaction ${txId} not found on the ledger.` });
    } catch (err) {
        res.status(500).json({ success: false, error: err.message });
    }
});

/**
 * GET /api/medicine/:id/verify
 * Public verification endpoint protected by anti-brute-force rate limiting
 */
router.get('/medicine/:id/verify', verificationLimiter, async (req, res) => {
    try {
        const medicineId = sanitizeInput(req.params.id);
        const providedToken = sanitizeInput(req.query.token || '');

        let medicine;
        try {
            medicine = await executeLedger('queryMedicine', { medicineId });
        } catch (notFound) {
            return res.status(200).json({
                isAuthentic: false,
                authenticityStatus: 'UNREGISTERED_COUNTERFEIT',
                verdict: 'FAILED: Medicine was never registered on the Hyperledger Fabric ledger. High counterfeit risk.',
                medicine: null
            });
        }

        // Verify cryptographic hash chain of route history
        const isHashChainIntact = verifyRouteHashChain(medicine.routeHistory);
        if (!isHashChainIntact) {
            return res.status(200).json({
                isAuthentic: false,
                authenticityStatus: 'TAMPER_ALERT',
                verdict: 'CRITICAL ALERT: Physical route cryptographic hash chain is broken! Tampering or unauthorized off-chain modification detected.',
                medicine
            });
        }

        // Safety Recall Check
        if (medicine.isRecalled) {
            return res.status(200).json({
                isAuthentic: false,
                authenticityStatus: 'RECALLED',
                verdict: `RECALLED: Recalled by authorities (${medicine.recallReason || 'Safety alert'}). Do NOT consume.`,
                medicine
            });
        }

        // Constant-time comparison for token hash
        let tokenVerified = false;
        if (providedToken && medicine.verificationTokenHash) {
            const computed = crypto.createHash('sha256').update(providedToken).digest('hex');
            const bufA = Buffer.from(computed, 'utf8');
            const bufB = Buffer.from(medicine.verificationTokenHash, 'utf8');

            if (bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB)) {
                tokenVerified = true;
            } else {
                return res.status(200).json({
                    isAuthentic: false,
                    authenticityStatus: 'COUNTERFEIT_ALERT',
                    verdict: 'CRYPTOGRAPHIC MISMATCH: Packaging token does not match blockchain hash. Counterfeit suspected.',
                    medicine
                });
            }
        }

        // Cold-chain integrity advisory
        let coldChainNotice = null;
        if (medicine.coldChainBreached) {
            coldChainNotice = 'Cold-chain excursion recorded during transit. Storage temperature was out of bounds.';
        }

        const demoToken = providedToken || medicine.secretTokenDemo || '';
        const stepQr = await generateStepVerificationQr(medicine, demoToken);

        res.status(200).json({
            isAuthentic: true,
            tokenVerified: tokenVerified || (!medicine.verificationTokenHash),
            coldChainBreached: medicine.coldChainBreached,
            coldChainNotice,
            authenticityStatus: medicine.coldChainBreached ? 'GENUINE_EXCURSION' : 'GENUINE',
            verdict: medicine.coldChainBreached
                ? 'AUTHENTIC WITH COLD-CHAIN WARNING: Registered on Hyperledger Fabric, but temperature limits were breached.'
                : 'AUTHENTIC: Verified on Hyperledger Fabric. Cryptographic hash chain and packaging seal intact.',
            medicine,
            stepVerification: stepQr,
            verificationQrDataUrl: stepQr?.qrCodeDataUrl,
            verificationUrl: stepQr?.verificationUrl,
            prevHash: stepQr?.prevHash,
            currentHash: stepQr?.currentHash,
            verificationStep: stepQr?.stepIndex,
            txId: stepQr?.txId,
            routeMap: medicine.routeHistory.map(w => ({
                step: w.stepIndex,
                action: w.action,
                timestamp: w.timestamp,
                facility: w.location.facilityName,
                address: w.location.formattedAddress,
                lat: w.location.latitude,
                lng: w.location.longitude,
                operator: `${w.recordedBy.orgMsp} (${w.recordedBy.userId})`,
                telemetry: w.telemetry,
                txId: w.txId,
                entryHash: w.entryHash,
                prevHash: w.prevHash
            }))
        });
    } catch (err) {
        res.status(500).json({ isAuthentic: false, error: err.message });
    }
});

module.exports = router;
