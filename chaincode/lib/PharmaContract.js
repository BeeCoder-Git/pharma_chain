'use strict';

const { Contract } = require('fabric-contract-api');
const crypto = require('crypto');

/**
 * PharmaContract - Hardened Enterprise Edition
 * Hyperledger Fabric Smart Contract managing the end-to-end provenance,
 * physical custody transfers, GPS route mapping, and authenticity verification
 * of pharmaceutical products with cryptographic hash pointer chaining and
 * cold-chain anomaly detection.
 */
class PharmaContract extends Contract {

    constructor() {
        super('PharmaContract');
    }

    // -------------------------------------------------------------
    // SECURITY & CRYPTOGRAPHIC HELPERS
    // -------------------------------------------------------------

    _getCallerMsp(ctx) {
        try {
            return ctx.clientIdentity.getMSPID();
        } catch (err) {
            return 'UNKNOWN_MSP';
        }
    }

    _getCallerId(ctx) {
        try {
            return ctx.clientIdentity.getID();
        } catch (err) {
            return 'SYSTEM_CALLER';
        }
    }

    _getTxTimestampIso(ctx) {
        const txTime = ctx.stub.getTxTimestamp();
        const date = new Date(txTime.seconds.low * 1000 + Math.floor(txTime.nanos / 1000000));
        return date.toISOString();
    }

