require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const axios = require('axios');
const admin = require('firebase-admin');
const mongoose = require('mongoose');
const { Server: SocketIOServer } = require('socket.io');
const app = express();
app.use(cors());
app.use(express.json());
const BIND_IP = '13.233.76.8';
const PORT = 5555;

// MongoDB connection
async function connectMongo() {
  const uri = process.env.MONGODB_URI;
  try {
    await mongoose.connect(uri);
    console.log('✅ MongoDB connected (Atlas)');
  } catch (err) {
    console.warn('⚠️ Atlas connection failed, trying local MongoDB...');
    try {
      await mongoose.connect('mongodb://localhost:27017/ricemill');
      console.log('✅ MongoDB connected (local)');
    } catch (localErr) {
      console.error('❌ MongoDB connection failed:', localErr);
    }
  }
}
connectMongo();

// Setting schema for alert settings per user
const settingSchema = new mongoose.Schema({
  userId: { type: String, required: true, unique: true },
  cmdLimit: { type: Number, default: 800.0 },
  cmdMaxGauge: { type: Number, default: 800.0 },
  powerLimit: { type: Number, default: 150.0 },
  powerMaxGauge: { type: Number, default: 300.0 },
  alertEnabled: { type: Boolean, default: true },
  fcmTokens: { type: [String], default: [] }
});
const Setting = mongoose.model('Setting', settingSchema);

// Schema for tracking past alerts
const alertHistorySchema = new mongoose.Schema({
  userId: { type: String, required: true },
  message: { type: String, required: true },
  timestamp: { type: Date, default: Date.now },
  liveValue: { type: Number },
  limitValue: { type: Number }
});
const AlertHistory = mongoose.model('AlertHistory', alertHistorySchema);

// Start HTTP server and attach Socket.io
const http = require('http');
const server = http.createServer(app);
const io = new SocketIOServer(server, {
  cors: { origin: '*', methods: ['GET', 'POST'] },
});
io.on('connection', socket => {
  console.log('🔌 New client connected', socket.id);
});

