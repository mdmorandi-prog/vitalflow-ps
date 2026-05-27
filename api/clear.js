const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = async (req, res) => {
  if (req.method !== 'DELETE') {
    res.setHeader('Allow', ['DELETE']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const client = await pool.connect();
    try {
      await client.query('TRUNCATE TABLE atendimentos');
      res.status(200).json({ success: true });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error clearing database on Neon:', err);
    res.status(500).json({ error: 'Database clear operation failed', details: err.message });
  }
};
