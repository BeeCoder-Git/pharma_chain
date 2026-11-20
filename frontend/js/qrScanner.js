'use strict';

/**
 * QRScannerManager
 * Interfaces with html5-qrcode library for real-time camera scanning,
 * image file upload scanning, and automated ID/token parsing.
 */
class QRScannerManager {
    constructor() {
        this.html5QrCode = null;
        this.isScanning = false;
        this.onScanSuccessCallback = null;
    }

    openScannerModal(onSuccess) {
        this.onScanSuccessCallback = onSuccess;
        const modal = document.getElementById('qr-scanner-modal');
        if (modal) {
            modal.classList.add('active');
            this.startCamera();
        }
    }

    closeScannerModal() {
        const modal = document.getElementById('qr-scanner-modal');
        if (modal) {
            modal.classList.remove('active');
        }
        this.stopCamera();
    }

    async startCamera() {
        if (!window.Html5Qrcode) {
            console.warn('Html5Qrcode library not loaded.');
            return;
        }

        const readerElem = document.getElementById('qr-reader');
        if (!readerElem) return;

        try {
            if (!this.html5QrCode) {
                this.html5QrCode = new Html5Qrcode('qr-reader');
            }

            const cameras = await Html5Qrcode.getCameras();
            if (cameras && cameras.length > 0) {
                const cameraId = cameras[cameras.length - 1].id; // Back/environment camera preferred
                await this.html5QrCode.start(
                    cameraId,
                    {
                        fps: 10,
                        qrbox: { width: 250, height: 250 }
                    },
                    (decodedText, decodedResult) => {
                        this.handleDecodedText(decodedText);
                    },
                    (errorMessage) => {
                        // ignore background parsing frame errors
                    }
                );
                this.isScanning = true;
            } else {
                console.warn('No physical camera detected on device.');
                const statusDiv = document.getElementById('qr-reader-status');
                if (statusDiv) statusDiv.innerText = 'No camera detected. You can upload a QR image or select from the demo buttons.';
            }
        } catch (err) {
            console.error('Camera initialization error:', err);
            const statusDiv = document.getElementById('qr-reader-status');
            if (statusDiv) statusDiv.innerText = `Camera access error: ${err.message}. Please use file upload.`;
        }
    }

    async stopCamera() {
        if (this.html5QrCode && this.isScanning) {
            try {
                await this.html5QrCode.stop();
                this.isScanning = false;
            } catch (err) {
                console.error('Error stopping QR scanner camera:', err);
            }
        }
    }

    async scanImageFile(file) {
        if (!file) return;
        try {
            if (!this.html5QrCode) {
                this.html5QrCode = new Html5Qrcode('qr-reader');
            }
            const decodedText = await this.html5QrCode.scanFile(file, true);
            this.handleDecodedText(decodedText);
        } catch (err) {
            alert('Failed to read QR code from image: ' + err);
        }
    }

    handleDecodedText(text) {
        console.log('QR Code scanned:', text);
        this.closeScannerModal();

        // Extract ID and Token from URL query / hash
        let medicineId = '';
        let token = '';

        try {
            // Check if full URL or JSON or ID
            if (text.includes('id=')) {
                const url = new URL(text.startsWith('http') ? text : `http://dummy.com/${text.replace('#', '')}`);
                medicineId = url.searchParams.get('id') || '';
                token = url.searchParams.get('token') || '';
                if (!medicineId && text.includes('#verify')) {
                    const hashParams = new URLSearchParams(text.split('?')[1]);
                    medicineId = hashParams.get('id') || '';
                    token = hashParams.get('token') || '';
                }
            } else if (text.startsWith('{')) {
                const parsed = JSON.parse(text);
                medicineId = parsed.medicineId || parsed.id || '';
                token = parsed.token || '';
            } else {
                medicineId = text.trim();
            }
        } catch (e) {
            medicineId = text.trim();
        }

        if (this.onScanSuccessCallback) {
            this.onScanSuccessCallback({ medicineId, token, raw: text });
        }
    }
}

window.QRScannerManager = QRScannerManager;
