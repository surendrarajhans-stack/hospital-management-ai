const express = require('express');
const cors = require('cors');
const { MongoClient } = require('mongodb');
const fs = require('fs');
const path = require('path');
const os = require('os');
require('dotenv').config();

const dns = require('dns');
if (dns.setDefaultResultOrder) {
    dns.setDefaultResultOrder('ipv4first');
}

const app = express();
app.use(cors());
app.use(express.json({ limit: '50mb' }));

const PORT = process.env.PORT || 8081;
const uri = process.env.MONGODB_URI;

let db;
let client;

if (uri) {
    client = new MongoClient(uri);
}

// Connect to MongoDB safely if URI is available
async function connectDB() {
    if (!uri || !client) {
        console.warn("MONGODB_URI not provided. Server running with local file/memory data store.");
        return;
    }
    try {
        console.log("Connecting to MongoDB Atlas...");
        await client.connect();
        db = client.db();
        console.log("Connected successfully to MedSphere MongoDB Database!");

        // Load dynamically saved API credentials into process.env!
        try {
            const config = await db.collection('app_config').findOne({ _id: 'credentials' });
            if (config) {
                if (config.geminiKey) process.env.GEMINI_API_KEY = config.geminiKey;
                if (config.twilioSid) process.env.TWILIO_ACCOUNT_SID = config.twilioSid;
                if (config.twilioToken) process.env.TWILIO_AUTH_TOKEN = config.twilioToken;
                if (config.twilioFrom) process.env.TWILIO_FROM_NUMBER = config.twilioFrom;
                if (config.adminPhone) process.env.ADMIN_WHATSAPP_PHONE = config.adminPhone;
                console.log("Dynamically loaded saved Twilio and Gemini API credentials from MongoDB.");
            }
        } catch (e) {
            console.error("Config collection not initialized yet.");
        }
    } catch (err) {
        console.error("MongoDB Atlas connection warning:", err.message);
    }
}

connectDB();

function getLocalIPs() {
    const interfaces = os.networkInterfaces();
    const ips = [];
    for (const devName in interfaces) {
        const iface = interfaces[devName];
        for (let i = 0; i < iface.length; i++) {
            const alias = iface[i];
            if (alias.family === 'IPv4' && !alias.internal) {
                ips.push(alias.address);
            }
        }
    }
    return ips;
}

// 1. Intercept requests for static JSON mock data files to serve from MongoDB
const collectionMap = {
    '/data_Wards.json': 'wards',
    '/data_Patients.json': 'patients',
    '/data_Doctors.json': 'doctors',
    '/data_Staff.json': 'staff',
    '/data_Prescriptions.json': 'prescriptions',
    '/data_Pharmacy.json': 'pharmacy',
    '/data_Billing.json': 'billing'
};

app.get('/api/config', (req, res) => {
    res.json({
        razorpayKeyId: process.env.RAZORPAY_KEY_ID || 'rzp_live_TGB9IaYGwFI1HU'
    });
});

