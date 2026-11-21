'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DATA_DIR = path.resolve(__dirname, '../../data');
const STORE_FILE = path.join(DATA_DIR, 'fabric_ledger_store.json');

/**
 * MockLedgerService - Hardened Edition with File-Backed Disk Persistence
 * High-fidelity Hyperledger Fabric Ledger Simulator with cryptographic hash pointer
 * chaining, constant-time validation, coordinate bounds checking, and cold-chain anomaly detection.
 * Automatically saves state to backend/data/fabric_ledger_store.json to guarantee permanent storage across restarts.
 */
class MockLedgerService {
    constructor() {
        this.worldState = new Map();
        this.historyLedger = new Map();
        this.blockHeight = 1;
        this._ensureDataDir();
        this._loadFromDisk();
    }

    _ensureDataDir() {
        try {
            if (!fs.existsSync(DATA_DIR)) {
                fs.mkdirSync(DATA_DIR, { recursive: true });
            }
        } catch (err) {
            console.warn('[Ledger Persistence] Could not create data directory:', err.message);
        }
    }

    _loadFromDisk() {
        try {
            if (fs.existsSync(STORE_FILE)) {
                const raw = fs.readFileSync(STORE_FILE, 'utf8');
                if (raw && raw.trim().length > 0) {
                    const data = JSON.parse(raw);
                    if (Array.isArray(data.worldState)) {
                        this.worldState = new Map(data.worldState);
                    }
                    if (Array.isArray(data.historyLedger)) {
                        this.historyLedger = new Map(data.historyLedger);
                    }
                    if (typeof data.blockHeight === 'number') {
                        this.blockHeight = data.blockHeight;
                    }
                    console.log(`[Fabric Ledger Simulator] Persistent ledger loaded from disk: ${this.worldState.size} digital twins, Block Height: #${this.blockHeight}.`);
                }
            }
        } catch (err) {
            console.warn('[Ledger Persistence] Warning loading ledger store from disk:', err.message);
        }
    }

    _saveToDisk() {
        try {
            this._ensureDataDir();
            const storeData = {
                version: '1.0.0',
                channel: 'pharma-tracking-channel',
                lastSavedAt: new Date().toISOString(),
                blockHeight: this.blockHeight,
                worldState: Array.from(this.worldState.entries()),
                historyLedger: Array.from(this.historyLedger.entries())
            };
            fs.writeFileSync(STORE_FILE, JSON.stringify(storeData, null, 2), 'utf8');
        } catch (err) {
            console.warn('[Ledger Persistence] Failed to write ledger store to disk:', err.message);
        }
    }

    clearLedgerData() {
        this.worldState.clear();
        this.historyLedger.clear();
        this.blockHeight = 1;
        try {
            if (fs.existsSync(STORE_FILE)) {
                fs.unlinkSync(STORE_FILE);
            }
        } catch (e) {}
        console.log('[Fabric Ledger Simulator] Ledger data cleared.');
    }

    _generateTxId() {
        return crypto.randomBytes(32).toString('hex');
    }

    _computeHash(data) {
        return crypto.createHash('sha256').update(JSON.stringify(data)).digest('hex');
    }

    _timingSafeEqual(strA, strB) {
        if (typeof strA !== 'string' || typeof strB !== 'string') return false;
        const bufA = Buffer.from(strA, 'utf8');
        const bufB = Buffer.from(strB, 'utf8');
        if (bufA.length !== bufB.length) return false;
        return crypto.timingSafeEqual(bufA, bufB);
    }

    _validateId(id, fieldName = 'ID') {
        if (!id || typeof id !== 'string') throw new Error(`Invalid ${fieldName}: must be non-empty string.`);
        if (!/^[A-Za-z0-9\-_]{3,64}$/.test(id)) {
            throw new Error(`Security Violation: ${fieldName} '${id}' contains invalid characters.`);
        }
    }

    _validateCoordinates(lat, lng) {
        const nLat = parseFloat(lat);
        const nLng = parseFloat(lng);
        if (isNaN(nLat) || nLat < -90 || nLat > 90) throw new Error(`Latitude ${lat} out of bounds [-90, 90].`);
        if (isNaN(nLng) || nLng < -180 || nLng > 180) throw new Error(`Longitude ${lng} out of bounds [-180, 180].`);
        return { lat: nLat, lng: nLng };
    }

