const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: false
  }
});

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', ['GET']);
    return res.status(405).json({ error: `Method ${req.method} not allowed` });
  }

  try {
    const client = await pool.connect();
    try {
      const result = await client.query('SELECT * FROM atendimentos ORDER BY date DESC, entry_hour DESC');
      
      const current = [];
      const base = [];

      result.rows.forEach(row => {
        const mapped = {
          id: row.id,
          name: row.name,
          dow: row.dow,
          date: row.date,
          month: row.month,
          day: row.day,
          year: row.year,
          specialty: row.specialty,
          entryHour: row.entry_hour,
          waitTime: row.wait_time,
          stayTime: row.stay_time,
          tipoConvenio: row.tipo_convenio,
          weekOfMonth: row.week_of_month,
          destination: row.destination,
          exitHour: row.exit_hour,
          triageWait: row.triage_wait,
          triageToDocWait: row.triage_to_doc_wait,
          salaVermelhaTime: row.sala_vermelha_time,
          soroterapiaTime: row.soroterapia_time,
          suturaTime: row.sutura_time,
          dayTotalAtt: row.day_total_att,
          dayMedTriageWait: row.day_med_triage_wait,
          dayMedTriageToDoc: row.day_med_triage_to_doc,
          dayMedWait: row.day_med_wait,
          dayMedStayTime: row.day_med_stay_time
        };

        if (row.is_base) {
          base.push(mapped);
        } else {
          current.push(mapped);
        }
      });

      res.status(200).json({ current, base });
    } finally {
      client.release();
    }
  } catch (err) {
    console.error('Error fetching records from Neon:', err);
    res.status(500).json({ error: 'Database query failed', details: err.message });
  }
};
