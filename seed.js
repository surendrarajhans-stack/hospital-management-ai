const { MongoClient } = require('mongodb');
const fs = require('fs');
require('dotenv').config();

const uri = process.env.MONGODB_URI;

if (!uri) {
    console.error("Error: MONGODB_URI is not defined in .env");
    process.exit(1);
}

const seedData = {
    doctors: [
        { id: "DOC-001", name: "Dr. Surendra Rajhans", specialty: "Cardiology", room: "OPD 101", shift: "Morning", phone: "+91 94394 98158" },
        { id: "DOC-002", name: "Dr. Lakshmi Prasad", specialty: "Pediatrics", room: "OPD 105", shift: "Afternoon", phone: "+91 98765 00002" },
        { id: "DOC-003", name: "Dr. Vikas Sharma", specialty: "Neurology", room: "OPD 202", shift: "Night", phone: "+91 98765 00003" }
    ],
    patients: [
        { id: "PAT-001", name: "Ramesh Kumar", age: 45, triage: "Stable", bed: "ICU-02", bill: 12500, paid: false, complaint: "Chronic hypertension" },
        { id: "PAT-002", name: "Sita Devi", age: 32, triage: "Under Observation", bed: "GW-05", bill: 4500, paid: false, complaint: "Post-op care, mild fever" },
        { id: "PAT-003", name: "Kabir Khan", age: 8, triage: "Stable", bed: "PED-01", bill: 1800, paid: true, complaint: "Acute bronchitis checkup" }
    ],
    wards: [
        { id: "ICU-01", type: "ICU", occupied: false, patientId: "" },
        { id: "ICU-02", type: "ICU", occupied: true, patientId: "PAT-001" },
        { id: "GW-01", type: "General Ward", occupied: false, patientId: "" },
        { id: "GW-05", type: "General Ward", occupied: true, patientId: "PAT-002" },
        { id: "PED-01", type: "Pediatrics", occupied: true, patientId: "PAT-003" }
    ],
    staff: [
        { id: "NURSE-01", name: "Sister Anjali", dept: "ICU", shift: "Day" },
        { id: "NURSE-02", name: "Sister Mary", dept: "General Ward", shift: "Night" }
    ],
    pharmacy: [
        { id: "DRUG-01", name: "Paracetamol 650mg", stock: 1200, price: 15 },
        { id: "DRUG-02", name: "Amoxicillin 500mg", stock: 500, price: 80 },
        { id: "DRUG-03", name: "Atorvastatin 10mg", stock: 350, price: 45 },
        { id: "DRUG-04", name: "Pantoprazole 40mg", stock: 800, price: 25 }
    ]
};

async function seed() {
    const client = new MongoClient(uri);
    try {
        console.log("Connecting to database...");
        await client.connect();
        const db = client.db();
        console.log("Database connected. Seeding collections...");

        // Seed individual collections
        for (const [colName, data] of Object.entries(seedData)) {
            console.log(`Seeding collection: ${colName}...`);
            const col = db.collection(colName);
            try {
                await col.drop();
            } catch (e) {}
            await col.insertMany(data);
        }

        // Seed global state config
        console.log("Seeding global db_state...");
        const stateCol = db.collection('db_state');
        try {
            await stateCol.drop();
        } catch (e) {}
        await stateCol.insertOne({
            _id: 'global_state',
            admissions: [],
            ...seedData
        });

        console.log("✅ Database seeding complete!");
    } catch (err) {
        console.error("❌ Seeding failed:", err.message);
    } finally {
        await client.close();
    }
}

seed();
