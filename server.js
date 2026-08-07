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
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        
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
        if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts[0].text) {
            const aiSummary = result.candidates[0].content.parts[0].text;
            return res.json({ success: true, analysis: aiSummary });
        } else {
            console.warn("Gemini API returned error or empty response, using smart clinical fallback:", result.error || result);
            const fallbackAnalysis = generateSmartFallbackAnalysis(message);
            return res.json({ success: true, analysis: fallbackAnalysis });
        }
    } catch (err) {
        console.error("Gemini Patient Chat failed, activating smart clinical fallback:", err.message);
        const fallbackAnalysis = generateSmartFallbackAnalysis(message);
        return res.json({ success: true, analysis: fallbackAnalysis });
    }
});

function generateSmartFallbackAnalysis(message) {
    const q = message.toLowerCase();
    let symptomCategory = "General Health Concern";
    let potentialCauses = "Mild functional disturbance, localized inflammation, or stress-related response.";
    let recommendedTests = "Complete Blood Count (CBC), Routine Urinalysis, and Vital Signs monitoring.";
    let simulatedRx = "1. Adequate oral hydration (2-3 Liters daily)\n2. Rest and symptom monitoring\n3. OPD Consultation for formal evaluation";

    if (q.includes("period") || q.includes("stomach") || q.includes("abdominal") || q.includes("cramp") || q.includes("pelvic") || q.includes("late")) {
        symptomCategory = "Gynaecological & Abdominal Evaluation";
        potentialCauses = "Dysmenorrhea, hormonal imbalance, early pregnancy, ovarian functional cyst, or gastrointestinal spasm.";
        recommendedTests = "Ultrasound Abdomen & Pelvis (USG), Urine Pregnancy Test (hCG), and CBC.";
        simulatedRx = "1. Antispasmodic support (e.g., Mefenamic Acid / Dicyclomine as advised by physician)\n2. Warm compress on lower abdomen\n3. Hydration and light nutrition";
    } else if (q.includes("chest") || q.includes("heart") || q.includes("breath")) {
        symptomCategory = "Cardiorespiratory Alert";
        potentialCauses = "Anginal discomfort, muscular strain, intercostal neuralgia, GERD, or acute anxiety.";
        recommendedTests = "12-Lead ECG, Cardiac Troponin-I, Chest X-Ray (PA View), and BP monitoring.";
        simulatedRx = "⚠️ Immediate clinical check required. Rest quietly, avoid physical exertion, and visit the emergency/cardiology OPD.";
    } else if (q.includes("fever") || q.includes("cough") || q.includes("cold") || q.includes("throat") || q.includes("headache")) {
        symptomCategory = "Upper Respiratory & Febrile Symptom Complex";
        potentialCauses = "Viral URI, seasonal influenza, pharyngitis, or mild systemic viral infection.";
        recommendedTests = "Complete Blood Count with Differential, ESR, and Dengue/Malaria screen if fever exceeds 3 days.";
        simulatedRx = "1. Paracetamol 500mg for temperature regulation\n2. Warm saline gargles thrice daily\n3. Vitamin C & Hydration support";
    }

    return `### 🩺 MedSphere AI Clinical Receptionist Advisory\n\n**Assessment Area:** ${symptomCategory}\n\n**Potential Clinical Considerations:**\n${potentialCauses}\n\n**Recommended Diagnostic Evaluation:**\n${recommendedTests}\n\n**Suggested Initial Management Protocol:**\n${simulatedRx}\n\n---\n*Disclaimer: This is an AI advisory summary. Please seek direct medical advice from our licensed practitioners.*`;
}

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

