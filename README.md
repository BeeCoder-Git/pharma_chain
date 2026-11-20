# Decentralized Pharmaceutical Supply Chain Tracking Platform (Hardened Edition)

An enterprise-grade, permissioned pharmaceutical provenance and anti-counterfeiting tracking platform built on **Hyperledger Fabric**, featuring physical route mapping with the **Google Maps API**, cryptographic QR code packaging verification, real-time GPS telemetry logging, and comprehensive defense-in-depth security.

---

## 🛡️ Enhanced Security Architecture

| Security Control | Implementation Mechanism | Threat Mitigated |
| :--- | :--- | :--- |
| **Cryptographic Hash Chaining** | Each waypoint in `routeHistory` stores `prevHash` and `entryHash` (SHA-256) | Off-chain data tampering, cache spoofing, history rewrite |
| **Constant-Time Verification** | `crypto.timingSafeEqual` for packaging secret token comparison | Side-channel timing attacks attempting to guess token hashes |
| **Input & Coordinate Bounds** | Strict validation of Latitude $[-90, 90]$, Longitude $[-180, 180]$, alphanumeric ID regex | Injection attacks, ledger key pollution, GPS distortion |
| **FSM State Machine Enforcement** | Smart contract rejects state mutations on `DISPENSED` or `RECALLED` assets | Re-use of dispensed QR codes, double-spending, zombie assets |
| **Cold-Chain Anomaly Detection** | Real-time thermal telemetry evaluation ($2^\circ\text{C} - 25^\circ\text{C}$ bounds) | Compromised medicine consumption due to temperature breaches |
| **HTTP Security Headers** | `helmet` configured with strict Content Security Policy (CSP), HSTS, and frame protection | XSS, Clickjacking, MIME-sniffing |
| **Dual-Tier Rate Limiting** | `express-rate-limit` (General: 500 req / 15m; Verification: 60 req / 5m) | Distributed Denial of Service (DDoS), QR token brute-forcing |
| **Consortium RBAC & JWT** | Role-based JWT certificates for Manufacturer, Transporter, and Pharmacy | Unauthorized ledger state mutation by unverified actors |
| **Client-Side XSS Hardening** | `escapeHtml` sanitization across all dynamically rendered DOM elements | Stored Cross-Site Scripting (XSS) attacks |

---

## 🏛️ Consortium Architecture

* **Consortium Channel:** `pharma-tracking-channel`
* **Orderer Service:** Raft Crash Fault Tolerant (CFT) cluster
* **State Database:** CouchDB (with secondary indexes on `docType` and `batchNumber`)
* **Consortium Organizations:**
  * **`ManufacturerMSP`**: Registers medicine digital twins, initializes production origin coordinates, and mints unique packaging QR codes.
  * **`DistributorMSP`**: Endorses in-transit custody transfers, logs GPS coordinates, and monitors cold-chain temperature telemetry.
  * **`PharmacyMSP`**: Inspects packaging seals, records stock arrivals, marks assets `READY_FOR_SALE`, and dispenses to patients.
  * **`Consumer/Patient`**: Scans the QR code to verify cryptographic authenticity on the immutable blockchain ledger and render the full physical journey on a Google Map.

---

## 📂 Project Structure

```
pharma-supplychain/
├── chaincode/                         # [Phase 2] Hyperledger Fabric Smart Contracts
│   ├── package.json                   # Fabric contract manifest
│   ├── index.js                       # Contract entrypoint
│   ├── lib/
│   │   └── PharmaContract.js          # Hardened Chaincode (Hash pointers, FSM, RBAC)
│   └── META-INF/statedb/couchdb/indexes/
│       └── indexBatch.json            # CouchDB state database index
│
├── backend/                           # [Phase 3] Node.js Express API & Fabric Gateway
│   ├── package.json                   # Dependencies (express, helmet, express-rate-limit, jsonwebtoken, etc.)
│   ├── connection-profile.json        # Hyperledger Fabric Common Connection Profile (CCP)
│   ├── test-suite.js                  # Automated 7-point security audit test suite
│   └── src/
│       ├── server.js                  # Express API Server with Helmet CSP & rate limiters
│       ├── config.js                  # Gateway, Ports, and Environment Settings
│       ├── middleware/
│       │   └── security.js            # JWT verification, rate limiting, and sanitization
│       ├── fabric/
│       │   ├── fabricGateway.js       # Production Fabric Gateway SDK adapter
│       │   └── mockLedgerService.js   # Hardened Ledger Simulator (Seed data loaded)
│       └── routes/
│           └── medicineRoutes.js      # Secured REST API endpoints & QR Code Generator
│
├── frontend/                          # [Phase 4] Web Client & Google Maps
│   ├── index.html                     # Responsive UI with 4 Actor Dashboards
│   ├── css/
│   │   └── styles.css                 # Glassmorphic UI, status badges, timeline
│   └── js/
│       ├── api.js                     # REST API client with JWT bearer authentication
│       ├── maps.js                    # Google Maps API loader & Leaflet fallback engine
│       ├── qrScanner.js               # Camera barcode scanner (html5-qrcode) & file drop
│       └── app.js                     # Main application controller with XSS sanitization
│
└── README.md
```

---

## 🚀 Running the Security Audit Test Suite

To run the automated 7-step cryptographic and security test suite:

```powershell
cd backend
node test-suite.js
```

---

## 🏃 Starting the Application

```powershell
cd backend
npm start
```

1. Open your browser to: **`http://localhost:3000`**
2. View the pre-loaded verifiable medicine batch:
   **`http://localhost:3000/#verify?id=MED-2026-98421A&token=VERIFY_TOKEN_98421A`**
