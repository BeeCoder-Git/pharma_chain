'use strict';

const API = {
    baseUrl: '/api',
    authToken: null,

    setAuthToken(token) {
        this.authToken = token;
        if (token) {
            localStorage.setItem('pharmatrust_token', token);
        } else {
            localStorage.removeItem('pharmatrust_token');
        }
    },

    getAuthToken() {
        if (!this.authToken) {
            this.authToken = localStorage.getItem('pharmatrust_token');
        }
        return this.authToken;
    },

    async request(endpoint, options = {}) {
        const url = `${this.baseUrl}${endpoint}`;
        const token = this.getAuthToken();
        const headers = {
            'Content-Type': 'application/json',
            ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
            ...(options.headers || {})
        };

        try {
            const res = await fetch(url, { ...options, headers });
            const data = await res.json();
            if (!res.ok) {
                throw new Error(data.error || `HTTP error! status: ${res.status}`);
            }
            return data;
        } catch (err) {
            console.error(`API Error [${endpoint}]:`, err);
            throw err;
        }
    },

    async obtainActorToken(role, orgMsp, userId) {
        const res = await this.request('/auth/token', {
            method: 'POST',
            body: JSON.stringify({ role, orgMsp, userId })
        });
        if (res.token) {
            this.setAuthToken(res.token);
        }
        return res;
    },

    async getConfig() {
        return this.request('/config');
    },

    async getAllMedicines() {
        return this.request('/medicines');
    },

    async getMedicine(id) {
        return this.request(`/medicine/${encodeURIComponent(id)}`);
    },

    async getMedicineHistory(id) {
        return this.request(`/medicine/${encodeURIComponent(id)}/history`);
    },

    async getTx(txId) {
        return this.request(`/tx/${encodeURIComponent(txId)}`);
    },

    async getQrCode(id, token = '') {
        return this.request(`/medicine/${encodeURIComponent(id)}/qr?token=${encodeURIComponent(token)}`);
    },

    async verifyMedicine(id, token = '') {
        return this.request(`/medicine/${encodeURIComponent(id)}/verify?token=${encodeURIComponent(token)}`);
    },

    async initMedicine(data) {
        return this.request('/medicine/init', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async updateCheckpoint(data) {
        return this.request('/medicine/checkpoint', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async transferCustody(data) {
        return this.request('/medicine/transfer', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async receiveStock(data) {
        return this.request('/medicine/receive', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async dispenseMedicine(data) {
        return this.request('/medicine/dispense', {
            method: 'POST',
            body: JSON.stringify(data)
        });
    },

    async recallMedicine(medicineId, reason) {
        return this.request('/medicine/recall', {
            method: 'POST',
            body: JSON.stringify({ medicineId, reason })
        });
    }
};

window.API = API;
