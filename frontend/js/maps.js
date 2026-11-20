'use strict';

/**
 * RouteMapEngine
 * Manages route rendering across Google Maps JavaScript API with automatic fallback
 * to Leaflet/OpenStreetMap if an active Google Maps API key is not configured.
 */
class RouteMapEngine {
    constructor(containerId = 'tracking-map') {
        this.containerId = containerId;
        this.currentMode = 'UNINITIALIZED'; // 'GOOGLE_MAPS' | 'LEAFLET'
        this.googleMap = null;
        this.leafletMap = null;
        this.googleMarkers = [];
        this.googlePolyline = null;
        this.leafletMarkers = [];
        this.leafletPolyline = null;
        this.currentWaypoints = [];
        this.apiKey = '';
    }

    setApiKey(key) {
        this.apiKey = key ? key.trim() : '';
    }

    /**
     * Initialize map with preferred engine
     */
    async init(preferredApiKey = '') {
        if (preferredApiKey) {
            this.setApiKey(preferredApiKey);
        }

        const container = document.getElementById(this.containerId);
        if (!container) return;

        // Catch Google Maps auth failure globally and auto-fallback to Leaflet
        window.gm_authFailure = () => {
            console.warn('Google Maps authentication failure detected. Automatically switching to OpenStreetMap so all users see the map.');
            this.currentMode = 'LEAFLET';
            this._initLeafletMap(container);
            if (this.currentWaypoints && this.currentWaypoints.length > 0) {
                this.plotRoute(this.currentWaypoints);
            }
        };

        if (this.apiKey) {
            try {
                await this._loadGoogleMapsScript(this.apiKey);
                this._initGoogleMap(container);
                this.currentMode = 'GOOGLE_MAPS';
                console.log('Google Maps API successfully initialized for all users.');
                return;
            } catch (err) {
                console.warn('Google Maps failed to load; using OpenStreetMap fallback.', err);
            }
        }

        // Fallback to Leaflet
        this._initLeafletMap(container);
        this.currentMode = 'LEAFLET';
        console.log('Leaflet OpenStreetMap engine initialized.');
    }

