const QRCode = require('qrcode');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// Configuration
const QR_CODE_VALIDITY = 15 * 1000; // 15 seconds for dynamic rotation

// Track active sessions
const activeSessions = new Map();



async function generateQRCode(ipAddress) {


    try {
        const sessionId = crypto.randomBytes(16).toString('hex');
        const timestamp = Date.now();
        
        const secretKey = process.env.QR_SECRET_KEY || 'default-secret-key';
        const hash = crypto.createHash('sha256')
                         .update(sessionId + timestamp + secretKey)
                         .digest('hex');

        const qrData = `http://localhost:5000/verify-attendance?data=${encodeURIComponent(JSON.stringify({
            sessionId,
            timestamp,
            hash
        }))}`;

        const dataUrl = await QRCode.toDataURL(qrData, {
            color: {
                dark: '#000000',
                light: '#ffffff'
            },
            width: 400,
            margin: 2
        });

        activeSessions.set(sessionId, {
            ip: ipAddress,
            expiresAt: timestamp + QR_CODE_VALIDITY
        });

        setTimeout(() => {
            activeSessions.delete(sessionId);
        }, QR_CODE_VALIDITY);

        const result = {
            qrImage: dataUrl,
            sessionId,
            expiresIn: QR_CODE_VALIDITY
        };

        return result;
    } catch (error) {
        console.error('QR generation error:', error);
        throw error;
    }
}

async function generateODQRCode(ipAddress, options = {}) {
    try {
        const sessionId = crypto.randomBytes(16).toString('hex');
        const timestamp = Date.now();
        
        const secretKey = process.env.QR_SECRET_KEY || 'default-secret-key';
        
        const qrDataObj = {
            sessionId,
            timestamp,
            isOD: true,
            scope: options.scope || 'open',
            duration: options.duration || 'full-day',
            hash: ''
        };

        const hashInput = sessionId + timestamp + secretKey + 'OD';
        qrDataObj.hash = crypto.createHash('sha256')
                         .update(hashInput)
                         .digest('hex');

        const qrData = `http://localhost:5000/verify-attendance?data=${encodeURIComponent(JSON.stringify(qrDataObj))}`;

        const dataUrl = await QRCode.toDataURL(qrData, {
            color: {
                dark: '#8e44ad', // Different color for OD
                light: '#ffffff'
            },
            width: 400,
            margin: 2
        });

        const validity = 15 * 60 * 1000; // 15 minutes for OD as per requirement
        activeSessions.set(sessionId, {
            ip: ipAddress,
            isOD: true,
            expiresAt: timestamp + validity,
            scope: options.scope,
            duration: options.duration
        });

        setTimeout(() => {
            activeSessions.delete(sessionId);
        }, validity);

        return {
            qrImage: dataUrl,
            sessionId,
            expiresIn: validity
        };
    } catch (error) {
        console.error('OD QR generation error:', error);
        throw error;
    }
}

function validateSession(sessionId) {
    const session = activeSessions.get(sessionId);
    if (!session) return false;
    
    if (Date.now() > session.expiresAt) {
        activeSessions.delete(sessionId);
        return false;
    }
    
    return session; // Return session object to check isOD etc
}



module.exports = {
    generateQRCode,
    generateODQRCode,
    validateSession
};