    _recordHistory(key, value, isDelete = false, explicitTxId = null, action = 'MUTATION', recordedBy = null) {
        if (!this.historyLedger.has(key)) {
            this.historyLedger.set(key, []);
        }
        this.blockHeight++;
        const txId = explicitTxId || this._generateTxId();
        const historyRecord = {
            txId: txId,
            blockNumber: this.blockHeight,
            channel: 'pharma-tracking-channel',
            chaincode: 'pharma-chaincode',
            action: action,
            recordedBy: recordedBy || { orgMsp: 'PeerOrgMSP', userId: 'PEER_COMMITER' },
            timestamp: new Date().toISOString(),
            isDelete: isDelete,
            value: JSON.parse(JSON.stringify(value))
        };
        this.historyLedger.get(key).push(historyRecord);
        this._saveToDisk();
        return txId;
    }

    async initMedicine(params) {
        const {
            medicineId,
            batchNumber,
            drugDetails,
            expiryDate,
            verificationTokenHash,
            lat,
            lng,
            facilityName,
            address,
            telemetry,
            callerMsp = 'ManufacturerMSP',
            callerId = 'MANUFACTURER_ADMIN'
        } = params;

        this._validateId(medicineId, 'medicineId');
        this._validateId(batchNumber, 'batchNumber');
        const coords = this._validateCoordinates(lat, lng);

        if (this.worldState.has(medicineId)) {
            throw new Error(`Medicine ${medicineId} already exists on the ledger.`);
        }

        const timestampIso = new Date().toISOString();
        const txId = this._generateTxId();

        let parsedTelemetry = telemetry || { temperatureCelsius: 21.0, humidityPercent: 45 };
        let coldChainBreached = false;
        if (parsedTelemetry.temperatureCelsius !== undefined) {
            const temp = parsedTelemetry.temperatureCelsius;
            if (temp < 2.0 || temp > 25.0) {
                coldChainBreached = true;
                parsedTelemetry.coldChainBreach = true;
            }
        }

        const genesisPrevHash = '0'.repeat(64);
        const waypointData = {
            stepIndex: 0,
            action: 'MANUFACTURED_AND_SEALED',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: facilityName || 'Manufacturing Plant',
                formattedAddress: address || 'Production Site'
            },
            telemetry: parsedTelemetry,
            txId: txId,
            prevHash: genesisPrevHash
        };

        const entryHash = this._computeHash(waypointData);
        const initialWaypoint = { ...waypointData, entryHash };

        const medicineAsset = {
            docType: 'medicine',
            medicineId,
            batchNumber,
            drugDetails: typeof drugDetails === 'string' ? JSON.parse(drugDetails) : drugDetails,
            manufacturerInfo: {
                orgMsp: callerMsp,
                registeredBy: callerId,
                manufacturingDate: timestampIso,
                expiryDate
            },
            currentOwner: {
                orgMsp: callerMsp,
                holderId: callerId,
                role: 'MANUFACTURER'
            },
            status: 'MANUFACTURED',
            isRecalled: false,
            coldChainBreached,
            recallReason: '',
            verificationTokenHash,
            secretTokenDemo: params.verificationTokenRaw || params.secretToken || '',
            routeHistory: [initialWaypoint]
        };

