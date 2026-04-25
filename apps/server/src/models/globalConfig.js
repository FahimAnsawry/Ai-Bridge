const mongoose = require('mongoose');

const globalConfigSchema = new mongoose.Schema({
  defaultPort: { type: Number, default: 3000 },
  adminEmails: [String],
  globalModelCatalog: mongoose.Schema.Types.Mixed
}, { timestamps: true });

const GlobalConfig = mongoose.model('GlobalConfig', globalConfigSchema);
module.exports = GlobalConfig;