    _loadGoogleMapsScript(key) {
        return new Promise((resolve, reject) => {
            if (window.google && window.google.maps) {
                return resolve(window.google.maps);
            }
            const script = document.createElement('script');
            script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=geometry`;
            script.async = true;
            script.defer = true;
            script.onload = () => resolve(window.google.maps);
            script.onerror = (e) => reject(new Error('Failed to load Google Maps script. Check your API key.'));
            document.head.appendChild(script);
        });
    }

    _initGoogleMap(container) {
        const defaultCenter = { lat: 50.1109, lng: 8.6821 }; // Europe central
        this.googleMap = new google.maps.Map(container, {
            zoom: 5,
            center: defaultCenter,
            mapTypeId: 'roadmap',
            styles: [
                { featureType: 'administrative', elementType: 'labels.text.fill', stylers: [{ color: '#444444' }] },
                { featureType: 'landscape', elementType: 'all', stylers: [{ color: '#f2f2f2' }] },
                { featureType: 'poi', elementType: 'all', stylers: [{ visibility: 'off' }] },
                { featureType: 'road', elementType: 'all', stylers: [{ saturation: -100 }, { lightness: 45 }] },
                { featureType: 'road.highway', elementType: 'all', stylers: [{ visibility: 'simplified' }] },
                { featureType: 'water', elementType: 'all', stylers: [{ color: '#cbd5e1' }, { visibility: 'on' }] }
            ]
        });
    }

    _initLeafletMap(container) {
        if (!window.L) {
            console.error('Leaflet library is missing.');
            return;
        }

        if (this.leafletMap) {
            this.leafletMap.remove();
        }

        this.leafletMap = L.map(container).setView([50.1109, 8.6821], 5);
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            maxZoom: 19,
            attribution: '© OpenStreetMap contributors | PharmaChain'
        }).addTo(this.leafletMap);
    }

    /**
     * Plot route waypoints and connecting polyline
     * @param {Array} waypoints - Array of route history objects
     */
    plotRoute(waypoints = []) {
        if (!waypoints || waypoints.length === 0) return;
        this.currentWaypoints = waypoints;

        const validPoints = waypoints.filter(w => w.location && !isNaN(w.location.latitude) && !isNaN(w.location.longitude));
        if (validPoints.length === 0) return;

        if (this.currentMode === 'GOOGLE_MAPS' && this.googleMap) {
            this._plotGoogleRoute(validPoints);
        } else if (this.leafletMap) {
            this._plotLeafletRoute(validPoints);
        }
    }

    _plotGoogleRoute(points) {
        // Clear old markers & polyline
        this.googleMarkers.forEach(m => m.setMap(null));
        this.googleMarkers = [];
        if (this.googlePolyline) {
            this.googlePolyline.setMap(null);
        }

        const bounds = new google.maps.LatLngBounds();
        const pathCoords = [];

        points.forEach((wp, index) => {
            const lat = parseFloat(wp.location.latitude);
            const lng = parseFloat(wp.location.longitude);
            const pos = new google.maps.LatLng(lat, lng);
            pathCoords.push(pos);
            bounds.extend(pos);

            // Determine custom marker icon based on role/stage
            let iconColor = '#2563eb'; // blue default
            let labelChar = String(index + 1);

            if (index === 0) {
                iconColor = '#10b981'; // green for factory
                labelChar = 'F';
            } else if (index === points.length - 1 && wp.action.includes('DISPENSED')) {
                iconColor = '#8b5cf6'; // purple for customer
                labelChar = 'C';
            } else if (wp.action.includes('PHARMACY') || wp.action.includes('READY_FOR_SALE')) {
                iconColor = '#06b6d4'; // cyan for pharmacy
                labelChar = 'P';
            }

            const marker = new google.maps.Marker({
                position: pos,
                map: this.googleMap,
                title: `${wp.action} - ${wp.location.facilityName}`,
                label: {
                    text: labelChar,
                    color: '#ffffff',
                    fontWeight: 'bold'
                },
                icon: {
                    path: google.maps.SymbolPath.CIRCLE,
                    scale: 14,
                    fillColor: iconColor,
                    fillOpacity: 1,
                    strokeWeight: 3,
                    strokeColor: '#ffffff'
                }
            });

            const infoWindowContent = `
                <div style="font-family: sans-serif; padding: 6px; max-width: 260px;">
                    <div style="font-weight: 700; color: #0f172a; margin-bottom: 4px;">Step ${index + 1}: ${wp.action}</div>
                    <div style="font-size: 12px; color: #475569;"><b>Facility:</b> ${wp.location.facilityName || 'N/A'}</div>
                    <div style="font-size: 12px; color: #475569;"><b>Address:</b> ${wp.location.formattedAddress || 'N/A'}</div>
                    <div style="font-size: 12px; color: #475569;"><b>Time:</b> ${new Date(wp.timestamp).toLocaleString()}</div>
                    <div style="font-size: 11px; color: #2563eb; margin-top: 6px; word-break: break-all;"><b>Tx ID:</b> ${wp.txId ? wp.txId.substring(0, 16) + '...' : 'Verified'}</div>
                </div>
            `;
            const infoWindow = new google.maps.InfoWindow({ content: infoWindowContent });
            marker.addListener('click', () => infoWindow.open(this.googleMap, marker));

            this.googleMarkers.push(marker);
        });

        // Draw connected directional polyline
        this.googlePolyline = new google.maps.Polyline({
            path: pathCoords,
            geodesic: true,
            strokeColor: '#2563eb',
            strokeOpacity: 0.85,
            strokeWeight: 4,
            icons: [{
                icon: { path: google.maps.SymbolPath.FORWARD_CLOSED_ARROW, strokeColor: '#1d4ed8', fillColor: '#1d4ed8', fillOpacity: 1 },
                offset: '50%',
                repeat: '100px'
            }]
        });
        this.googlePolyline.setMap(this.googleMap);

        if (points.length === 1) {
            this.googleMap.setCenter(pathCoords[0]);
            this.googleMap.setZoom(12);
        } else {
            this.googleMap.fitBounds(bounds, { top: 40, right: 40, bottom: 40, left: 40 });
        }
    }

    _plotLeafletRoute(points) {
        // Clear old markers & polyline
        this.leafletMarkers.forEach(m => this.leafletMap.removeLayer(m));
        this.leafletMarkers = [];
        if (this.leafletPolyline) {
            this.leafletMap.removeLayer(this.leafletPolyline);
        }

        const latLngs = [];

        points.forEach((wp, index) => {
            const lat = parseFloat(wp.location.latitude);
            const lng = parseFloat(wp.location.longitude);
            latLngs.push([lat, lng]);

            let badge = `${index + 1}`;
            let color = '#2563eb';
            if (index === 0) { color = '#10b981'; badge = 'F'; }
            else if (index === points.length - 1 && wp.action.includes('DISPENSED')) { color = '#8b5cf6'; badge = 'C'; }
            else if (wp.action.includes('PHARMACY')) { color = '#06b6d4'; badge = 'P'; }

            const customIcon = L.divIcon({
                className: 'custom-leaflet-marker',
                html: `<div style="background-color: ${color}; width: 28px; height: 28px; border-radius: 50%; color: white; display: flex; align-items: center; justify-content: center; font-weight: bold; font-size: 12px; border: 2px solid white; box-shadow: 0 2px 6px rgba(0,0,0,0.3);">${badge}</div>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
            });

            const marker = L.marker([lat, lng], { icon: customIcon }).addTo(this.leafletMap);
            marker.bindPopup(`
                <div style="font-family: sans-serif; font-size: 12px;">
                    <strong style="color: #0f172a;">Step ${index + 1}: ${wp.action}</strong><br>
                    <b>Facility:</b> ${wp.location.facilityName}<br>
                    <b>Address:</b> ${wp.location.formattedAddress}<br>
                    <b>Time:</b> ${new Date(wp.timestamp).toLocaleString()}<br>
                    <span style="font-family: monospace; color: #2563eb;">Tx: ${wp.txId ? wp.txId.substring(0, 16) + '...' : 'Verified'}</span>
                </div>
            `);
            this.leafletMarkers.push(marker);
        });

        this.leafletPolyline = L.polyline(latLngs, {
            color: '#2563eb',
            weight: 4,
            opacity: 0.85,
            dashArray: '6, 8'
        }).addTo(this.leafletMap);

        if (latLngs.length > 0) {
            this.leafletMap.fitBounds(L.latLngBounds(latLngs), { padding: [40, 40] });
        }
    }
}

window.RouteMapEngine = RouteMapEngine;
