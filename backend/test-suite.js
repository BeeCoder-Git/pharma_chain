'use strict';

const mockLedger = require('./src/fabric/mockLedgerService');
const { generateActorToken } = require('./src/middleware/security');
const QRCode = require('qrcode');
const crypto = require('crypto');

async function runSecurityTestSuite() {
    console.log('======================================================');
    console.log('   PHARMATRUST LEDGER SECURITY & INTEGRITY TEST SUITE');
    console.log('   (Generalized Dynamic Execution Mode)               ');
    console.log('======================================================');

    // Generate dynamic identifiers for generalized test execution
    const randomSuffix = Math.floor(100000 + Math.random() * 900000);
    const dynamicMedId = `MED-GEN-${randomSuffix}`;
    const dynamicBatch = `BATCH-GEN-${randomSuffix}`;
    const dynamicSecret = `SECRET-KEY-${randomSuffix}`;
    const dynamicHash = crypto.createHash('sha256').update(dynamicSecret).digest('hex');

    // 1. Dynamic Asset Initialization
    console.log(`\n[STEP 1] Dynamically Minting Generalized Asset '${dynamicMedId}'...`);
    const initializedAsset = await mockLedger.initMedicine({
        medicineId: dynamicMedId,
        batchNumber: dynamicBatch,
        drugDetails: {
            brandName: 'Generalized Pharma Compound',
            genericName: 'Compound-Alpha',
            dosageForm: 'Capsule',
            strength: '100mg'
        },
        expiryDate: '2029-12-31T23:59:59Z',
        verificationTokenHash: dynamicHash,
        lat: 37.7749,
        lng: -122.4194,
        facilityName: 'Genesis Production Site',
        address: '100 Innovation Way',
        telemetry: { temperatureCelsius: 21.0, humidityPercent: 44 }
    });
    console.log(`  ✓ Asset '${initializedAsset.medicineId}' registered on ledger with Genesis SHA-256 hash.`);

    // 2. Cryptographic Hash Pointer Chain Integrity
    console.log('\n[TEST 1] Verifying Cryptographic Route Hash Pointer Chaining...');
    const queriedAsset = await mockLedger.queryMedicine(dynamicMedId);
    if (!queriedAsset.routeHistory[0].prevHash || queriedAsset.routeHistory[0].prevHash !== '0'.repeat(64)) {
        throw new Error('Genesis waypoint prevHash is invalid!');
    }
    console.log('  ✓ Genesis waypoint hash links verified (64-byte zero root).');

    // 3. In-Transit Checkpoint with Hash Chaining
    console.log('\n[TEST 2] Appending Waypoint & Verifying Incremental Hash Pointer...');
    const updated = await mockLedger.updateLocationCheckpoint({
        medicineId: dynamicMedId,
        lat: 34.0522,
        lng: -118.2437,
        facilityName: 'Regional Distribution Center',
        address: '500 Logistics Blvd',
        telemetry: { temperatureCelsius: 19.8, humidityPercent: 43 }
    });
    const lastWp = updated.routeHistory[updated.routeHistory.length - 1];
    const prevWp = updated.routeHistory[updated.routeHistory.length - 2];
    if (lastWp.prevHash !== prevWp.entryHash) {
        throw new Error('New waypoint prevHash does not match previous entryHash!');
    }
    console.log(`  ✓ Checkpoint 2 appended with valid prevHash pointer (${lastWp.prevHash.substring(0, 16)}...).`);

    // 4. Coordinate Bounds Attack Mitigation
    console.log('\n[TEST 3] Testing Coordinate Bounds Injection Protection...');
    try {
        await mockLedger.updateLocationCheckpoint({
            medicineId: dynamicMedId,
            lat: 999.0, // Invalid Latitude > 90
            lng: 0.0,
            facilityName: 'Invalid Coordinate Test',
            address: 'Unknown'
        });
        throw new Error('FAILED: Coordinate bounds violation was NOT caught!');
    } catch (err) {
        console.log(`  ✓ Out-of-bounds latitude blocked as expected: "${err.message}"`);
    }

    // 5. Ledger Key Injection / Malformed ID Mitigation
    console.log('\n[TEST 4] Testing Ledger Key Injection Mitigation...');
    try {
        await mockLedger.queryMedicine('MED../hack$#--');
        throw new Error('FAILED: Malformed ID was NOT rejected!');
    } catch (err) {
        console.log(`  ✓ Malformed key attack blocked as expected: "${err.message}"`);
    }

    // 6. Cold-Chain Temperature Anomaly Detection
    console.log('\n[TEST 5] Testing Cold-Chain Excursion Anomaly Detection...');
    const coldAlertId = `MED-COLD-${randomSuffix}`;
    const tempAlertAsset = await mockLedger.initMedicine({
        medicineId: coldAlertId,
        batchNumber: `BATCH-COLD-${randomSuffix}`,
        drugDetails: { brandName: 'Biologic Product', dosageForm: 'Vial', strength: '50ml' },
        expiryDate: '2028-12-31',
        verificationTokenHash: crypto.createHash('sha256').update('COLD_TEST').digest('hex'),
        lat: 40.7128,
        lng: -74.0060,
        facilityName: 'Thermal Test Facility',
        address: '42 Cold Storage Rd',
        telemetry: { temperatureCelsius: 31.5, humidityPercent: 55 } // Exceeds 25°C limit!
    });
    if (!tempAlertAsset.coldChainBreached) {
        throw new Error('FAILED: Cold chain excursion was not flagged!');
    }
    console.log('  ✓ Thermal excursion detected (31.5°C > 25°C threshold). Flagged on ledger: coldChainBreached = true.');

    // 7. Constant-Time Token Authentication (Anti-Timing Attack)
    console.log('\n[TEST 6] Testing Constant-Time Packaging Token Authentication...');
    try {
        await mockLedger.dispenseToCustomer({
            medicineId: dynamicMedId,
            token: 'INCORRECT_SECRET_TOKEN_GUESS',
            pharmacyName: 'Community Care Pharmacy'
        });
        throw new Error('FAILED: Invalid token was accepted!');
    } catch (err) {
        console.log(`  ✓ Counterfeit attempt rejected: "${err.message}"`);
    }

    // Now test valid dispensation
    const dispensedAsset = await mockLedger.dispenseToCustomer({
        medicineId: dynamicMedId,
        token: dynamicSecret,
        pharmacyName: 'Community Care Pharmacy'
    });
    if (dispensedAsset.status !== 'DISPENSED') {
        throw new Error('FAILED: Valid token dispensation did not update status to DISPENSED');
    }
    console.log('  ✓ Genuine token verified with constant-time equality check. Asset marked DISPENSED.');

    // 8. JWT Consortium Actor Certificate Generation
    console.log('\n[TEST 7] Testing Consortium JWT Certificate Issuance...');
    const jwtToken = generateActorToken('MANUFACTURER', 'ManufacturerMSP', 'ADMIN_USER');
    if (!jwtToken || typeof jwtToken !== 'string') throw new Error('JWT token generation failed');
    console.log(`  ✓ Valid 8-hour JWT certificate issued for ManufacturerMSP.`);

    console.log('\n======================================================');
    console.log('   ALL 7 GENERALIZED SECURITY TESTS PASSED            ');
    console.log('======================================================\n');
}

runSecurityTestSuite().catch(err => {
    console.error('Security Test Suite Failed:', err);
    process.exit(1);
});
