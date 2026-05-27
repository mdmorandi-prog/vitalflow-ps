const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', ['POST']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  const data = req.body;
  if (!Array.isArray(data)) {
    return res.status(400).json({ error: 'Invalid data format. Expected an array of records.' });
  }

  const isBase = req.query.type === 'base';

  try {
    const client = await pool.connect();
    try {
      // Start transaction
      await client.query('BEGIN');

      // 1. Delete existing rows for this specific type (current vs base)
      await client.query('DELETE FROM atendimentos WHERE is_base = $1', [isBase]);

      if (data.length > 0) {
        // 2. Prepare arrays for high-performance UNNEST batch insertion
        const ids = [];
        const names = [];
        const dows = [];
        const dates = [];
        const months = [];
        const days = [];
        const years = [];
        const specialties = [];
        const entryHours = [];
        const waitTimes = [];
        const stayTimes = [];
        const isBases = Array(data.length).fill(isBase);

        data.forEach(d => {
          ids.push(d.id);
          names.push(d.name || 'PACIENTE ANÔNIMO');
          dows.push(d.dow || '');
          dates.push(d.date ? new Date(d.date).toISOString() : null);
          months.push(d.month !== undefined && d.month !== null ? parseInt(d.month, 10) : null);
          days.push(d.day !== undefined && d.day !== null ? parseInt(d.day, 10) : null);
          years.push(d.year !== undefined && d.year !== null ? parseInt(d.year, 10) : null);
          specialties.push(d.specialty || 'NÃO INFORMADO');
          entryHours.push(d.entryHour !== null && d.entryHour !== undefined ? parseInt(d.entryHour, 10) : null);
          waitTimes.push(d.waitTime !== null && d.waitTime !== undefined ? parseInt(d.waitTime, 10) : null);
          stayTimes.push(d.stayTime !== null && d.stayTime !== undefined ? parseInt(d.stayTime, 10) : null);
        });

        const insertQuery = `
          INSERT INTO atendimentos (id, name, dow, date, month, day, year, specialty, entry_hour, wait_time, stay_time, is_base)
          SELECT * FROM UNNEST($1::varchar[], $2::varchar[], $3::varchar[], $4::timestamptz[], $5::int[], $6::int[], $7::int[], $8::varchar[], $9::int[], $10::int[], $11::int[], $12::boolean[])
          ON CONFLICT (id, is_base) DO NOTHING;
        `;

        const values = [
          ids,
          names,
          dows,
          dates,
          months,
          days,
          years,
          specialties,
          entryHours,
          waitTimes,
          stayTimes,
          isBases
        ];

        await client.query(insertQuery, values);
      }

      await client.query('COMMIT');
      res.status(200).json({ success: true, count: data.length });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error during data batch upload to Neon:', err);
    res.status(500).json({ error: 'Database transaction failed', details: err.message });
  }
};
