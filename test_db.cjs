const { Client } = require('pg');
require('dotenv').config();

async function run() {
  const client = new Client({
    connectionString: "postgresql://postgres:V5IOOx2uATeXNJhFys^31HL$h@db.aekvtnyciybockeytbmf.supabase.co:5432/postgres"
  });
  await client.connect();
  const res = await client.query("SELECT count(*) FROM information_schema.tables WHERE table_name IN ('learnings', 'query_sessions')");
  console.log(res.rows[0].count);
  await client.end();
}
run();
