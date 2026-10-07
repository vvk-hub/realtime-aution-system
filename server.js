const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
app.use(express.json());

// Initialize PostgreSQL Connection Pool using separate credentials
// Replace the old pool block with this direct config object:
const pool = new Pool({
  user: 'postgres',              // Force it to use the admin user instead of your Windows name
  password: '2007', // Put your actual database password here directly
  host: 'localhost',
  port: 5432,
  database: 'auction_db'
});


const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

// Track active WebSocket connections
const clients = new Set();

wss.on('connection', (ws) => {
  clients.add(ws);
  
  // Clean up references immediately upon disconnect to prevent memory leaks
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
    
    // Broadcast the real-time event to all connected clients
    const outboundData = JSON.stringify(payload);
    clients.forEach((ws) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(outboundData);
      }
    });
  });
})().catch(err => console.error('PG Listen Connection Failure:', err));

/**
 * HTTP REST API Route: Fetch current state of an item (for fresh load / reconnects)
 */
app.get('/api/items/:id', async (req, res) => {
  try {
    const itemId = parseInt(req.params.id);
    
    // Fetch master item state (Cleaned up \$1 to \$1)
    const itemRes = await pool.query('SELECT * FROM items WHERE id = \$1', [itemId]);
    if (itemRes.rows.length === 0) {
      return res.status(404).json({ error: 'Item not found' });
    }
    
    // Fetch top historical bids for context tracking (Cleaned up \$1 to \$1)
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
    // Execute the atomic, locked database operation function (Cleaned up parameters)
    await pool.query('SELECT place_bid_secure(\$1, \$2, \$3)', [itemId, bidderName, parseFloat(amount)]);
    
    // Return success to the caller immediately.
    return res.json({ success: true, message: 'Bid successfully verified and locked.' });
  } catch (err) {
    // Check if exception was thrown manually by our PL/pgSQL database constraints
    const message = err.message || 'Transaction aborted due to concurrency conflict.';
    return res.status(409).json({ error: message });
  }
});

const PORT = process.env.PORT || 5000;
server.listen(PORT, () => {
  console.log(`Auction engine core active on port ${PORT}`);
});