    /**
     * Compute SHA-256 hash of an object for cryptographic chaining
     */
    _computeHash(data) {
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    /**
     * Constant-time string/hash comparison to prevent timing side-channel attacks
     */
    _timingSafeEqual(strA, strB) {
        if (typeof strA !== 'string' || typeof strB !== 'string') return false;
        const bufA = Buffer.from(strA, 'utf8');
        const bufB = Buffer.from(strB, 'utf8');
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    /**
     * Validate ID format against safe pattern (prevents path traversal / ledger key injection)
     */
    _validateId(id, fieldName = 'ID') {
        if (!id || typeof id !== 'string') {
            throw new Error(`Invalid ${fieldName}: must be a non-empty string.`);
        }
        const idRegex = /^[A-Za-z0-9\-_]{3,64}$/;
        if (!idRegex.test(id)) {
            throw new Error(`Security Violation: ${fieldName} '${id}' contains invalid characters. Allowed: alphanumeric, hyphens, underscores (3-64 chars).`);
        }
    }

    /**
     * Validate geographical coordinates
     */
    _validateCoordinates(lat, lng) {
        const nLat = parseFloat(lat);
        const nLng = parseFloat(lng);
        if (isNaN(nLat) || nLat < -90 || nLat > 90) {
            throw new Error(`Security Violation: Latitude ${lat} is out of valid bounds [-90, 90].`);
        }
        if (isNaN(nLng) || nLng < -180 || nLng > 180) {
            throw new Error(`Security Violation: Longitude ${lng} is out of valid bounds [-180, 180].`);
        }
        return { lat: nLat, lng: nLng };
    }

    /**
     * Check if asset exists
     */
    async medicineExists(ctx, medicineId) {
        const buffer = await ctx.stub.getState(medicineId);
        return (!!buffer && buffer.length > 0);
    }

    // -------------------------------------------------------------
    // LIFECYCLE & STATE MUTATIONS
    // -------------------------------------------------------------

    /**
     * 1. Register a new medicine batch digital twin on the blockchain
     * Restricted to ManufacturerMSP.
     */
    async initMedicine(
        ctx,
        medicineId,
        batchNumber,
        drugDetailsJson,
        expiryDate,
        verificationTokenHash,
        lat,
        lng,
        facilityName,
        address,
        telemetryJson
    ) {
        this._validateId(medicineId, 'medicineId');
        this._validateId(batchNumber, 'batchNumber');
        const coords = this._validateCoordinates(lat, lng);

        const callerMsp = this._getCallerMsp(ctx);
        const callerId = this._getCallerId(ctx);

        // Strict RBAC: ManufacturerMSP only (or local dev bypass)
        if (callerMsp !== 'ManufacturerMSP' && callerMsp !== 'UNKNOWN_MSP' && callerMsp !== 'DevOrgMSP') {
            throw new Error(`Access Denied: Only ManufacturerMSP can register new medicine. Caller: ${callerMsp}`);
        }

        const exists = await this.medicineExists(ctx, medicineId);
        if (exists) {
            throw new Error(`The medicine ${medicineId} already exists on the ledger.`);
        }

        let parsedDrugDetails = {};
        try {
            parsedDrugDetails = JSON.parse(drugDetailsJson);
        } catch (err) {
            throw new Error(`Invalid JSON format for drugDetailsJson: ${err.message}`);
        }

        let parsedTelemetry = {};
        if (telemetryJson) {
            try {
                parsedTelemetry = JSON.parse(telemetryJson);
            } catch (err) {
                parsedTelemetry = { raw: telemetryJson };
            }
        }

        // Cold-chain safety check (ambient standard: 15C - 25C)
        let coldChainAlert = false;
        if (parsedTelemetry.temperatureCelsius !== undefined) {
            const temp = parsedTelemetry.temperatureCelsius;
            if (temp < 2.0 || temp > 25.0) {
                coldChainAlert = true;
                parsedTelemetry.coldChainBreach = true;
            }
        }

        const timestampIso = this._getTxTimestampIso(ctx);
        const txId = ctx.stub.getTxID();

        // Step 0 Cryptographic Waypoint (prevHash is 64 zeros for genesis)
        const genesisPrevHash = '0'.repeat(64);
        const initialWaypointData = {
            stepIndex: 0,
            action: 'MANUFACTURED_AND_SEALED',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: facilityName || 'Manufacturer Facility',
                formattedAddress: address || 'Manufacturing Plant'
            },
            telemetry: parsedTelemetry,
            txId: txId,
            prevHash: genesisPrevHash
        };

        const entryHash = this._computeHash(initialWaypointData);
        const initialWaypoint = { ...initialWaypointData, entryHash };

        const medicineAsset = {
            docType: 'medicine',
            medicineId: medicineId,
            batchNumber: batchNumber,
            drugDetails: parsedDrugDetails,
            manufacturerInfo: {
                orgMsp: callerMsp,
                registeredBy: callerId,
                manufacturingDate: timestampIso,
                expiryDate: expiryDate
            },
            currentOwner: {
                orgMsp: callerMsp,
                holderId: callerId,
                role: 'MANUFACTURER'
            },
            status: 'MANUFACTURED',
            isRecalled: false,
            coldChainBreached: coldChainAlert,
            recallReason: '',
            verificationTokenHash: verificationTokenHash,
            routeHistory: [initialWaypoint]
        };

        await ctx.stub.putState(medicineId, Buffer.from(JSON.stringify(medicineAsset)));

        ctx.stub.setEvent('MedicineCreated', Buffer.from(JSON.stringify({
            medicineId,
            batchNumber,
            manufacturerMsp: callerMsp,
            timestamp: timestampIso,
            coldChainBreached: coldChainAlert
        })));

        return JSON.stringify(medicineAsset);
    }

    /**
     * 2. Update in-transit GPS route checkpoint
     */
    async updateLocationCheckpoint(
        ctx,
        medicineId,
        lat,
        lng,
        facilityName,
        address,
        telemetryJson
    ) {
        this._validateId(medicineId, 'medicineId');
        const coords = this._validateCoordinates(lat, lng);

        const medicineBytes = await ctx.stub.getState(medicineId);
        if (!medicineBytes || medicineBytes.length === 0) {
            throw new Error(`Medicine ${medicineId} does not exist.`);
        }

        const medicine = JSON.parse(medicineBytes.toString());

        // Finite State Machine (FSM) Checks
        if (medicine.isRecalled) {
            throw new Error(`FSM Violation: Cannot update checkpoint. Medicine ${medicineId} is RECALLED.`);
        }
        if (medicine.status === 'DISPENSED') {
            throw new Error(`FSM Violation: Cannot update checkpoint. Medicine ${medicineId} is already DISPENSED.`);
        }

        const callerMsp = this._getCallerMsp(ctx);
        const callerId = this._getCallerId(ctx);
        const timestampIso = this._getTxTimestampIso(ctx);
        const txId = ctx.stub.getTxID();

        let parsedTelemetry = {};
        if (telemetryJson) {
            try {
                parsedTelemetry = JSON.parse(telemetryJson);
            } catch (err) {
                parsedTelemetry = { raw: telemetryJson };
            }
        }

        // Anomaly Detection: Temperature Breach
        if (parsedTelemetry.temperatureCelsius !== undefined) {
            const temp = parsedTelemetry.temperatureCelsius;
            if (temp < 2.0 || temp > 25.0) {
                medicine.coldChainBreached = true;
                parsedTelemetry.coldChainBreach = true;
            }
        }

        // Cryptographic Hash Pointer Chaining
        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const nextStepIndex = medicine.routeHistory.length;
        const waypointData = {
            stepIndex: nextStepIndex,
            action: 'IN_TRANSIT_GPS_CHECKPOINT',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: facilityName || 'In-Transit GPS Waypoint',
                formattedAddress: address || 'Current Coordinates'
            },
            telemetry: parsedTelemetry,
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        const newWaypoint = { ...waypointData, entryHash };

        medicine.routeHistory.push(newWaypoint);
        medicine.status = 'IN_TRANSIT';

        await ctx.stub.putState(medicineId, Buffer.from(JSON.stringify(medicine)));

        ctx.stub.setEvent('CheckpointUpdated', Buffer.from(JSON.stringify({
            medicineId,
            stepIndex: nextStepIndex,
            lat: coords.lat,
            lng: coords.lng,
            txId
        })));

        return JSON.stringify(medicine);
    }

    /**
     * 3. Stock arrival at Retailer / Pharmacy
     */
    async receiveAtRetailer(
        ctx,
        medicineId,
        lat,
        lng,
        facilityName,
        address,
        telemetryJson
    ) {
        this._validateId(medicineId, 'medicineId');
        const coords = this._validateCoordinates(lat, lng);

        const medicineBytes = await ctx.stub.getState(medicineId);
        if (!medicineBytes || medicineBytes.length === 0) {
            throw new Error(`Medicine ${medicineId} does not exist.`);
        }

        const medicine = JSON.parse(medicineBytes.toString());

        if (medicine.isRecalled) {
            throw new Error(`CRITICAL: Cannot receive recalled medicine ${medicineId}. Quarantine immediately!`);
        }

        const callerMsp = this._getCallerMsp(ctx);
        const callerId = this._getCallerId(ctx);
        const timestampIso = this._getTxTimestampIso(ctx);
        const txId = ctx.stub.getTxID();

        let parsedTelemetry = {};
        if (telemetryJson) {
            try {
                parsedTelemetry = JSON.parse(telemetryJson);
            } catch (err) {
                parsedTelemetry = { raw: telemetryJson };
            }
        }

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const nextStepIndex = medicine.routeHistory.length;
        const waypointData = {
            stepIndex: nextStepIndex,
            action: 'STOCK_ARRIVED_AT_PHARMACY',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: facilityName || 'Retail Pharmacy Store',
                formattedAddress: address || 'Pharmacy Location'
            },
            telemetry: parsedTelemetry,
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        const waypoint = { ...waypointData, entryHash };

        medicine.currentOwner = {
            orgMsp: callerMsp,
            holderId: callerId,
            role: 'PHARMACY'
        };
        medicine.status = 'READY_FOR_SALE';
        medicine.routeHistory.push(waypoint);

        await ctx.stub.putState(medicineId, Buffer.from(JSON.stringify(medicine)));

        ctx.stub.setEvent('StockReceivedAtRetailer', Buffer.from(JSON.stringify({
            medicineId,
            pharmacyMsp: callerMsp,
            status: medicine.status,
            txId
        })));

        return JSON.stringify(medicine);
    }

    /**
     * 4. Dispense medicine to patient / customer
     * Uses constant-time hash comparison to prevent timing attacks.
     */
    async dispenseToCustomer(ctx, medicineId, verificationToken, lat, lng, pharmacyName) {
        this._validateId(medicineId, 'medicineId');

        const medicineBytes = await ctx.stub.getState(medicineId);
        if (!medicineBytes || medicineBytes.length === 0) {
            throw new Error(`Medicine ${medicineId} does not exist.`);
        }

        const medicine = JSON.parse(medicineBytes.toString());

        if (medicine.isRecalled) {
            throw new Error(`CRITICAL: Cannot dispense recalled medicine ${medicineId}!`);
        }
        if (medicine.status === 'DISPENSED') {
            throw new Error(`FRAUD ALERT: Medicine ${medicineId} has already been marked as DISPENSED.`);
        }

        // Constant-time cryptographic verification
        if (medicine.verificationTokenHash) {
            const computedHash = crypto.createHash('sha256').update(verificationToken || '').digest('hex');
            const isMatch = this._timingSafeEqual(computedHash, medicine.verificationTokenHash);
            if (!isMatch) {
                throw new Error(`AUTHENTICATION FAILED: Invalid verification token for medicine ${medicineId}. Possible counterfeit!`);
            }
        }

        const callerMsp = this._getCallerMsp(ctx);
        const callerId = this._getCallerId(ctx);
        const timestampIso = this._getTxTimestampIso(ctx);
        const txId = ctx.stub.getTxID();

        const lastLoc = medicine.routeHistory[medicine.routeHistory.length - 1]?.location || {};
        const coords = this._validateCoordinates(lat || lastLoc.latitude || 0.0, lng || lastLoc.longitude || 0.0);

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const nextStepIndex = medicine.routeHistory.length;
        const waypointData = {
            stepIndex: nextStepIndex,
            action: 'DISPENSED_TO_CUSTOMER',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: pharmacyName || 'Dispensing Counter',
                formattedAddress: 'Final Point of Sale'
            },
            telemetry: { verifiedAuthentic: true },
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        const waypoint = { ...waypointData, entryHash };

        medicine.status = 'DISPENSED';
        medicine.currentOwner = {
            orgMsp: 'CONSUMER',
            holderId: 'VERIFIED_PATIENT',
            role: 'CUSTOMER'
        };
        medicine.routeHistory.push(waypoint);

        await ctx.stub.putState(medicineId, Buffer.from(JSON.stringify(medicine)));

        ctx.stub.setEvent('MedicineDispensed', Buffer.from(JSON.stringify({
            medicineId,
            dispensedAt: timestampIso,
            txId
        })));

        return JSON.stringify(medicine);
    }

    /**
     * 5. Emergency Recall
     */
    async flagRecall(ctx, medicineId, recallReason) {
        this._validateId(medicineId, 'medicineId');

        const medicineBytes = await ctx.stub.getState(medicineId);
        if (!medicineBytes || medicineBytes.length === 0) {
            throw new Error(`Medicine ${medicineId} does not exist.`);
        }

        const medicine = JSON.parse(medicineBytes.toString());
        const callerMsp = this._getCallerMsp(ctx);
        const callerId = this._getCallerId(ctx);
        const timestampIso = this._getTxTimestampIso(ctx);
        const txId = ctx.stub.getTxID();

        medicine.isRecalled = true;
        medicine.status = 'RECALLED';
        medicine.recallReason = recallReason || 'Safety alert issued by authority';

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint ? (lastWaypoint.entryHash || this._computeHash(lastWaypoint)) : '0'.repeat(64);

        const nextStepIndex = medicine.routeHistory.length;
        const waypointData = {
            stepIndex: nextStepIndex,
            action: 'RECALL_FLAGGED',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: lastWaypoint?.location?.latitude || 0.0,
                longitude: lastWaypoint?.location?.longitude || 0.0,
                facilityName: 'Safety Authority Action',
                formattedAddress: 'Regulatory Quarantine'
            },
            telemetry: { recallReason: medicine.recallReason },
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        medicine.routeHistory.push({ ...waypointData, entryHash });

        await ctx.stub.putState(medicineId, Buffer.from(JSON.stringify(medicine)));

        ctx.stub.setEvent('MedicineRecalled', Buffer.from(JSON.stringify({
            medicineId,
            reason: medicine.recallReason,
            flaggedBy: callerMsp,
            timestamp: timestampIso
        })));

        return JSON.stringify(medicine);
    }

    /**
     * 6. Query current World State
     */
    async queryMedicine(ctx, medicineId) {
        this._validateId(medicineId, 'medicineId');
        const medicineBytes = await ctx.stub.getState(medicineId);
        if (!medicineBytes || medicineBytes.length === 0) {
            throw new Error(`Medicine ${medicineId} not found on the ledger.`);
        }
        return medicineBytes.toString();
    }

    /**
     * 7. Query complete cryptographic ledger history of an asset
     */
    async queryMedicineHistory(ctx, medicineId) {
        this._validateId(medicineId, 'medicineId');
        const iterator = await ctx.stub.getHistoryForKey(medicineId);
        const allResults = [];

        let result = await iterator.next();
        while (!result.done) {
            const record = {
                txId: result.value.txId,
                timestamp: result.value.timestamp,
                isDelete: result.value.isDelete
            };

            if (result.value.value && result.value.value.length > 0) {
                try {
                    record.value = JSON.parse(result.value.value.toString('utf8'));
                } catch (err) {
                    record.value = result.value.value.toString('utf8');
                }
            } else {
                record.value = null;
            }

            allResults.push(record);
            result = await iterator.next();
        }
        await iterator.close();

        return JSON.stringify(allResults);
    }
}

module.exports = PharmaContract;
