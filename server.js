const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
const path = require('path'); // Added path utility to serve production files cleanly
require('dotenv').config();

const app = express();
app.use(express.json());

// Serve static React production build files directly from Express
app.use(express.static(path.join(__dirname, 'frontend/dist')));

// Clean the incoming URL string to handle postgresql:// vs postgres:// discrepancies
let connectionString = process.env.DATABASE_URL;
if (connectionString && connectionString.startsWith('postgresql://')) {
  connectionString = connectionString.replace('postgresql://', 'postgres://');
}

const pool = new Pool({
  connectionString: connectionString || undefined,
  user: connectionString ? undefined : 'postgres',
  password: connectionString ? undefined : 'YOUR_LOCAL_PASSWORD_HERE', // Keep your local database password here
  host: connectionString ? undefined : 'localhost',
  port: connectionString ? undefined : 5432,
  database: connectionString ? undefined : 'auction_db',
  ssl: connectionString ? { rejectUnauthorized: false } : false
});

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
    
    // Cleaned up \$1 to a normal \$1 parameter
    const itemRes = await pool.query('SELECT * FROM items WHERE id = \$1', [itemId]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Cleaned up \$1 to a normal \$1 parameter
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
    // Cleaned up parameters from (\$1, \$2, \$3) to normal syntax (\$1, \$2, \$3)
    await pool.query('SELECT place_bid_secure(\$1, \$2, \$3)', [itemId, bidderName, parseFloat(amount)]);
    return res.json({ success: true, message: 'Bid successfully verified and locked.' });
  } catch (err) {
    const message = err.message || 'Transaction aborted due to concurrency conflict.';
    return res.status(409).json({ error: message });
  }
});

// Catch-all route to serve React's index.html for any frontend navigation routes
// Change from app.get('*', ...) to this modern Express 5 syntax structure:
app.get('*path', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend/dist', 'index.html'));
});


const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Auction engine core active on port ${PORT}`);
});
