const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

const configSchema = new mongoose.Schema({
  port: { type: Number, default: 3000 },
  corsOrigins: { type: [String], default: ['*'] },
  modelRouting: { type: String, default: 'fallback' },
  modelMapping: { type: mongoose.Schema.Types.Mixed, default: () => ({}) },
  stubModels: [String],
}, { _id: false });

const userSchema = new mongoose.Schema({
  googleId: { type: String, sparse: true, unique: true },
  email: { type: String, required: true, unique: true },
  displayName: String,
  avatar: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  accessKey: { type: String, unique: true, sparse: true },
  accessKeyHash: String,
  activeProviderId: String,
  lastLoginAt: Date,
  config: { type: configSchema, default: () => ({}) },
  providers: [{
    id: String,
    name: String,
    baseUrl: String,
    apiKey: String,
    apiKeys: [String],
    isActive: { type: Boolean, default: true }
  }]
}, { timestamps: true });

userSchema.methods.generateAccessKey = function () {
  const key = crypto.randomBytes(4).toString('hex'); // Exactly 8 characters
  this.accessKey = key; // Store plain text temporarily so we can show it once
  const salt = bcrypt.genSaltSync(10);
  this.accessKeyHash = bcrypt.hashSync(key, salt);
  return key;
};

userSchema.methods.compareAccessKey = function (key) {
  if (!this.accessKeyHash) return false;
  return bcrypt.compareSync(key, this.accessKeyHash);
};


const User = mongoose.model('User', userSchema);
module.exports = User;