app.get(Object.keys(collectionMap), async (req, res) => {
    const colName = collectionMap[req.path];
    console.log(`Intercepted GET ${req.path} -> Querying MongoDB collection: ${colName}`);
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        const data = await db.collection(colName).find({}).toArray();
        res.json(data);
    } catch (err) {
        console.error(`Error querying ${colName} from MongoDB:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// 2. State loading endpoint
app.get('/api/load', async (req, res) => {
    console.log("GET /api/load -> Querying MongoDB for global_state and individual collections");
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        
        let state = await db.collection('db_state').findOne({ _id: 'global_state' });
        if (!state) {
            state = { _id: 'global_state' };
        }
        
        // Query individual synced collections
        const doctors = await db.collection('doctors').find({}).toArray();
        const patients = await db.collection('patients').find({}).toArray();
        const staff = await db.collection('staff').find({}).toArray();
        const pharmacy = await db.collection('pharmacy').find({}).toArray();
        
        // Merge individual collections if they contain data to ensure consistency
        if (doctors.length > 0) state.doctors = doctors;
        if (patients.length > 0) state.patients = patients;
        if (staff.length > 0) state.staff = staff;
        if (pharmacy.length > 0) state.pharmacy = pharmacy;
        
        const { _id, ...rest } = state;
        res.json(rest);
    } catch (err) {
        console.error("Error loading state from MongoDB:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. State saving endpoint
app.post('/api/save', async (req, res) => {
    console.log("POST /api/save -> Updating global_state and individual collections in MongoDB");
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        const stateData = req.body;
        
        // Save the global state
        await db.collection('db_state').replaceOne(
            { _id: 'global_state' },
            { _id: 'global_state', ...stateData },
            { upsert: true }
        );

        // Sync individual collections to prevent data drift
        if (stateData.doctors && Array.isArray(stateData.doctors)) {
            const coll = db.collection('doctors');
            try { await coll.drop(); } catch(e) {}
            if (stateData.doctors.length > 0) {
                await coll.insertMany(stateData.doctors);
            }
        }
        if (stateData.patients && Array.isArray(stateData.patients)) {
            const coll = db.collection('patients');
            try { await coll.drop(); } catch(e) {}
            if (stateData.patients.length > 0) {
                await coll.insertMany(stateData.patients);
            }
        }
        if (stateData.staff && Array.isArray(stateData.staff)) {
            const coll = db.collection('staff');
            try { await coll.drop(); } catch(e) {}
            if (stateData.staff.length > 0) {
                await coll.insertMany(stateData.staff);
            }
        }
        if (stateData.pharmacy && Array.isArray(stateData.pharmacy)) {
            const coll = db.collection('pharmacy');
            try { await coll.drop(); } catch(e) {}
            if (stateData.pharmacy.length > 0) {
                await coll.insertMany(stateData.pharmacy);
            }
        }

        res.json({ status: "success" });
    } catch (err) {
        console.error("Error saving state to MongoDB:", err.message);
        res.status(500).json({ error: err.message });
    }
});

const https = require('https');

// 3.2. WhatsApp Admin Notification Endpoint (Supports Twilio & CallMeBot)
app.post('/api/notify-whatsapp', async (req, res) => {
    const { message } = req.body;
    console.log("Notification request received:", message);

    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const twilioFrom = process.env.TWILIO_FROM_NUMBER || "whatsapp:+14155238886";
    const adminPhone = process.env.ADMIN_WHATSAPP_PHONE;
    const apiKey = process.env.CALLMEBOT_API_KEY;

    const telegramBotToken = process.env.TELEGRAM_BOT_TOKEN;
    const telegramChatId = process.env.TELEGRAM_CHAT_ID;

    const promises = [];

    // 1. If Telegram Bot credentials are configured, send Telegram message
    if (telegramBotToken && telegramChatId) {
        const encodedText = encodeURIComponent(message);
        const url = `https://api.telegram.org/bot${telegramBotToken}/sendMessage?chat_id=${telegramChatId}&text=${encodedText}&parse_mode=Markdown`;

        promises.push(new Promise((resolve) => {
            https.get(url, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    console.log("Telegram notification sent successfully:", data);
                    resolve({ provider: 'telegram', success: true });
                });
            }).on('error', (err) => {
                console.error("Telegram notification error:", err.message);
                resolve({ provider: 'telegram', success: false, error: err.message });
            });
        }));
    }

    // 2. If Twilio credentials are configured, send Twilio WhatsApp message
    if (accountSid && authToken && adminPhone) {
        const cleanPhone = adminPhone.startsWith('whatsapp:') ? adminPhone : `whatsapp:${adminPhone.replace(/[\+\s\-]/g, '')}`;
        const cleanFrom = twilioFrom.startsWith('whatsapp:') ? twilioFrom : `whatsapp:${twilioFrom.replace(/[\+\s\-]/g, '')}`;
        
        const postData = new URLSearchParams({
            To: cleanPhone,
            From: cleanFrom,
            Body: message
        }).toString();

        const options = {
            hostname: 'api.twilio.com',
            port: 443,
            path: `/2010-04-01/Accounts/${accountSid}/Messages.json`,
            method: 'POST',
            headers: {
                'Authorization': 'Basic ' + Buffer.from(`${accountSid}:${authToken}`).toString('base64'),
                'Content-Type': 'application/x-www-form-urlencoded',
                'Content-Length': postData.length
            }
        };

        promises.push(new Promise((resolve) => {
            const request = https.request(options, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    console.log("Twilio WhatsApp notification sent successfully:", data);
                    resolve({ provider: 'twilio', success: true });
                });
            });

            request.on('error', (err) => {
                console.error("Twilio WhatsApp error:", err.message);
                resolve({ provider: 'twilio', success: false, error: err.message });
            });

            request.write(postData);
            request.end();
        }));
    }

    // 3. Fallback to CallMeBot API if configured
    if (adminPhone && apiKey && !accountSid) {
        const cleanPhone = adminPhone.replace(/[\+\s\-]/g, '');
        const encodedText = encodeURIComponent(message);
        const url = `https://api.callmebot.com/whatsapp.php?phone=${cleanPhone}&text=${encodedText}&apikey=${apiKey}`;

        promises.push(new Promise((resolve) => {
            https.get(url, (response) => {
                let data = '';
                response.on('data', (chunk) => { data += chunk; });
                response.on('end', () => {
                    console.log("CallMeBot WhatsApp notification response:", data);
                    resolve({ provider: 'callmebot', success: true });
                });
            }).on('error', (err) => {
                console.error("Failed to send CallMeBot WhatsApp notification:", err.message);
                resolve({ provider: 'callmebot', success: false, error: err.message });
            });
        }));
    }

    if (promises.length === 0) {
        console.log("Admin Notification skipped: No Telegram, Twilio or CallMeBot credentials found in environment");
        return res.json({ status: 'skipped', reason: 'No notification provider configured' });
    }

    const results = await Promise.all(promises);
    res.json({ status: 'success', results });
});