        this.worldState.set(medicineId, medicineAsset);
        this._recordHistory(medicineId, medicineAsset, false, txId, 'MANUFACTURED_AND_SEALED', { orgMsp: callerMsp, userId: callerId });
        return medicineAsset;
    }

    async updateLocationCheckpoint(params) {
        const { medicineId, lat, lng, facilityName, address, telemetry, callerMsp = 'DistributorMSP', callerId = 'TRANSPORTER_MOBILE' } = params;
        this._validateId(medicineId, 'medicineId');
        const coords = this._validateCoordinates(lat, lng);

        const medicine = this.worldState.get(medicineId);
        if (!medicine) throw new Error(`Medicine ${medicineId} not found.`);
        if (medicine.isRecalled) throw new Error(`FSM Violation: Medicine ${medicineId} is RECALLED.`);
        if (medicine.status === 'DISPENSED') throw new Error(`FSM Violation: Medicine ${medicineId} is already DISPENSED.`);

        const timestampIso = new Date().toISOString();
        const txId = this._generateTxId();

        let parsedTelemetry = telemetry || { temperatureCelsius: 21.0, humidityPercent: 43 };
        if (parsedTelemetry.temperatureCelsius !== undefined) {
            const temp = parsedTelemetry.temperatureCelsius;
            if (temp < 2.0 || temp > 25.0) {
                medicine.coldChainBreached = true;
                parsedTelemetry.coldChainBreach = true;
            }
        }

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const waypointData = {
            stepIndex: medicine.routeHistory.length,
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
        medicine.routeHistory.push({ ...waypointData, entryHash });
        medicine.status = 'IN_TRANSIT';

        this.worldState.set(medicineId, medicine);
        this._recordHistory(medicineId, medicine, false, txId, 'IN_TRANSIT_GPS_CHECKPOINT', { orgMsp: callerMsp, userId: callerId });
        return medicine;
    }

    async transferCustody(params) {
        const { medicineId, newOwnerMsp, newHolderId, newRole, action, lat, lng, facilityName, address, telemetry, callerMsp = 'DistributorMSP', callerId = 'CUSTODY_AGENT' } = params;
        this._validateId(medicineId, 'medicineId');
        const coords = this._validateCoordinates(lat, lng);

        const medicine = this.worldState.get(medicineId);
        if (!medicine) throw new Error(`Medicine ${medicineId} not found.`);
        if (medicine.isRecalled) throw new Error(`Medicine ${medicineId} is RECALLED.`);
        if (medicine.status === 'DISPENSED') throw new Error(`Medicine ${medicineId} has already been dispensed.`);

        const timestampIso = new Date().toISOString();
        const txId = this._generateTxId();

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const waypointData = {
            stepIndex: medicine.routeHistory.length,
            action: action || 'CUSTODY_TRANSFERRED',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: facilityName || 'Transfer Facility',
                formattedAddress: address || 'Transfer Site'
            },
            telemetry: telemetry || {},
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        medicine.currentOwner = { orgMsp: newOwnerMsp, holderId: newHolderId, role: newRole || 'TRANSPORTER' };
        if (newRole === 'TRANSPORTER') medicine.status = 'IN_TRANSIT';
        else if (newRole === 'DISTRIBUTOR') medicine.status = 'AT_DISTRIBUTOR_HUB';
        else if (newRole === 'PHARMACY') medicine.status = 'AT_PHARMACY';

        medicine.routeHistory.push({ ...waypointData, entryHash });
        this.worldState.set(medicineId, medicine);
        this._recordHistory(medicineId, medicine, false, txId, action || 'CUSTODY_TRANSFERRED', { orgMsp: callerMsp, userId: callerId });
        return medicine;
    }

    async receiveAtRetailer(params) {
        const { medicineId, lat, lng, facilityName, address, telemetry, callerMsp = 'PharmacyMSP', callerId = 'PHARMACIST_REC' } = params;
        this._validateId(medicineId, 'medicineId');
        const coords = this._validateCoordinates(lat, lng);

        const medicine = this.worldState.get(medicineId);
        if (!medicine) throw new Error(`Medicine ${medicineId} not found.`);
        if (medicine.isRecalled) throw new Error(`Medicine ${medicineId} is RECALLED.`);

        const timestampIso = new Date().toISOString();
        const txId = this._generateTxId();

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const waypointData = {
            stepIndex: medicine.routeHistory.length,
            action: 'STOCK_ARRIVED_AT_PHARMACY',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: facilityName || 'Retail Pharmacy Store',
                formattedAddress: address || 'Pharmacy Reception'
            },
            telemetry: telemetry || { temperatureCelsius: 20.0, humidityPercent: 44 },
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        medicine.currentOwner = { orgMsp: callerMsp, holderId: callerId, role: 'PHARMACY' };
        medicine.status = 'READY_FOR_SALE';
        medicine.routeHistory.push({ ...waypointData, entryHash });

        this.worldState.set(medicineId, medicine);
        this._recordHistory(medicineId, medicine, false, txId, 'STOCK_ARRIVED_AT_PHARMACY', { orgMsp: callerMsp, userId: callerId });
        return medicine;
    }

    async dispenseToCustomer(params) {
        const { medicineId, token, lat, lng, pharmacyName, callerMsp = 'PharmacyMSP', callerId = 'DISPENSING_COUNTER' } = params;
        this._validateId(medicineId, 'medicineId');

        const medicine = this.worldState.get(medicineId);
        if (!medicine) throw new Error(`Medicine ${medicineId} not found.`);
        if (medicine.isRecalled) throw new Error(`CRITICAL: Cannot dispense recalled medicine ${medicineId}!`);
        if (medicine.status === 'DISPENSED') throw new Error(`FRAUD ALERT: Medicine ${medicineId} has already been dispensed.`);

        // Constant-time token verification
        if (medicine.verificationTokenHash) {
            const computedHash = crypto.createHash('sha256').update(token || '').digest('hex');
            const isMatch = this._timingSafeEqual(computedHash, medicine.verificationTokenHash);
            if (!isMatch) {
                throw new Error(`AUTHENTICATION FAILED: Invalid verification token for medicine ${medicineId}. Possible counterfeit!`);
            }
        }

        const timestampIso = new Date().toISOString();
        const txId = this._generateTxId();
        const lastLoc = medicine.routeHistory[medicine.routeHistory.length - 1]?.location || {};
        const coords = this._validateCoordinates(lat || lastLoc.latitude || 0.0, lng || lastLoc.longitude || 0.0);

        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint.entryHash || this._computeHash(lastWaypoint);

        const waypointData = {
            stepIndex: medicine.routeHistory.length,
            action: 'DISPENSED_TO_CUSTOMER',
            timestamp: timestampIso,
            recordedBy: { userId: callerId, orgMsp: callerMsp },
            location: {
                latitude: coords.lat,
                longitude: coords.lng,
                facilityName: pharmacyName || 'Dispensing Counter',
                formattedAddress: 'Final Sale Point'
            },
            telemetry: { verifiedAuthentic: true },
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        medicine.status = 'DISPENSED';
        medicine.currentOwner = { orgMsp: 'CONSUMER', holderId: 'VERIFIED_PATIENT', role: 'CUSTOMER' };
        medicine.routeHistory.push({ ...waypointData, entryHash });

        this.worldState.set(medicineId, medicine);
        this._recordHistory(medicineId, medicine, false, txId, 'DISPENSED_TO_CUSTOMER', { orgMsp: callerMsp, userId: callerId });
        return medicine;
    }

    async flagRecall(medicineId, reason, callerMsp = 'ManufacturerMSP') {
        this._validateId(medicineId, 'medicineId');
        const medicine = this.worldState.get(medicineId);
        if (!medicine) throw new Error(`Medicine ${medicineId} not found.`);

        const timestampIso = new Date().toISOString();
        const txId = this._generateTxId();
        const lastWaypoint = medicine.routeHistory[medicine.routeHistory.length - 1];
        const prevHash = lastWaypoint ? (lastWaypoint.entryHash || this._computeHash(lastWaypoint)) : '0'.repeat(64);

        medicine.isRecalled = true;
        medicine.status = 'RECALLED';
        medicine.recallReason = reason || 'Regulatory contamination recall';

        const waypointData = {
            stepIndex: medicine.routeHistory.length,
            action: 'RECALL_FLAGGED',
            timestamp: timestampIso,
            recordedBy: { userId: 'SAFETY_OFFICER', orgMsp: callerMsp },
            location: {
                latitude: lastWaypoint?.location?.latitude || 0.0,
                longitude: lastWaypoint?.location?.longitude || 0.0,
                facilityName: 'Safety Authority Action',
                formattedAddress: 'Quarantine Order'
            },
            telemetry: { recallReason: medicine.recallReason },
            txId: txId,
            prevHash: prevHash
        };

        const entryHash = this._computeHash(waypointData);
        medicine.routeHistory.push({ ...waypointData, entryHash });

        this.worldState.set(medicineId, medicine);
        this._recordHistory(medicineId, medicine, false, txId, 'RECALL_FLAGGED', { orgMsp: callerMsp, userId: 'SAFETY_OFFICER' });
        return medicine;
    }

    async queryMedicine(medicineId) {
        this._validateId(medicineId, 'medicineId');
        const medicine = this.worldState.get(medicineId);
        if (!medicine) throw new Error(`Medicine ${medicineId} not found on the ledger.`);
        return medicine;
    }

    async queryMedicineHistory(medicineId) {
        this._validateId(medicineId, 'medicineId');
        return this.historyLedger.get(medicineId) || [];
    }

    async getAllMedicines() {
        return Array.from(this.worldState.values());
    }
}

module.exports = new MockLedgerService();
