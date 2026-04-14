import pg from "pg";
import dotenv from "dotenv";
import dns from "dns";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });

// Force IPv4 (matching db.ts pattern)
const originalLookup = dns.lookup;
dns.lookup = (hostname, options, callback) => {
  if (typeof options === "function") {
    callback = options;
    options = {};
  } else if (!options) {
    options = {};
  }
  options.family = 4;
  return originalLookup(hostname, options, callback);
};

const connectionString = process.env.DATABASE_URL.replace("-pooler", "");
const pool = new pg.Pool({
  connectionString,
  max: 3,
  connectionTimeoutMillis: 15000,
  ssl: { rejectUnauthorized: false },
});

async function run() {
  const client = await pool.connect();
  try {
    console.log("Connected to database successfully.\n");

    // ==============================
    // CALLS
    // ==============================
    console.log("=".repeat(60));
    console.log("  CALLS TABLE");
    console.log("=".repeat(60));

    // Total calls
    const totalCalls = await client.query("SELECT COUNT(*) as total FROM calls");
    console.log(`\nTotal calls: ${totalCalls.rows[0].total}`);

    // Calls per month (last 6 months)
    const callsPerMonth = await client.query(`
      SELECT
        TO_CHAR(start_time, 'YYYY-MM') AS month,
        COUNT(*) AS call_count
      FROM calls
      WHERE start_time >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(start_time, 'YYYY-MM')
      ORDER BY month DESC
    `);
    console.log("\nCalls per month (last 6 months):");
    console.table(callsPerMonth.rows);

    // Calls per week (last 8 weeks)
    const callsPerWeek = await client.query(`
      SELECT
        TO_CHAR(DATE_TRUNC('week', start_time), 'YYYY-MM-DD') AS week_start,
        COUNT(*) AS call_count
      FROM calls
      WHERE start_time >= NOW() - INTERVAL '8 weeks'
      GROUP BY DATE_TRUNC('week', start_time)
      ORDER BY week_start DESC
    `);
    console.log("Calls per week (last 8 weeks):");
    console.table(callsPerWeek.rows);

    // Average calls per day
    const avgCallsPerDay = await client.query(`
      SELECT ROUND(AVG(daily_count)::numeric, 2) AS avg_calls_per_day
      FROM (
        SELECT DATE(start_time) AS day, COUNT(*) AS daily_count
        FROM calls
        GROUP BY DATE(start_time)
      ) sub
    `);
    console.log(`Average calls per day: ${avgCallsPerDay.rows[0].avg_calls_per_day}`);

    // ==============================
    // PERSONALIZED QUOTES
    // ==============================
    console.log("\n" + "=".repeat(60));
    console.log("  PERSONALIZED QUOTES TABLE");
    console.log("=".repeat(60));

    // Total quotes
    const totalQuotes = await client.query("SELECT COUNT(*) as total FROM personalized_quotes");
    console.log(`\nTotal quotes: ${totalQuotes.rows[0].total}`);

    // Quotes per month (last 6 months)
    const quotesPerMonth = await client.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS quote_count
      FROM personalized_quotes
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month DESC
    `);
    console.log("\nQuotes per month (last 6 months):");
    console.table(quotesPerMonth.rows);

    // Quotes with deposit paid (accepted)
    const acceptedQuotes = await client.query(`
      SELECT COUNT(*) AS accepted
      FROM personalized_quotes
      WHERE deposit_paid_at IS NOT NULL
    `);
    console.log(`Quotes with deposit paid (accepted): ${acceptedQuotes.rows[0].accepted}`);

    // Conversion rate
    const total = parseInt(totalQuotes.rows[0].total);
    const accepted = parseInt(acceptedQuotes.rows[0].accepted);
    const conversionRate = total > 0 ? ((accepted / total) * 100).toFixed(2) : "0.00";
    console.log(`Conversion rate (deposit/total): ${conversionRate}% (${accepted}/${total})`);

    // Accepted quotes per month
    const acceptedPerMonth = await client.query(`
      SELECT
        TO_CHAR(deposit_paid_at, 'YYYY-MM') AS month,
        COUNT(*) AS accepted_count
      FROM personalized_quotes
      WHERE deposit_paid_at IS NOT NULL
        AND deposit_paid_at >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(deposit_paid_at, 'YYYY-MM')
      ORDER BY month DESC
    `);
    if (acceptedPerMonth.rows.length > 0) {
      console.log("\nAccepted quotes per month (last 6 months):");
      console.table(acceptedPerMonth.rows);
    }

    // ==============================
    // LEADS
    // ==============================
    console.log("\n" + "=".repeat(60));
    console.log("  LEADS TABLE");
    console.log("=".repeat(60));

    // Total leads
    const totalLeads = await client.query("SELECT COUNT(*) as total FROM leads");
    console.log(`\nTotal leads: ${totalLeads.rows[0].total}`);

    // Leads per month (last 6 months)
    const leadsPerMonth = await client.query(`
      SELECT
        TO_CHAR(created_at, 'YYYY-MM') AS month,
        COUNT(*) AS lead_count
      FROM leads
      WHERE created_at >= NOW() - INTERVAL '6 months'
      GROUP BY TO_CHAR(created_at, 'YYYY-MM')
      ORDER BY month DESC
    `);
    console.log("\nLeads per month (last 6 months):");
    console.table(leadsPerMonth.rows);

    // Leads by stage
    const leadsByStage = await client.query(`
      SELECT
        COALESCE(stage, 'NULL/unset') AS stage,
        COUNT(*) AS count
      FROM leads
      GROUP BY stage
      ORDER BY count DESC
    `);
    console.log("Leads by stage:");
    console.table(leadsByStage.rows);

    // ==============================
    // SUMMARY
    // ==============================
    console.log("\n" + "=".repeat(60));
    console.log("  SUMMARY");
    console.log("=".repeat(60));
    console.log(`Total Calls:    ${totalCalls.rows[0].total}`);
    console.log(`Total Leads:    ${totalLeads.rows[0].total}`);
    console.log(`Total Quotes:   ${totalQuotes.rows[0].total}`);
    console.log(`Accepted:       ${acceptedQuotes.rows[0].accepted}`);
    console.log(`Conversion:     ${conversionRate}%`);
    console.log(`Avg Calls/Day:  ${avgCallsPerDay.rows[0].avg_calls_per_day}`);

  } catch (err) {
    console.error("Query error:", err.message);
    if (err.message.includes("does not exist")) {
      console.error("Hint: The table may not exist or column names may differ.");
    }
  } finally {
    client.release();
    await pool.end();
  }
}

run();