// 3.4. Patient AI Chatbot assistant endpoint
app.post('/api/patient-chat', async (req, res) => {
    const { message, history } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        // Fallback: rule-based response if Gemini API key is missing
        let answer = "I have analyzed your description. If you are experiencing persistent discomfort, I highly advise scheduling a clinical consultation with one of our specialized doctors.";
        const q = message.toLowerCase();
        if (q.includes("chest") || q.includes("heart") || q.includes("pain in chest")) {
            answer = "⚠️ Warning: Symptoms of chest discomfort require urgent clinical check. Please visit the cardiology ward immediately or book an OPD consultation.";
        } else if (q.includes("cough") || q.includes("bronchitis") || q.includes("fever")) {
            answer = "You describe general cold or respiratory symptoms. I recommend resting, keeping hydrated, and consulting Dr. Lakshmi Prasad in Pediatrics/GP.";
        }
        return res.json({ success: true, analysis: answer });
    }
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
        
        // Map history to Gemini format
        const contents = [];
        if (history && Array.isArray(history)) {
            history.forEach(h => {
                contents.push({
                    role: h.role === "user" ? "user" : "model",
                    parts: [{ text: h.text }]
                });
            });
        }
        
        // Add the current query with medical receptionist context
        contents.push({
            role: "user",
            parts: [{ text: `You are MedSphere's friendly, professional AI Clinical Receptionist & Symptom Advisor. Answer the patient's message directly. Detail potential causes, suggest appropriate clinical tests, and outline a detailed clinical prescription recommendation (specifying simulated medications, dosage, frequency, and care instructions) for their review. Include a clear disclaimer stating this is a simulated prescription recommendation requiring doctor sign-off. Always include this disclaimer at the end: "Disclaimer: This is an AI advisory summary. Please seek direct medical advice from our licensed practitioners." \n\nPatient Message: ${message}` }]
        });
        
        const headers = { 'Content-Type': 'application/json' };
        const body = JSON.stringify({ contents });
        
        const response = await makeHttpsPost(url, headers, body);
        const result = JSON.parse(response.body);
        
        if (result.candidates && result.candidates[0].content.parts[0].text) {
            const aiSummary = result.candidates[0].content.parts[0].text;
            res.json({ success: true, analysis: aiSummary });
        } else if (result.error) {
            res.status(500).json({ error: result.error.message || "Gemini API Error" });
        } else {
            res.status(500).json({ error: "Gemini API returned an unexpected response format." });
        }
    } catch (err) {
        console.error("Gemini Patient Chat failed:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3.5. Import database sheet endpoint
app.post('/api/import-sheet', async (req, res) => {
    const { sheetName, data } = req.body;
    console.log(`POST /api/import-sheet -> Importing ${data ? data.length : 0} documents into collection: ${sheetName}`);
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        if (!sheetName || !Array.isArray(data)) {
            return res.status(400).json({ error: "Invalid payload: sheetName and data array required" });
        }

        // Drop the old collection to replace it fresh
        const coll = db.collection(sheetName);
        try {
            await coll.drop();
        } catch (e) {
            // Collection might not exist, ignore
        }

        // Insert new data
        if (data.length > 0) {
            await coll.insertMany(data);
        }
        res.json({ status: 'success', count: data.length });
    } catch (err) {
        console.error(`Error importing sheet ${sheetName}:`, err.message);
        res.status(500).json({ error: err.message });
    }
});

// Https POST helper for direct Gemini API calls
function makeHttpsPost(url, headers, body) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const options = {
            hostname: parsedUrl.hostname,
            port: 443,
            path: parsedUrl.pathname + parsedUrl.search,
            method: 'POST',
            headers: {
                ...headers,
                'Content-Length': Buffer.byteLength(body)
            }
        };

        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => { data += chunk; });
            res.on('end', () => {
                resolve({ statusCode: res.statusCode, body: data });
            });
        });

        req.on('error', (e) => { reject(e); });
        req.write(body);
        req.end();
    });
}

