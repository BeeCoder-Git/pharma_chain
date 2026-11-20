'use strict';

const fs = require('fs');
const path = require('path');
const config = require('../config');

let gatewayClient = null;
let network = null;
let contract = null;

/**
 * Initialize connection to Hyperledger Fabric Gateway (v2.4+ / Fabric Gateway SDK)
 */
async function initFabricGateway() {
    try {
        const { connect, signers } = require('@hyperledger/fabric-gateway');
        const grpc = require('@grpc/grpc-js');
        const crypto = require('crypto');

        console.log(`Connecting to Hyperledger Fabric peer at ${config.fabric.peerEndpoint}...`);

        let tlsRootCert = null;
        if (config.fabric.tlsCertPath && fs.existsSync(config.fabric.tlsCertPath)) {
            tlsRootCert = fs.readFileSync(config.fabric.tlsCertPath);
        }

        const client = new grpc.Client(
            config.fabric.peerEndpoint,
            tlsRootCert ? grpc.credentials.createSsl(tlsRootCert) : grpc.credentials.createInsecure(),
            {
                'grpc.ssl_target_name_override': config.fabric.peerHostAlias
            }
        );

        let credentials = null;
        if (config.fabric.userCertPath && fs.existsSync(config.fabric.userCertPath)) {
            credentials = fs.readFileSync(config.fabric.userCertPath);
        } else {
            console.warn('Fabric user certificate not found at path; using mock gateway credentials.');
            credentials = Buffer.from('MOCK_CERT');
        }

        let privateKey = null;
        if (config.fabric.keyDirectoryPath && fs.existsSync(config.fabric.keyDirectoryPath)) {
            const keyFiles = fs.readdirSync(config.fabric.keyDirectoryPath);
            if (keyFiles.length > 0) {
                const keyPath = path.join(config.fabric.keyDirectoryPath, keyFiles[0]);
                privateKey = crypto.createPrivateKey(fs.readFileSync(keyPath));
            }
        }

        const signer = privateKey ? signers.newPrivateKeySigner(privateKey) : signers.newPrivateKeySigner(crypto.generateKeyPairSync('ec', { namedCurve: 'secp256r1' }).privateKey);

        gatewayClient = connect({
            client,
            identity: {
                mspId: config.fabric.mspId,
                credentials
            },
            signer,
            evaluateOptions: () => ({ deadline: Date.now() + 5000 }),
            endorseOptions: () => ({ deadline: Date.now() + 15000 }),
            submitOptions: () => ({ deadline: Date.now() + 5000 }),
            commitStatusOptions: () => ({ deadline: Date.now() + 60000 })
        });

        network = gatewayClient.getNetwork(config.fabric.channelName);
        contract = network.getContract(config.fabric.chaincodeName);
        console.log(`Fabric Gateway successfully connected to channel: ${config.fabric.channelName}`);
        return true;
    } catch (err) {
        console.warn(`Could not connect to live Fabric Gateway (${err.message}). Falling back to Ledger Simulator.`);
        return false;
    }
}

/**
 * Submit state-mutating transaction to Fabric Network
 */
async function submitTransaction(txName, ...args) {
    if (!contract) {
        throw new Error('Fabric Gateway contract is not initialized.');
    }
    const stringArgs = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)));
    const resultBytes = await contract.submitTransaction(txName, ...stringArgs);
    const resultString = Buffer.from(resultBytes).toString('utf8');
    return resultString ? JSON.parse(resultString) : null;
}

/**
 * Evaluate read-only query against Fabric Network
 */
async function evaluateTransaction(txName, ...args) {
    if (!contract) {
        throw new Error('Fabric Gateway contract is not initialized.');
    }
    const stringArgs = args.map(a => (typeof a === 'object' ? JSON.stringify(a) : String(a)));
    const resultBytes = await contract.evaluateTransaction(txName, ...stringArgs);
    const resultString = Buffer.from(resultBytes).toString('utf8');
    return resultString ? JSON.parse(resultString) : null;
}

module.exports = {
    initFabricGateway,
    submitTransaction,
    evaluateTransaction
};
