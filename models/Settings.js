const mongoose = require('mongoose');

const settingsSchema = new mongoose.Schema({
  cmdLimit: { type: Number, default: 800.0 },
  cmdMaxGauge: { type: Number, default: 800.0 },
  powerLimit: { type: Number, default: 150.0 },
  powerMaxGauge: { type: Number, default: 300.0 }
}, { timestamps: true });

module.exports = mongoose.model('Settings', settingsSchema);