// 3.7. Gemini AI Pathology Scanner analysis endpoint (MedPath AI)
app.post('/api/analyze-report', async (req, res) => {
    const { reportText } = req.body;
    const apiKey = process.env.GEMINI_API_KEY;
    
    if (!apiKey) {
        console.warn("Gemini API key not found for pathology analysis, using smart MedPath AI fallback");
        const fallbackAnalysis = generateSmartPathologyAnalysis(reportText);
        return res.json({ success: true, analysis: fallbackAnalysis });
    }
    
    try {
        const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`;
        const prompt = `You are MedPath AI, a professional clinical pathology anomaly assistant. Analyze the following patient lab values. Flag any values that fall outside standard ranges (like Troponin, Hemoglobin, WBC, Potassium, Sodium, Creatinine, etc.). Identify potential clinical risks (e.g. MI risk, Sepsis risk, Renal failure risk). Recommend a detailed corrective clinical prescription (specifying corrective medications, fluids, dosages, frequency, next-step laboratory tests, and continuous monitoring instructions). Keep your summary structured, concise, and bulleted using markdown: \n\n${reportText}`;
        
        const headers = { 'Content-Type': 'application/json' };
        const body = JSON.stringify({
            contents: [{
                parts: [{ text: prompt }]
            }]
        });
        
        const response = await makeHttpsPost(url, headers, body);
        const result = JSON.parse(response.body);
        
        if (result.candidates && result.candidates[0] && result.candidates[0].content && result.candidates[0].content.parts && result.candidates[0].content.parts[0].text) {
            const aiSummary = result.candidates[0].content.parts[0].text;
            return res.json({ success: true, analysis: aiSummary });
        } else {
            console.warn("Gemini API returned error or unexpected format for pathology, using smart fallback:", result.error || result);
            const fallbackAnalysis = generateSmartPathologyAnalysis(reportText);
            return res.json({ success: true, analysis: fallbackAnalysis });
        }
    } catch (err) {
        console.error("Gemini Pathology API call failed, using smart fallback:", err.message);
        const fallbackAnalysis = generateSmartPathologyAnalysis(reportText);
        return res.json({ success: true, analysis: fallbackAnalysis });
    }
});

function generateSmartPathologyAnalysis(reportText) {
    const text = (reportText || "").toLowerCase();
    let riskLevel = "Mild / Normal Baseline";
    let flaggedAnomalies = [];
    let clinicalRisks = [];
    let rxPlan = [];

    if (text.includes("troponin") || text.includes("ck-mb") || text.includes("cardiac")) {
        flaggedAnomalies.push("• Cardiac Biomarker Elevation (Troponin-I / CK-MB)");
        clinicalRisks.push("• High Risk of Myocardial Infarction / Acute Coronary Syndrome");
        rxPlan.push("1. Immediate 12-Lead ECG & Urgent Cardiology Consult");
        rxPlan.push("2. Antiplatelet & Anticoagulation evaluation by Cardiologist");
        rxPlan.push("3. Continuous Bedside Telemetry & ICU monitoring");
        riskLevel = "⚠️ CRITICAL (Cardiovascular Emergency)";
    } else if (text.includes("creatinine") || text.includes("urea") || text.includes("egfr")) {
        flaggedAnomalies.push("• Renal Biomarker Elevation (Serum Creatinine > 1.4 mg/dL / BUN)");
        clinicalRisks.push("• Risk of Acute Kidney Injury (AKI) or Chronic Renal Impairment");
        rxPlan.push("1. Nephrology consultation & Fluid balance monitoring");
        rxPlan.push("2. Avoid nephrotoxic NSAIDs / contrast agents");
        rxPlan.push("3. Repeat Serum Electrolytes & Renal Function Test in 24h");
        riskLevel = "⚠️ MODERATE TO HIGH (Renal Impairment Risk)";
    } else if (text.includes("wbc") || text.includes("leukocyte") || text.includes("neutrophil")) {
        flaggedAnomalies.push("• Leukocytosis (Elevated WBC Count > 11,000 /mcL)");
        clinicalRisks.push("• Systemic Bacterial Infection / Sepsis Cascade Risk");
        rxPlan.push("1. Blood & Urine Cultures prior to empirical antibiotics");
        rxPlan.push("2. Broad-spectrum IV antibiotic evaluation (e.g. Ceftriaxone)");
        rxPlan.push("3. Vital signs & qSOFA score monitoring 4-hourly");
        riskLevel = "⚠️ HIGH (Infectious / Inflammatory Alert)";
    } else if (text.includes("hb") || text.includes("hemoglobin") || text.includes("anemia")) {
        flaggedAnomalies.push("• Low Hemoglobin / Hematocrit (Hb < 10 g/dL)");
        clinicalRisks.push("• Anemic Hypoxia & GI Bleeding / Hemorrhagic Risk");
        rxPlan.push("1. Stool Occult Blood & Iron Profile testing");
        rxPlan.push("2. Oral / Parenteral Iron supplementation or Packed RBC transfusion if Hb < 7 g/dL");
        rxPlan.push("3. Dietary enrichment & hematology follow-up");
        riskLevel = "⚠️ MODERATE (Anemia Evaluation Required)";
    } else if (text.includes("bilirubin") || text.includes("sgpt") || text.includes("alt") || text.includes("sgot") || text.includes("lft")) {
        flaggedAnomalies.push("• Hepatic Transaminase / Bilirubin Elevation (ALT/SGPT > 45 U/L)");
        clinicalRisks.push("• Acute Hepatitis, Toxic Drug-Induced Liver Injury, or Biliary Obstruction");
        rxPlan.push("1. Abdominal Ultrasound (USG Liver & Biliary Tree)");
        rxPlan.push("2. Review hepatotoxic medications & alcohol intake");
        rxPlan.push("3. Viral Hepatitis Panel (HBsAg, Anti-HCV)");
        riskLevel = "⚠️ MODERATE (Hepatic Injury Risk)";
    } else if (text.includes("hba1c") || text.includes("glucose") || text.includes("sugar") || text.includes("diabet")) {
        flaggedAnomalies.push("• Glycated Hemoglobin Elevation (HbA1c > 6.5% / Hyperglycemia)");
        clinicalRisks.push("• Uncontrolled Type 2 Diabetes Mellitus & Microvascular Complication Risk");
        rxPlan.push("1. Endocrinology OPD consultation & Glycemic control");
        rxPlan.push("2. Metformin / SGLT2 inhibitor evaluation by physician");
        rxPlan.push("3. Diabetic Retinopathy & Microalbuminuria screening");
        riskLevel = "⚠️ MODERATE (Diabetic Glycemic Alert)";
    } else if (text.includes("potassium") || text.includes("sodium") || text.includes("k+") || text.includes("na+")) {
        flaggedAnomalies.push("• Serum Electrolyte Imbalance (Hyperkalemia K+ > 5.2 / Hyponatremia)");
        clinicalRisks.push("• Cardiac Arrhythmia Risk & Neuromuscular Irritability");
        rxPlan.push("1. Stat Repeat Serum Electrolytes & 12-Lead ECG for T-wave changes");
        rxPlan.push("2. Review Potassium-sparing diuretics & ACE-inhibitors");
        rxPlan.push("3. Intravenous fluid & electrolyte correction protocol");
        riskLevel = "⚠️ HIGH (Electrolyte Arrhythmia Risk)";
    } else if (text.includes("cholesterol") || text.includes("triglycerides") || text.includes("ldl") || text.includes("lipid")) {
        flaggedAnomalies.push("• Atherogenic Dyslipidemia (Elevated LDL > 130 mg/dL & Triglycerides)");
        clinicalRisks.push("• Long-term Atherosclerotic Cardiovascular Disease (ASCVD) Risk");
        rxPlan.push("1. Initiate Statin Therapy (e.g. Atorvastatin 10-20mg at bedtime)");
        rxPlan.push("2. Dietary lipid restriction & 30-min daily aerobic exercise");
        rxPlan.push("3. Repeat Lipid Panel in 8-12 weeks");
        riskLevel = "⚠️ MILD TO MODERATE (Cardiovascular Risk Factor)";
    } else if (text.includes("tsh") || text.includes("thyroid") || text.includes("t3") || text.includes("t4")) {
        flaggedAnomalies.push("• Thyroid Stimulating Hormone Variance (TSH Abnormal)");
        clinicalRisks.push("• Primary Hypothyroidism / Hyperthyroidism Metabolic Imbalance");
        rxPlan.push("1. Endocrinology consultation for Thyroxine titration");
        rxPlan.push("2. Anti-TPO Antibody testing if autoimmune etiology suspected");
        rxPlan.push("3. Follow-up TSH monitoring in 6 weeks");
        riskLevel = "⚠️ MILD (Endocrine Metabolic Alert)";
    } else {
        flaggedAnomalies.push("• General Biochemical / Hematological Review Requested");
        clinicalRisks.push("• Mild physiological variance requiring routine clinical tracking");
        rxPlan.push("1. Routine vital signs monitoring (BP, HR, SpO2, Temp)");
        rxPlan.push("2. Repeat baseline pathology panel in 7-14 days");
        rxPlan.push("3. Physician OPD consultation for lifestyle & nutrition advice");
    }

    return `### 🔬 MedPath AI — Clinical Pathology & Anomaly Analysis Report\n\n**Triage Risk Status:** ${riskLevel}\n\n**Flagged Laboratory Anomalies:**\n${flaggedAnomalies.join('\n')}\n\n**Potential Clinical Risks:**\n${clinicalRisks.join('\n')}\n\n**Recommended Corrective Clinical Protocol:**\n${rxPlan.join('\n')}\n\n---\n*Disclaimer: MedPath AI provides automated analytical assistance. All diagnostic findings require doctor verification.*`;
}

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
