require('dotenv').config();
const express = require('express');
const cors = require('cors');
const axios = require('axios');
const admin = require('firebase-admin');
const fs = require('fs');
const mongoose = require('mongoose');
const Settings = require('./models/Settings');


const app = express();
const PORT = process.env.PORT || 5555;

// Initialize Firebase Admin if serviceAccountKey.json exists
const serviceAccountPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || './serviceAccountKey.json';
if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    console.log('✅ Firebase Admin SDK initialized successfully.');
  } catch (err) {
    console.error('❌ Failed to initialize Firebase Admin SDK:', err.message);
  }
} else {
  console.warn('⚠️  serviceAccountKey.json not found. Firebase features will be disabled.');
}

// Enable CORS for all routes (allows Flutter web/app to access it)
app.use(cors());
// Parse JSON request bodies
app.use(express.json());

// MongoDB Connection
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://13.233.76.8:5555/ricemill';
mongoose.connect(MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
}).then(async () => {
  console.log('✅ Connected to MongoDB');
  
  // Initialize default settings if none exist
  const count = await Settings.countDocuments();
  if (count === 0) {
    await Settings.create({});
    console.log('✅ Created default alert settings in MongoDB');
  }
}).catch((err) => {
  console.error('❌ MongoDB Connection Error:', err);
});


// Target API URL
const TARGET_API_URL = process.env.TARGET_API_URL || 'https://www.gfiotsolutions.com/api/sensordata';

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'OK', message: 'Ricemill Server is running' });
});

// Proxy endpoint for sensor data
app.get('/api/sensordata', async (req, res) => {
  try {
    console.log(`[${new Date().toISOString()}] Fetching data from external API...`);
    
    const response = await axios.get(TARGET_API_URL);
    
    // Return the exact data structure to the client
    res.status(200).json(response.data);
    
    console.log(`[${new Date().toISOString()}] Successfully fetched and served data.`);
  } catch (error) {
    console.error('Error fetching sensor data:', error.message);
    
    res.status(500).json({
      error: 'Failed to fetch sensor data',
      details: error.message
    });
  }
});

// Get alert settings
app.get('/api/settings', async (req, res) => {
  try {
    const settings = await Settings.findOne() || await Settings.create({});
    res.status(200).json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error.message);
    res.status(500).json({ error: 'Failed to fetch settings' });
  }
});

// Update alert settings
app.post('/api/settings', async (req, res) => {
  try {
    const { cmdLimit, cmdMaxGauge, powerLimit, powerMaxGauge } = req.body;
    let settings = await Settings.findOne();
    if (!settings) {
      settings = new Settings();
    }
    if (cmdLimit !== undefined) settings.cmdLimit = cmdLimit;
    if (cmdMaxGauge !== undefined) settings.cmdMaxGauge = cmdMaxGauge;
    if (powerLimit !== undefined) settings.powerLimit = powerLimit;
    if (powerMaxGauge !== undefined) settings.powerMaxGauge = powerMaxGauge;
    
    await settings.save();
    res.status(200).json({ message: 'Settings updated successfully', settings });
  } catch (error) {
    console.error('Error updating settings:', error.message);
    res.status(500).json({ error: 'Failed to update settings' });
  }
});

// Start the server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`========================================`);
  console.log(`🚀 Ricemill Server running on port ${PORT}`);
  console.log(`➡️  Health Check: http://localhost:${PORT}/health`);
  console.log(`➡️  Sensor Data:  http://localhost:${PORT}/api/sensordata`);
  console.log(`========================================`);
});
