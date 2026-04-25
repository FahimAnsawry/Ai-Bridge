require('dotenv').config({ path: './apps/server/.env' });
if (!process.env.MONGODB_URI) require('dotenv').config({ path: './.env' });
const mongoose = require('mongoose');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const db = mongoose.connection.db;
  const user = await db.collection('users').findOne({ accessKey: '511640e2' });
  const uId = user._id;
  const cfg = await db.collection('userconfigs').findOne({ userId: uId });
  
  console.log('=== UserConfig ===');
  console.log('activeProviderId:', cfg?.activeProviderId);
  console.log('modelRouting:', JSON.stringify(cfg?.modelRouting));
  
  // modelMapping is stored as a Map in MongoDB
  if (cfg?.modelMapping) {
    const mapping = {};
    if (cfg.modelMapping instanceof Map) {
      for (const [k,v] of cfg.modelMapping) mapping[k] = v;
    } else {
      Object.assign(mapping, cfg.modelMapping);
    }
    console.log('modelMapping:', JSON.stringify(mapping, null, 2));
  } else {
    console.log('modelMapping: (none)');
  }
  
  await mongoose.disconnect();
}
run().catch(e => { console.error(e.message); process.exit(1); });
