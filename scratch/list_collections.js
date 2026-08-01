const { MongoClient } = require('mongodb');
require('dotenv').config();

async function check() {
    const uri = process.env.MONGODB_URI;
    const client = new MongoClient(uri);
    try {
        await client.connect();
        const db = client.db();
        const collections = await db.listCollections().toArray();
        console.log("Collections:", collections.map(c => c.name));
        for (const col of collections) {
            const count = await db.collection(col.name).countDocuments();
            console.log(`Collection ${col.name} has ${count} documents.`);
            const sample = await db.collection(col.name).findOne();
            console.log(`Sample doc from ${col.name}:`, JSON.stringify(sample));
        }
    } catch (e) {
        console.error("Error:", e);
    } finally {
        await client.close();
    }
}
check();