// 3.6. API Credentials Config endpoints
app.post('/api/save-config', async (req, res) => {
    const { geminiKey, twilioSid, twilioToken, twilioFrom, adminPhone } = req.body;
    console.log("Saving dynamic API credentials to MongoDB config collection.");
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        
        await db.collection('app_config').replaceOne(
            { _id: 'credentials' },
            {
                _id: 'credentials',
                geminiKey,
                twilioSid,
                twilioToken,
                twilioFrom,
                adminPhone
            },
            { upsert: true }
        );
        
        // Dynamically update variables in memory
        if (geminiKey) process.env.GEMINI_API_KEY = geminiKey;
        if (twilioSid) process.env.TWILIO_ACCOUNT_SID = twilioSid;
        if (twilioToken) process.env.TWILIO_AUTH_TOKEN = twilioToken;
        if (twilioFrom) process.env.TWILIO_FROM_NUMBER = twilioFrom;
        if (adminPhone) process.env.ADMIN_WHATSAPP_PHONE = adminPhone;
        
        res.json({ status: "success" });
    } catch (err) {
        console.error("Error saving app config:", err.message);
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/get-config', async (req, res) => {
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        const config = await db.collection('app_config').findOne({ _id: 'credentials' }) || {};
        
        // Return masked keys for security
        res.json({
            geminiKey: config.geminiKey ? "••••••••" + config.geminiKey.substring(config.geminiKey.length - 4) : "",
            twilioSid: config.twilioSid ? "••••••••" + config.twilioSid.substring(config.twilioSid.length - 4) : "",
            twilioToken: config.twilioToken ? "••••••••" : "",
            twilioFrom: config.twilioFrom || "",
            adminPhone: config.adminPhone || ""
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// 3.7. Gemini AI Pathology Scanner analysis endpoint
app.post('/api/analyze-report', async (req, res) => {
    const { reportText } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        return res.status(400).json({ error: "Gemini API key is required. Please set it in IT config or your .env file." });
    }
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent?key=${apiKey}`;
        const prompt = `You are a professional clinical pathology anomaly assistant. Analyze the following patient lab values. Flag any values that fall outside standard ranges (like Troponin, Hemoglobin, WBC, Potassium, Sodium, Creatinine, etc.). Identify potential clinical risks (e.g. MI risk, Sepsis risk, Renal failure risk). Recommend a detailed corrective clinical prescription (specifying corrective medications, fluids, dosages, frequency, next-step laboratory tests, and continuous monitoring instructions). Keep your summary structured, concise, and bulleted using markdown: \n\n${reportText}`;
        
        const headers = { 'Content-Type': 'application/json' };
        const body = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }]
        });
        
        const response = await makeHttpsPost(url, headers, body);
        const result = JSON.parse(response.body);
        
        if (result.candidates && result.candidates[0].content.parts[0].text) {
            const aiSummary = result.candidates[0].content.parts[0].text;
            res.json({ success: true, analysis: aiSummary });
        } else if (result.error) {
            res.status(500).json({ error: result.error.message || "Gemini API Error" });
        } else {
            res.status(500).json({ error: "Gemini API returned an unexpected response format." });
        }
    } catch (err) {
        console.error("Gemini API call failed:", err);
        res.status(500).json({ error: err.message });
    }
});

// 4. Serve static frontend assets
app.use(express.static(path.join(__dirname)));

// Fallback to index.html for SPA routes
app.get(/.*/, (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Start the server
async function start() {
    await connectDB();
    app.listen(PORT, '0.0.0.0', () => {
        console.log(`\nMedSphere AI Server running on Port ${PORT}`);
        console.log(`Local machine access: http://localhost:${PORT}/`);
        
        const localIPs = getLocalIPs();
        if (localIPs.length > 0) {
            console.log(`\nTo view on your Mobile Phone (must be on the same Wi-Fi network):`);
            localIPs.forEach(ip => {
                console.log(`📱 http://${ip}:${PORT}/`);
            });
        }
        console.log(`\nPress Ctrl+C to stop the server.\n`);
    });
}

start();
