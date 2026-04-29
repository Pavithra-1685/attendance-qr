function getSessionId() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('sessionId');
}

function getIsOD() {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get('isOD') === 'true';
}

const sessionId = getSessionId();
const isOD = getIsOD();
async function generateDeviceFingerprint() {
    try {
        // Cache fingerprint for the day to avoid recomputation
        const today = new Date().toISOString().split('T')[0];
        const cacheKey = `fingerprint-${today}`;
        const cachedFingerprint = localStorage.getItem(cacheKey);
        if (cachedFingerprint) return cachedFingerprint;

        // Collect device characteristics (same as before)
        const fingerprintData = {
            userAgent: navigator.userAgent,
            screenResolution: `${window.screen.width}x${window.screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            language: navigator.language,
            hardwareConcurrency: navigator.hardwareConcurrency || 'unknown',
            deviceMemory: navigator.deviceMemory || 'unknown',
            touchSupport: 'ontouchstart' in window,
            dateSalt: today
        };
        
        // Add canvas fingerprint (same as before)
        try {
            const canvas = document.createElement('canvas');
            canvas.width = 100;
            canvas.height = 30;
            const ctx = canvas.getContext('2d');
            ctx.textBaseline = "top";
            ctx.font = "14px 'Arial'";
            ctx.fillStyle = "#f60";
            ctx.fillRect(125, 1, 62, 20);
            ctx.fillStyle = "#069";
            ctx.fillText("Fingerprint", 2, 15);
            fingerprintData.canvasHash = canvas.toDataURL();
        } catch (e) {
            console.log("Canvas fingerprint failed:", e);
        }
        
        // Call Java implementation via API
        const fingerprintString = JSON.stringify(fingerprintData);
        const response = await fetch('http://localhost:5000/api/consistent-hash', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({ input: fingerprintString })
        });
        
        if (!response.ok) throw new Error("Hash API failed");
        const { fingerprint } = await response.json();

        // Cache the fingerprint
        localStorage.setItem(cacheKey, fingerprint);
        return fingerprint;
    } catch (error) {
        console.error("Fingerprint generation error:", error);
        // Fallback to simpler fingerprint
        return btoa(JSON.stringify({
            userAgent: navigator.userAgent,
            screenResolution: `${window.screen.width}x${window.screen.height}`,
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            salt: "fallback-" + new Date().toISOString().split('T')[0]
        }));
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("attendanceForm");
    const statusElement = document.getElementById("status");
    const submitButton = form.querySelector("button[type='submit']");
    const API_ENDPOINT = "http://localhost:5000/mark-attendance";
    let isSubmitting = false;

    // Dashboard button handler
    document.getElementById('view-dashboard-btn').addEventListener('click', function() {
        const rollNo = document.getElementById('rollInput').value.trim();
        if (!rollNo) {
            document.getElementById('accessMessage').textContent = 'Please enter your roll number';
            document.getElementById('accessMessage').className = 'text-sm text-center mt-4 text-red-600';
            return;
        }
        window.location.href = `/dashboard.html?rollNo=${encodeURIComponent(rollNo)}`;
    });

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        
        if (!sessionId) {
            statusElement.innerText = "Please scan the QR code first";
            statusElement.className = "text-center mt-4 text-sm text-red-600";
            isSubmitting = false;
            return;
        }

        if (isOD) {
            statusElement.innerText = "OD Mode: Marking attendance as On-Duty";
            statusElement.className = "text-center mt-4 text-sm text-purple-600 font-bold";
        }

        if (isSubmitting) return;
        isSubmitting = true;

        if (navigator.webdriver) {
            statusElement.innerText = "Security Error: Automated browsers/emulators are not allowed.";
            statusElement.className = "text-center mt-4 text-sm text-red-600 font-bold";
            isSubmitting = false;
            return;
        }
        
        try {
            const validationResponse = await fetch('http://localhost:5000/api/validate-session', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ sessionId })
            });

            const validationData = await validationResponse.json();
            
            if (!validationData.valid) {
                statusElement.innerText = "Invalid QR session. Please scan again.";
                statusElement.className = "text-center mt-4 text-sm text-red-600";
                isSubmitting = false;
                return;
            }
            
            submitButton.disabled = true;
            submitButton.innerHTML = `Processing...`;
        
            const name = document.getElementById("name").value.trim();
            const universityRollNo = document.getElementById("universityRollNo").value.trim();
            const section = document.getElementById("section").value.trim();
            const classRollNo = document.getElementById("classRollNo").value.trim();
        
            if (!name || !universityRollNo || !section || !classRollNo) {
                statusElement.innerText = "Please fill all fields";
                statusElement.className = "text-center mt-4 text-sm text-red-600";
                return;
            }
            
            const fingerprint = await generateDeviceFingerprint();
        
            if (navigator.geolocation) {
                navigator.geolocation.getCurrentPosition(
                    async (position) => {
                        if (position.coords.accuracy > 100) {
                            statusElement.innerText = `Location accuracy too low (${Math.round(position.coords.accuracy)}m). Please ensure precise GPS is enabled.`;
                            statusElement.className = "text-center mt-4 text-sm text-red-600 font-bold";
                            isSubmitting = false;
                            submitButton.disabled = false;
                            submitButton.innerHTML = `Confirm Presence`;
                            return;
                        }

                        const payload = {
                            name,
                            universityRollNo,
                            section,
                            classRollNo,
                            location: {
                                lat: position.coords.latitude,
                                lng: position.coords.longitude,
                                accuracy: position.coords.accuracy
                            },
                            deviceFingerprint: fingerprint,
                            sessionId,
                            isOD
                        };
        
                        try {
                            const response = await fetch(API_ENDPOINT, {
                                method: "POST",
                                headers: {
                                    "Content-Type": "application/json"
                                },
                                body: JSON.stringify(payload)
                            });
        
                            const data = await response.json();
        
                            if (response.status === 400 && data.message === "Attendance already marked today") {
                                statusElement.innerText = "You've already marked attendance today";
                                statusElement.className = "text-center mt-4 text-sm text-yellow-600";
                                // Still allow viewing dashboard
                                window.location.href = `/dashboard.html?rollNo=${encodeURIComponent(universityRollNo)}`;
                                return;
                            }
        
                            if (!response.ok) {
                                throw new Error(data.message || "Failed to mark attendance");
                            }
        
                            statusElement.innerText = data.message;
                            statusElement.className = `text-center mt-4 text-sm text-green-600`;
        
                            // Redirect to dashboard with roll number
                            window.location.href = `/dashboard.html?rollNo=${encodeURIComponent(universityRollNo)}`;
                        } catch (error) {
                            console.error("API error:", error);
                            statusElement.innerText = error.message;
                            statusElement.className = "text-center mt-4 text-sm text-red-600";
                        } finally {
                            isSubmitting = false;
                            submitButton.disabled = false;
                            submitButton.innerHTML = `Submit Attendance`;
                        }
                    },
                    (error) => {
                        statusElement.innerText = "Location error: " + error.message;
                        statusElement.className = "text-center mt-4 text-sm text-red-600";
                        submitButton.disabled = false;
                        submitButton.innerHTML = `Submit Attendance`;
                        isSubmitting = false;
                    },
                    { timeout: 10000, enableHighAccuracy: true }
                );
            } else {
                statusElement.innerText = "Geolocation not supported.";
                statusElement.className = "text-center mt-4 text-sm text-red-600";
                isSubmitting = false;
                submitButton.disabled = false;
                submitButton.innerHTML = `Submit Attendance`;
            }
        } catch (err) {
            console.error("Unexpected error:", err);
            statusElement.innerText = "An unexpected error occurred.";
            statusElement.className = "text-center mt-4 text-sm text-red-600";
            isSubmitting = false;
            submitButton.disabled = false;
            submitButton.innerHTML = `Submit Attendance`;
        }
    });
});

// Medical Leave Functions
async function requestMedicalLeave() {
    const name = document.getElementById("name").value.trim();
    const universityRollNo = document.getElementById("universityRollNo").value.trim();
    const reason = prompt("Enter reason for medical leave:");

    if (!name || !universityRollNo || !reason) {
        alert("Please fill name and roll number, and provide a reason.");
        return;
    }

    try {
        const response = await fetch('http://localhost:5000/api/medical/request', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name, universityRollNo, reason })
        });
        const data = await response.json();
        if (data.status === 'success') {
            alert("Medical leave request submitted successfully. Wait for Incharge approval.");
        } else {
            alert("Error: " + data.message);
        }
    } catch (err) {
        alert("Failed to submit request.");
    }
}

async function uploadMedicalProof() {
    const universityRollNo = document.getElementById("universityRollNo").value.trim();
    const proofUrl = prompt("Enter medical proof URL/Reference (Simulation):");

    if (!universityRollNo || !proofUrl) {
        alert("Please enter roll number and proof.");
        return;
    }

    try {
        const response = await fetch('http://localhost:5000/api/medical/upload-proof', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ universityRollNo, proofDocument: proofUrl })
        });
        const data = await response.json();
        if (data.status === 'success') {
            alert("Proof uploaded successfully. Attendance confirmed as Medical.");
        } else {
            alert("Error: " + data.message);
        }
    } catch (err) {
        alert("Failed to upload proof.");
    }
}

// QR Scanner Functions
let html5QrcodeScanner = null;

function startQRScanner() {
    document.getElementById('qr-modal').classList.remove('hidden');
    if (!html5QrcodeScanner) {
        html5QrcodeScanner = new Html5QrcodeScanner(
            "reader",
            { fps: 10, qrbox: { width: 250, height: 250 } },
            /* verbose= */ false
        );
    }
    
    html5QrcodeScanner.render(onScanSuccess, onScanFailure);
}

function stopQRScanner() {
    document.getElementById('qr-modal').classList.add('hidden');
    if (html5QrcodeScanner) {
        html5QrcodeScanner.clear().catch(error => {
            console.error("Failed to clear html5QrcodeScanner. ", error);
        });
    }
}

function onScanSuccess(decodedText, decodedResult) {
    document.getElementById('qr-status').textContent = "QR scanned successfully! Processing...";
    document.getElementById('qr-status').className = "text-center mt-4 text-sm text-green-600 font-bold";
    
    // Stop scanner
    stopQRScanner();
    
    // Check if it's a valid URL or direct JSON
    try {
        if (decodedText.startsWith('http')) {
            window.location.href = decodedText;
        } else {
            const data = JSON.parse(decodedText);
            if (data.sessionId) {
                window.location.href = `/index.html?sessionId=${data.sessionId}${data.isOD ? '&isOD=true' : ''}`;
            }
        }
    } catch(e) {
        console.error("Error processing QR", e);
        alert("Invalid QR format");
    }
}

function onScanFailure(error) {
    // Ignore failures during scanning as they happen frequently before focus is found
}
