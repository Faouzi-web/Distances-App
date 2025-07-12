const express = require('express');
const cors = require('cors');
const mysql = require('mysql2/promise');
const path = require('path');

const app = express();
const PORT = 3000;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static('src')); // Serve static files (HTML, CSS, JS)

// MySQL Database setup with connection pooling
const pool = mysql.createPool({
  host: 'crossover.proxy.rlwy.net',
  user: 'root',
  password: 'sVqovCgQMZPTURbAjNIsFWnfdAOLVyNJ', // Change this to your actual password
  database: 'railway',
  port: 15733,
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  acquireTimeout: 60000,
  timeout: 60000,
  reconnect: true,
  charset: 'utf8mb4'
});

// Initialize database table
async function initializeDatabase() {
  try {
    const connection = await pool.getConnection();
    
    const createTableQuery = `
      CREATE TABLE IF NOT EXISTS distances (
        id INT AUTO_INCREMENT PRIMARY KEY,
        distance DECIMAL(10, 2) NOT NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        INDEX idx_created_at (created_at),
        INDEX idx_distance (distance)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
    `;
    
    await connection.query(createTableQuery);
    console.log('Distance table initialized');
    
    connection.release();
  } catch (error) {
    console.error('Error initializing database:', error.message);
  }
}

// Test database connection and initialize
async function connectToDatabase() {
  try {
    const connection = await pool.getConnection();
    console.log('Connected to MySQL database');
    connection.release();
    await initializeDatabase();
  } catch (error) {
    console.error('Error connecting to database:', error.message);
    process.exit(1);
  }
}

// API Routes

// Get all distances (with optional filtering and pagination)
app.get('/distances', async (req, res) => {
  try {
    const { 
      limit = 50, 
      offset = 0, 
      date, 
      minDistance = 0,
      sortBy = 'created_at',
      sortOrder = 'DESC'
    } = req.query;

    // Convert and validate parameters
    const parsedLimit = limit === 'all' ? null : parseInt(limit);
    const parsedOffset = parseInt(offset);
    const parsedMinDistance = parseFloat(minDistance);

    if (limit !== 'all' && (isNaN(parsedLimit) || parsedLimit < 0)) {
      return res.status(400).json({ error: 'Limit must be a positive number or "all"' });
    }
    
    if (isNaN(parsedOffset) || parsedOffset < 0) {
      return res.status(400).json({ error: 'Offset must be a non-negative number' });
    }

    if (isNaN(parsedMinDistance) || parsedMinDistance < 0) {
      return res.status(400).json({ error: 'MinDistance must be a non-negative number' });
    }

    // Validate date format if provided (YYYY-MM-DD)
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'Date must be in YYYY-MM-DD format' });
    }

    // Base query
    let query = `
      SELECT id, distance, created_at 
      FROM distances 
      WHERE distance >= ?
    `;
    
    let params = [parsedMinDistance];

    // Add date filter if provided
    if (date) {
      query += ` AND DATE(created_at) = ?`;
      params.push(date);
    }

    // Add sorting
    const validSortColumns = ['id', 'distance', 'created_at'];
    const validSortOrders = ['ASC', 'DESC'];
    
    if (validSortColumns.includes(sortBy) && validSortOrders.includes(sortOrder.toUpperCase())) {
      query += ` ORDER BY ${sortBy} ${sortOrder.toUpperCase()}`;
    } else {
      query += ` ORDER BY created_at DESC`;
    }

    // Add LIMIT/OFFSET only if not requesting 'all' records
    if (limit !== 'all') {
      query += ` LIMIT ? OFFSET ?`;
      params.push(parsedLimit, parsedOffset);
    }

    console.log('Executing query:', query);
    console.log('With parameters:', params);

    const [rows] = await pool.query(query, params);
    res.json(rows);
  } catch (error) {
    console.error('Database error details:', {
      message: error.message,
      sqlMessage: error.sqlMessage,
      code: error.code,
      errno: error.errno,
      sqlState: error.sqlState,
      stack: error.stack
    });
    res.status(500).json({ 
      error: 'Database error',
      details: error.sqlMessage || error.message 
    });
  }
});

app.get('/distances/stats', async (req, res) => {
  let connection;
  try {
    connection = await pool.getConnection();
    
    const query = `
      SELECT 
        COUNT(*) as total_records,
        AVG(distance) as avg_distance,
        MIN(distance) as min_distance,
        MAX(distance) as max_distance,
        MIN(created_at) as first_record,
        MAX(created_at) as last_record
      FROM distances;
    `;

    const [rows] = await connection.query(query);
    const row = rows[0];
    
    // Handle case when table is empty
    if (row.total_records === 0) {
      return res.json({
        total_records: 0,
        avg_distance: 0,
        min_distance: 0,
        max_distance: 0,
        first_record: null,
        last_record: null
      });
    }
    
    // Safely handle NULL values from SQL
    const avgDistance = row.avg_distance !== null ? 
      parseFloat(row.avg_distance) : 0;
    const minDistance = row.min_distance !== null ? 
      parseFloat(row.min_distance) : 0;
    const maxDistance = row.max_distance !== null ? 
      parseFloat(row.max_distance) : 0;
    
    res.json({
      total_records: parseInt(row.total_records) || 0,
      avg_distance: avgDistance.toFixed(2),
      min_distance: minDistance,
      max_distance: maxDistance,
      first_record: row.first_record,
      last_record: row.last_record
    });
  } catch (error) {
    console.error('Database error details:', error);
    res.status(500).json({ 
      error: 'Database error',
      details: error.message
    });
  } finally {
    if (connection) connection.release();
  }
});

