
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
const path = require('path');
const parseDbUrl = require('pg-connection-string').parse; // Add the manual URL string parser
require('dotenv').config();

const app = express();
app.use(express.json());

app.use(express.static(path.join(__dirname, 'frontend/dist')));

let pool;

// 1. Strict validation: Verify DATABASE_URL exists, is a string, and isn't empty or blank spaces
if (process.env.DATABASE_URL && typeof process.env.DATABASE_URL === 'string' && process.env.DATABASE_URL.trim() !== '') {
  
  let cloudUrl = process.env.DATABASE_URL.trim();
  
  // Clean the string protocol to handle postgresql:// vs postgres:// discrepancies cleanly
  if (cloudUrl.startsWith('postgresql://')) {
    cloudUrl = cloudUrl.replace('postgresql://', 'postgres://');
  }

  try {
    // Manually parse the validated connection URL string parameters securely
    const dbConfig = parseDbUrl(cloudUrl);
    
    pool = new Pool({
      user: dbConfig.user,
      password: dbConfig.password,
      host: dbConfig.host,
      port: dbConfig.port,
      database: dbConfig.database,
      ssl: { rejectUnauthorized: false } // Required by Render cloud databases for SSL verification security
    });
    
    console.log("Database parameters parsed successfully for production execution.");
  } catch (parseError) {
    console.error("Critical URL string evaluation failure. Falling back to discrete object layout:", parseError.message);
    // Dynamic fallback if parsing hits unexpected string exceptions
    pool = new Pool({
      connectionString: cloudUrl,
      ssl: { rejectUnauthorized: false }
    });
  }
} else {
  // 2. Local fallback parameters remain untouched for standard offline tracking loops
  pool = new Pool({
    user: 'postgres',
    password: '2007', // Keep your local computer database password here
    host: 'localhost',
    port: 5432,
    database: 'auction_db',
    ssl: false
  });
  console.log("Application initialized in local developer configuration status.");
}


const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track active WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  
  ws.on('close', () => {
    clients.delete(ws);
  });
});

// Subscribe to PostgreSQL Notifications via a dedicated client connection
(async function subscribeToDbEvents() {
  const client = await pool.connect();
  await client.query('LISTEN auction_updates');
  
  client.on('notification', (msg) => {
    const payload = JSON.parse(msg.payload);
    const outboundData = JSON.stringify(payload);
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(outboundData);
      }
    });
  });
})().catch(err => console.error('PG Listen Connection Failure:', err));

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
    const message = err.message || 'Transaction aborted due to concurrency conflict.';
    return res.status(409).json({ error: message });
  }
});

// Catch-all route to serve React's index.html for any frontend navigation routes
// Explicitly structured as '*path' to satisfy modern Express 5 path restrictions
app.get('*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist', 'index.html'));
});

const PORT = process.env.PORT || 10000;
server.listen(PORT, () => {
  console.log(`Auction engine core active on port ${PORT}`);
});
