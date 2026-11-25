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
  const clear = req.query.clear !== 'false';

  try {
    const client = await pool.connect();
    try {
      // Start transaction
      await client.query('BEGIN');

      // 1. Ensure table and modern columns exist (dynamic migration)
      await client.query(`
        CREATE TABLE IF NOT EXISTS atendimentos (
          id VARCHAR,
          name VARCHAR,
          dow VARCHAR,
          date TIMESTAMPTZ,
          month INT,
          day INT,
          year INT,
          specialty VARCHAR,
          entry_hour INT,
          wait_time INT,
          stay_time INT,
          is_base BOOLEAN,
          tipo_convenio VARCHAR,
          convenio VARCHAR,
          week_of_month INT,
          destination VARCHAR,
          exit_hour INT,
          triage_wait INT,
          triage_to_doc_wait INT,
          sala_vermelha_time INT,
          soroterapia_time INT,
          sutura_time INT,
          day_total_att INT,
          day_med_triage_wait INT,
          day_med_triage_to_doc INT,
          day_med_wait INT,
          day_med_stay_time INT
        );
      `);
      
      const alterQueries = [
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS id VARCHAR',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS name VARCHAR',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS tipo_convenio VARCHAR',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS convenio VARCHAR',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS week_of_month INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS destination VARCHAR',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS exit_hour INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS triage_wait INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS triage_to_doc_wait INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS sala_vermelha_time INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS soroterapia_time INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS sutura_time INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS day_total_att INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS day_med_triage_wait INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS day_med_triage_to_doc INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS day_med_wait INT',
        'ALTER TABLE atendimentos ADD COLUMN IF NOT EXISTS day_med_stay_time INT'
      ];
      
      for (const query of alterQueries) {
        await client.query(query);
      }

      // 2. Delete existing rows for this specific type (current vs base)
      if (clear) {
        await client.query('DELETE FROM atendimentos WHERE is_base = $1', [isBase]);
      }

      if (data.length > 0) {
        // 3. Prepare arrays for high-performance UNNEST batch insertion
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
        
        // New fields
        const tipoConvenios = [];
        const convenios = [];
        const weekOfMonths = [];
        const destinations = [];
        const exitHours = [];
        const triageWaits = [];
        const triageToDocWaits = [];
        const salaVermelhaTimes = [];
        const soroterapiaTimes = [];
        const suturaTimes = [];
        const dayTotalAtts = [];
        const dayMedTriageWaits = [];
        const dayMedTriageToDocs = [];
        const dayMedWaits = [];
        const dayMedStayTimes = [];

        data.forEach(d => {
          ids.push(d.id || null);
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
          
          tipoConvenios.push(d.tipoConvenio || 'NÃO INFORMADO');
          convenios.push(d.convenio || d.tipoConvenio || 'NÃO INFORMADO');
          weekOfMonths.push(d.weekOfMonth !== null && d.weekOfMonth !== undefined ? parseInt(d.weekOfMonth, 10) : null);
          destinations.push(d.destination || null);
          exitHours.push(d.exitHour !== null && d.exitHour !== undefined ? parseInt(d.exitHour, 10) : null);
          triageWaits.push(d.triageWait !== null && d.triageWait !== undefined ? parseInt(d.triageWait, 10) : null);
          triageToDocWaits.push(d.triageToDocWait !== null && d.triageToDocWait !== undefined ? parseInt(d.triageToDocWait, 10) : null);
          salaVermelhaTimes.push(d.salaVermelhaTime !== null && d.salaVermelhaTime !== undefined ? parseInt(d.salaVermelhaTime, 10) : null);
          soroterapiaTimes.push(d.soroterapiaTime !== null && d.soroterapiaTime !== undefined ? parseInt(d.soroterapiaTime, 10) : null);
          suturaTimes.push(d.suturaTime !== null && d.suturaTime !== undefined ? parseInt(d.suturaTime, 10) : null);
          dayTotalAtts.push(d.dayTotalAtt !== null && d.dayTotalAtt !== undefined ? parseInt(d.dayTotalAtt, 10) : null);
          dayMedTriageWaits.push(d.dayMedTriageWait !== null && d.dayMedTriageWait !== undefined ? parseInt(d.dayMedTriageWait, 10) : null);
          dayMedTriageToDocs.push(d.dayMedTriageToDoc !== null && d.dayMedTriageToDoc !== undefined ? parseInt(d.dayMedTriageToDoc, 10) : null);
          dayMedWaits.push(d.dayMedWait !== null && d.dayMedWait !== undefined ? parseInt(d.dayMedWait, 10) : null);
          dayMedStayTimes.push(d.dayMedStayTime !== null && d.dayMedStayTime !== undefined ? parseInt(d.dayMedStayTime, 10) : null);
        });

        // 4. Perform standard batch insert without strict unique constraints (which could fail ON CONFLICT)
        const insertQuery = `
          INSERT INTO atendimentos (
            id, name, dow, date, month, day, year, specialty, entry_hour, wait_time, stay_time, is_base,
            tipo_convenio, convenio, week_of_month, destination, exit_hour, triage_wait, triage_to_doc_wait,
            sala_vermelha_time, soroterapia_time, sutura_time, day_total_att, day_med_triage_wait,
            day_med_triage_to_doc, day_med_wait, day_med_stay_time
          )
          SELECT * FROM UNNEST(
            $1::varchar[], $2::varchar[], $3::varchar[], $4::timestamptz[], $5::int[], $6::int[], 
            $7::int[], $8::varchar[], $9::int[], $10::int[], $11::int[], $12::boolean[],
            $13::varchar[], $14::varchar[], $15::int[], $16::varchar[], $17::int[], $18::int[], $19::int[],
            $20::int[], $21::int[], $22::int[], $23::int[], $24::int[], $25::int[], $26::int[], $27::int[]
          );
        `;

        const values = [
          ids, names, dows, dates, months, days, years, specialties, entryHours, waitTimes, stayTimes, isBases,
          tipoConvenios, convenios, weekOfMonths, destinations, exitHours, triageWaits, triageToDocWaits,
          salaVermelhaTimes, soroterapiaTimes, suturaTimes, dayTotalAtts, dayMedTriageWaits,
          dayMedTriageToDocs, dayMedWaits, dayMedStayTimes
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