// Get latest distance reading
app.get('/distances/latest', async (req, res) => {
  try {
    const query = `
      SELECT id, distance, created_at 
      FROM distances 
      ORDER BY created_at DESC 
      LIMIT 1;
    `;

    const [rows] = await pool.query(query);
    
    if (rows.length === 0) {
      res.status(404).json({ error: 'No distance records found' });
    } else {
      res.json(rows[0]);
    }
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: 'Database error' });
  }
});

// Add new distance reading (for ESP8266 to send data)
app.post('/distances', async (req, res) => {
  try {
    const { distance } = req.body;

    if (distance === undefined || distance === null) {
      return res.status(400).json({ error: 'Distance value is required' });
    }

    if (typeof distance !== 'number' || distance < 0) {
      return res.status(400).json({ error: 'Distance must be a positive number' });
    }

    const query = `
      INSERT INTO distances (distance) 
      VALUES (?);
    `;

    const [result] = await pool.query(query, [distance]);
    
    res.status(201).json({
      id: result.insertId,
      distance: distance,
      created_at: new Date().toISOString(),
      message: 'Distance recorded successfully'
    });
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: 'Failed to save distance' });
  }
});

// Delete distance record (optional - for data management)
app.delete('/distances/:id', async (req, res) => {
  try {
    const { id } = req.params;

    if (!id || isNaN(id)) {
      return res.status(400).json({ error: 'Valid ID is required' });
    }

    const query = `DELETE FROM distances WHERE id = ?;`;
    const [result] = await pool.query(query, [parseInt(id)]);

    if (result.affectedRows === 0) {
      res.status(404).json({ error: 'Distance record not found' });
    } else {
      res.json({ message: 'Distance record deleted successfully' });
    }
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: 'Failed to delete distance record' });
  }
});

// Clear all distance records (optional - for data management)
app.delete('/distances', async (req, res) => {
  try {
    const query = `DELETE FROM distances;`;
    const [result] = await pool.query(query);

    res.json({ 
      message: 'All distance records cleared successfully',
      deleted_count: result.affectedRows
    });
  } catch (error) {
    console.error('Database error:', error.message);
    res.status(500).json({ error: 'Failed to clear distance records' });
  }
});

// Health check endpoint
app.get('/health', async (req, res) => {
  try {
    // Test database connection
    const connection = await pool.getConnection();
    await connection.ping();
    connection.release();
    
    res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'connected'
    });
  } catch (error) {
    res.status(500).json({
      status: 'error',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      database: 'disconnected',
      error: error.message
    });
  }
});

// Serve the main HTML files
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'index.html'));
});

app.get('/history', (req, res) => {
  res.sendFile(path.join(__dirname, 'src', 'history.html'));
});

// Generate sample data for testing (development only)
app.post('/generate-sample-data', async (req, res) => {
  try {
    const { count = 100 } = req.body;
    
    if (count > 1000) {
      return res.status(400).json({ error: 'Maximum 1000 sample records allowed' });
    }

    const sampleData = [];
    const now = new Date();
    
    for (let i = 0; i < count; i++) {
      const distance = Math.floor(Math.random() * 350) + 10; // Random distance between 10-360 cm
      const timestamp = new Date(now.getTime() - (i * 60000)); // Go back 1 minute for each record
      sampleData.push([distance, timestamp]);
    }

    const query = `
      INSERT INTO distances (distance, created_at) 
      VALUES ?;
    `;

    const [result] = await pool.query(query, [sampleData]);
    
    res.json({ 
      message: `Generated ${count} sample distance records`,
      count: count,
      insertedRows: result.affectedRows
    });
  } catch (error) {
    console.error('Error generating sample data:', error.message);
    res.status(500).json({ error: 'Failed to generate sample data' });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error(err.stack);
  res.status(500).json({ error: 'Something went wrong!' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: 'Endpoint not found' });
});

// Graceful shutdown
async function gracefulShutdown() {
  console.log('\nShutting down gracefully...');
  try {
    await pool.end();
    console.log('Database pool closed.');
  } catch (error) {
    console.error('Error closing database pool:', error.message);
  }
  process.exit(0);
}

process.on('SIGINT', gracefulShutdown);
process.on('SIGTERM', gracefulShutdown);

// Start server
async function startServer() {
  try {
    await connectToDatabase();
    
    app.listen(PORT, () => {
      console.log(`Distance Detector Server running on port ${PORT}`);
      console.log(`Health check: http://localhost:${PORT}/health`);
      console.log(`Main app: http://localhost:${PORT}/`);
      console.log(`History: http://localhost:${PORT}/history`);
    });
  } catch (error) {
    console.error('Failed to start server:', error.message);
    process.exit(1);
  }
}

startServer();

module.exports = app;