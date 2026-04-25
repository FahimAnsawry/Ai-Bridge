/**
 * One-shot script: update EcomAgent API key + set as active provider for all users.
 * Run with: node update-ecomagent-key.js
 */
require('dotenv').config({ path: './apps/server/.env' });
// Fallback to root .env
if (!process.env.MONGODB_URI) {
  require('dotenv').config({ path: './.env' });
}

const mongoose = require('mongoose');
const MONGODB_URI = process.env.MONGODB_URI;
const ECOM_API_KEY = 'sk-85bb3d66050f04adbdf29876e02c1b8105eb3347d5c9f832';
const ECOM_BASE_URL = 'https://api.ecomagent.in/v1';

if (!MONGODB_URI) {
  console.error('❌ MONGODB_URI not found in .env');
  process.exit(1);
}

async function run() {
  await mongoose.connect(MONGODB_URI);
  console.log('✅ Connected to MongoDB');

  const db = mongoose.connection.db;

  // Update or insert the EcomAgent provider for ALL users
  const usersCol = db.collection('users');
  const providersCol = db.collection('providers');
  const userConfigsCol = db.collection('userconfigs');

  const users = await usersCol.find({}).toArray();
  console.log(`Found ${users.length} user(s)`);

  for (const user of users) {
    const userId = user._id;

    // Upsert Provider document
    const result = await providersCol.updateOne(
      { userId, providerId: 'ecomagent' },
      {
        $set: {
          name: 'EcomAgent',
          baseUrl: ECOM_BASE_URL,
          apiKey: ECOM_API_KEY,
          apiKeys: [ECOM_API_KEY],
          isActive: true,
        }
      },
      { upsert: true }
    );
    console.log(`  [${user.email}] Provider upsert: ${JSON.stringify(result.upsertedId || 'updated')}`);

    // Set active provider
    await userConfigsCol.updateOne(
      { userId },
      { $set: { activeProviderId: 'ecomagent' } },
      { upsert: true }
    );
    await usersCol.updateOne(
      { _id: userId },
      { $set: { activeProviderId: 'ecomagent' } }
    );
    console.log(`  [${user.email}] ✅ activeProviderId → ecomagent`);
  }

  console.log('\n✅ Done. EcomAgent key updated for all users.');
  await mongoose.disconnect();
}

run().catch(e => {
  console.error('❌ Error:', e.message);
  process.exit(1);
});
