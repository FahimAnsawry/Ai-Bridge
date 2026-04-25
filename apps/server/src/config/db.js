const mongoose = require('mongoose');

// Connect to MongoDB
const uri = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/ai-proxy';

// Disable buffering so we fail fast when DB is down
mongoose.set('bufferCommands', false);

mongoose.connect(uri, {
  serverSelectionTimeoutMS: 5000, // Shorter timeout for faster failover
})
  .then(async () => {
    console.log(`Connected to MongoDB`);
  })
  .catch((err) => {
    console.error('MongoDB connection error (server will continue without DB):', err.message);
    // Do NOT exit — let the Express server stay alive so the Vite proxy can reach it.
    // Mongoose will automatically retry in the background.
  });

const User = require('../models/user');
const Provider = require('../models/provider');
const UserConfig = require('../models/userConfig');
const RequestLog = require('../models/requestLog');
const ModelCatalog = require('../models/modelCatalog');
const GlobalConfig = require('../models/globalConfig');

// User, Provider, etc. require statements...
module.exports = {
  mongoose,
  User,
  Provider,
  UserConfig,
  RequestLog,
  ModelCatalog,
  GlobalConfig
};