// Endpoint to save/update settings
app.post('/api/settings/:userId', async (req, res) => {
  const { userId } = req.params;
  const data = req.body; // expect JSON { alertEnabled, threshold, ... }
  try {
    const saved = await Setting.findOneAndUpdate({ userId }, data, {
      upsert: true,
      new: true,
      setDefaultsOnInsert: true,
    });
    // Broadcast to all connected clients (or specific room)
    io.emit('settings-updated', { userId, settings: saved });
    res.json(saved);
  } catch (e) {
    console.error('❌ Settings save error:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Endpoint to fetch current settings
app.get('/api/settings/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const doc = await Setting.findOne({ userId });
    res.json(doc || {});
  } catch (e) {
    console.error('❌ Settings fetch error:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Endpoint to register FCM token
app.post('/api/settings/:userId/token', async (req, res) => {
  const { userId } = req.params;
  const { token } = req.body;
  if (!token) return res.status(400).json({ error: 'Token required' });
  try {
    await Setting.findOneAndUpdate(
      { userId },
      { $addToSet: { fcmTokens: token } },
      { upsert: true, setDefaultsOnInsert: true }
    );
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Token save error:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Endpoint to fetch alert history
app.get('/api/alerts/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    const alerts = await AlertHistory.find({ userId })
      .sort({ timestamp: -1 })
      .limit(50);
    res.json(alerts);
  } catch (e) {
    console.error('❌ Alert history fetch error:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Endpoint to clear alert history
app.delete('/api/alerts/:userId', async (req, res) => {
  const { userId } = req.params;
  try {
    await AlertHistory.deleteMany({ userId });
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Alert history clear error:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Endpoint to stop ongoing alert globally
app.post('/api/alerts/:userId/stop', async (req, res) => {
  const { userId } = req.params;
  try {
    isAlertMuted = true;
    io.emit('alert-stopped', { userId });
    
    // Send a silent FCM data message to tell devices to cancel notifications
    const setting = await Setting.findOne({ userId });
    if (setting && setting.fcmTokens && setting.fcmTokens.length > 0 && admin.apps.length > 0) {
      const message = {
        data: { action: 'stop_alert' },
        tokens: setting.fcmTokens
      };
      admin.messaging().sendEachForMulticast(message).catch(e => console.error('Silent Push Error:', e));
    }
    
    res.json({ success: true });
  } catch (e) {
    console.error('❌ Alert stop error:', e);
    res.status(500).json({ error: 'DB error' });
  }
});

// Start listening (with port conflict handling)
function startServer(startPort) {
  server.listen(startPort, BIND_IP, () => {
    console.log('========================================');
    console.log(`🚀 Ricemill Server running on port ${startPort}`);
    console.log(`➡️  Health Check: http://localhost:${startPort}/health`);
    console.log(`➡️  Sensor Data:  http://localhost:${startPort}/api/sensordata`);
    console.log('========================================');
  });

  server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
      console.warn(`⚠️ Port ${startPort} is in use, trying ${startPort + 1}...`);
      setTimeout(() => {
        server.close();
        startServer(startPort + 1);
      }, 1000);
    } else {
      console.error('❌ Server error:', e);
    }
  });
}
startServer(PORT);

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

// Start the server
// --- BACKGROUND FCM MONITORING ---
let isAlertActive = false; // State to prevent notification spam
let isAlertMuted = false; // Prevents re-triggering while value remains above limit
const METER_SUFFIXES = ['6', '108', '201'];

setInterval(async () => {
  try {
    // 1. Fetch sensor data
    const response = await axios.get(TARGET_API_URL);
    let dataList = response.data;
    if (dataList.data) dataList = dataList.data; // Handle potential wrapping
    if (!dataList || dataList.length === 0) return;
    
    const latestData = dataList[0];
    
    // 2. Calculate sum kVA
    let liveKva = 0;
    for (let suffix of METER_SUFFIXES) {
      const val = parseFloat(latestData[`Total_KVA_meter_${suffix}`]);
      if (!isNaN(val)) liveKva += val;
    }

    // 3. Check against settings for global_user
    // Note: If you expand to multiple users in the future, you'd loop over all users here.
    const setting = await Setting.findOne({ userId: 'global_user' });
    if (!setting) return;
    
    const limit = setting.cmdLimit;
    
    if (liveKva > limit) {
      if (!isAlertActive && !isAlertMuted && setting.alertEnabled) {
        isAlertActive = true;
        
        // 4. Send FCM Push Notification if tokens exist
        if (setting.fcmTokens && setting.fcmTokens.length > 0 && admin.apps.length > 0) {
           const message = {
  notification: {
    title: '⚠️ KVA Limit Exceeded!',
    body: `Live kVA (${liveKva.toFixed(2)}) is over limit (${limit.toFixed(1)}).`
  },

  data: {
    action: 'trigger_alert'
  },

  android: {
    priority: 'high',
    notification: {
      channelId: 'ricemill_alerts',
      sound: 'beep'
    }
  },

  tokens: setting.fcmTokens
};
          try {
            // Save to AlertHistory
         await AlertHistory.create({
  userId: 'global_user',
  message: `Live kVA (${liveKva.toFixed(2)}) is over limit (${limit.toFixed(1)}).`,
  liveValue: liveKva,
  limitValue: limit
});
            const response = await admin.messaging().sendEachForMulticast(message);
            console.log(`📡 Sent FCM Alerts: ${response.successCount} successful, ${response.failureCount} failed.`);
            // Clean up invalid tokens
            if (response.failureCount > 0) {
              const failedTokens = [];
              response.responses.forEach((resp, idx) => {
                if (!resp.success) {
                  failedTokens.push(setting.fcmTokens[idx]);
                }
              });
              await Setting.updateOne({ userId: 'global_user' }, { $pullAll: { fcmTokens: failedTokens } });
            }
          } catch (fcmErr) {
            console.error('❌ FCM Send Error:', fcmErr);
          }
        }
      }
    } else {
      isAlertActive = false; // Reset when value drops below limit
      isAlertMuted = false; // Re-arm the alarm
    }
  } catch (err) {
    console.error('❌ Background Monitor Error:', err.message);
  }
}, 5000); // Check every 5 seconds

