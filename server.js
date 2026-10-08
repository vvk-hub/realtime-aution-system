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

// ... Rest of your server.js code (WebSocket, HTTP REST API Routes, and server.listen) remains exactly the same
