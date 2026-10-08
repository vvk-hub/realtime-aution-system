const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Pool, Client } = require('pg'); 
const path = require('path');
require('dotenv').config();

const app = express();
app.use(express.json());

// Serve static React production build files directly from Express
app.use(express.static(path.join(__dirname, 'frontend/dist')));

let pool;
let listenerClient;

// 1. Production Mode: Check if running on Render (uses DATABASE_URL)
if (process.env.DATABASE_URL) {
  let cloudUrl = process.env.DATABASE_URL.trim();
  
  // Standardize protocol to postgres://
  if (cloudUrl.startsWith('postgresql://')) {
    cloudUrl = cloudUrl.replace('postgresql://', 'postgres://');
  }

  // Pass the connection string directly—pg library handles the parsing natively
  pool = new Pool({
    connectionString: cloudUrl,
    ssl: { rejectUnauthorized: false } // Required for Render production databases
  });

  listenerClient = new Client({
    connectionString: cloudUrl,
    ssl: { rejectUnauthorized: false }
  });

  console.log("Database initialized with Render production connection string.");

} else {
  // 2. Local Mode: Fallback parameters for offline tracking loops
  const localConfig = {
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || '2007', // Your local computer database password
    host: process.env.DB_HOST || 'localhost',
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'auction_db',
    ssl: false
  };

  pool = new Pool(localConfig);
  listenerClient = new Client(localConfig);
  console.log("Application initialized in local developer configuration status.");
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track active WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  console.log(`New WebSocket client connected. Active connections: ${clients.size}`);
  
  ws.on('close', () => {
    clients.delete(ws);
    console.log(`WebSocket client disconnected. Active connections: ${clients.size}`);
  });
});

// Subscribe to PostgreSQL Notifications safely with advanced logging
(async function subscribeToDbEvents() {
  console.log("Attempting to connect listenerClient...");
  await listenerClient.connect(); 
  
  console.log("listenerClient connected successfully. Starting LISTEN loop...");
  await listenerClient.query('LISTEN auction_updates');
  
  console.log("Successfully listening for 'auction_updates' channels.");
  
  listenerClient.on('notification', (msg) => {
    try {
      const payload = JSON.parse(msg.payload);
      const outboundData = JSON.stringify(payload);
      clients.forEach((ws) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(outboundData);
        }
      });
    } catch (parseErr) {
      console.error("Error processing database notification payload:", parseErr.message);
    }
  });
})().catch(err => {
  console.error('CRITICAL: PG Listen Connection Failure:', err.message);
  console.error(err.stack);
});

/**
 * HTTP REST API Route: Fetch current state of an item
 */
app.get('/api/items/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    
    // Fetch master item state using clean parameter indexes
    const itemRes = await pool.query('SELECT * FROM items WHERE id = \$1', [itemId]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Fetch top historical bids for context tracking
    const bidsRes = await pool.query(
      'SELECT bidder_name, amount, created_at FROM bids WHERE item_id = \$1 ORDER BY amount DESC LIMIT 10',
      [itemId]
    );
    
    res.json({
      item: itemRes.rows[0],
      history: bidsRes.rows
    });
  } catch (err) {
    console.error("API Error fetching item:", err.message);
    res.status(500).json({ error: 'Internal server error processing state retrieval.' });
  }
});

/**
 * HTTP REST API Route: Handle incoming bid orders securely
 */
app.post('/api/bids', async (req, res) => {
  const { itemId, bidderName, amount } = req.body;

  if (!itemId || !bidderName || !amount || isNaN(amount)) {
    return res.status(400).json({ error: 'Invalid parameters provided.' });
  }

  try {
    // Execute the atomic, locked database operation function natively
    await pool.query('SELECT place_bid_secure(\$1, \$2, \$3)', [itemId, bidderName, parseFloat(amount)]);
    return res.json({ success: true, message: 'Bid successfully verified and locked.' });
  } catch (err) {
    console.error("API Error placing bid:", err.message);
    const message = err.message || 'Transaction aborted due to concurrency conflict.';
    return res.status(409).json({ error: message });
  }
});

// Catch-all route to serve React's index.html for any frontend navigation routes
// ✅ New syntax matching modern path-to-regexp requirements
app.get('*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist', 'index.html'));
});


// Render expects 10000 natively unless overridden
const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Auction engine core active and listening on port ${PORT}`);
});
