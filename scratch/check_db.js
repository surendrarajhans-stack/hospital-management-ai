const { MongoClient } = require('mongodb');
require('dotenv').config();

async function check() {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
        console.error("No MONGODB_URI found in env");
        process.exit(1);
    }
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const coll = db.collection('hospital_records');
        const doc = await coll.findOne({ type: 'database_state' });
        if (!doc) {
            console.log("No stored database state found.");
        } else {
            console.log("Doctors in DB:");
            doc.doctors.forEach(d => {
                console.log(`- ${d.id}: ${d.name} (${d.specialty})`);
            });
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.close();
    }
}
check();
