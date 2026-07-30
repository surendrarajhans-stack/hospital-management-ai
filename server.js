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
    console.log("GET /api/load -> Querying MongoDB for global_state");
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        const state = await db.collection('db_state').findOne({ _id: 'global_state' });
        if (state) {
            const { _id, ...rest } = state;
            res.json(rest);
        } else {
            res.status(404).json({ error: "No state found" });
        }
    } catch (err) {
        console.error("Error loading state from MongoDB:", err.message);
        res.status(500).json({ error: err.message });
    }
});

// 3. State saving endpoint
app.post('/api/save', async (req, res) => {
    console.log("POST /api/save -> Updating global_state in MongoDB");
    try {
        if (!db) {
            return res.status(503).json({ error: "Database not connected yet" });
        }
        const stateData = req.body;
        
        await db.collection('db_state').replaceOne(
            { _id: 'global_state' },
            { _id: 'global_state', ...stateData },
            { upsert: true }
        );
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
