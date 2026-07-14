const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
const { Pool } = require('pg');
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

const app = express();
app.use(cors());
app.use(express.json());

const PASSWORD = process.env.SURVEY_PASSWORD;
if (!PASSWORD) {
  console.warn("WARNING: SURVEY_PASSWORD environment variable is not set. Authentication will fail!");
}

function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || authHeader !== `Bearer ${PASSWORD}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }
  next();
}

// Load precomputed data
const precomputedPath = path.join(__dirname, '../data/precomputed_clusters.json');
const labelsPath = path.join(__dirname, '../data/web_labels.json');

const precomputed = JSON.parse(fs.readFileSync(precomputedPath, 'utf-8'));
const labels = JSON.parse(fs.readFileSync(labelsPath, 'utf-8'));
const thresholdsList = Object.keys(precomputed);

// Hybrid Database Setup (Postgres if DATABASE_URL exists, else SQLite)
const isPostgres = !!process.env.DATABASE_URL;
let pgPool, sqliteDb;

if (isPostgres) {
  pgPool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false } // Required for Supabase/Neon
  });
} else {
  sqliteDb = new sqlite3.Database(path.join(__dirname, 'survey.db'));
}

// Database Helpers for Hybrid Support
async function runDb(query, params = []) {
  if (isPostgres) {
    let pgQuery = query.replace(/INSERT OR IGNORE/g, 'INSERT');
    // Convert ? to $1, $2
    let i = 1;
    while (pgQuery.includes('?')) {
      pgQuery = pgQuery.replace('?', `$${i}`);
      i++;
    }
    if (pgQuery.includes('INSERT INTO Thresholds')) {
      pgQuery += ' ON CONFLICT (id) DO NOTHING';
    }
    await pgPool.query(pgQuery, params);
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.run(query, params, function(err) {
        if (err) reject(err); else resolve();
      });
    });
  }
}

async function getDb(query, params = []) {
  if (isPostgres) {
    let pgQuery = query;
    let i = 1;
    while (pgQuery.includes('?')) {
      pgQuery = pgQuery.replace('?', `$${i}`);
      i++;
    }
    const res = await pgPool.query(pgQuery, params);
    return res.rows[0];
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.get(query, params, (err, row) => {
        if (err) reject(err); else resolve(row);
      });
    });
  }
}

async function allDb(query, params = []) {
  if (isPostgres) {
    let pgQuery = query;
    let i = 1;
    while (pgQuery.includes('?')) {
      pgQuery = pgQuery.replace('?', `$${i}`);
      i++;
    }
    const res = await pgPool.query(pgQuery, params);
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      sqliteDb.all(query, params, (err, rows) => {
        if (err) reject(err); else resolve(rows);
      });
    });
  }
}

// Initialize DB schema
async function initDb() {
  await runDb(`
    CREATE TABLE IF NOT EXISTS Thresholds (
      id TEXT PRIMARY KEY,
      elo REAL DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0
    )
  `);
  for (const t of thresholdsList) {
    await runDb(`INSERT OR IGNORE INTO Thresholds (id, elo, wins, losses) VALUES (?, 1200, 0, 0)`, [t]);
  }
}
initDb().catch(console.error);

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// In-memory store for active matches
const activeMatches = new Map();
setInterval(() => {
  const now = Date.now();
  for (const [id, match] of activeMatches.entries()) {
    if (now - match.createdAt > 30 * 60 * 1000) activeMatches.delete(id);
  }
}, 10 * 60 * 1000);

// Routes
app.get('/api/match', requireAuth, (req, res) => {
  let attempts = 0;
  while (attempts < 1000) {
    const t1Idx = Math.floor(Math.random() * thresholdsList.length);
    let t2Idx = Math.floor(Math.random() * thresholdsList.length);
    while (t1Idx === t2Idx) {
      t2Idx = Math.floor(Math.random() * thresholdsList.length);
    }
    
    const t1 = thresholdsList[t1Idx];
    const t2 = thresholdsList[t2Idx];
    
    const t1Data = precomputed[t1];
    const clusterIdx1 = Math.floor(Math.random() * t1Data.clusters.length);
    
    const C1_ids = t1Data.clusters[clusterIdx1];
    const leaderId = t1Data.leaders[clusterIdx1];
    
    const t2Data = precomputed[t2];
    const clusterIdx2 = t2Data.node_to_cluster[leaderId];
    const C2_ids = t2Data.clusters[clusterIdx2];
    
    // The chosen leader's cluster must have at least 3 elements
    if (C1_ids.length >= 3) {
      const leaderLabel = labels[leaderId];
      const C1_labels = C1_ids.map(id => labels[id]);
      const C2_labels = C2_ids.map(id => labels[id]);
      
      const swap = Math.random() > 0.5;
      const matchId = uuidv4();
      
      activeMatches.set(matchId, {
        tA: swap ? t2 : t1,
        tB: swap ? t1 : t2,
        createdAt: Date.now()
      });
      
      return res.json({
        matchId,
        leader: leaderLabel,
        optionA: { id: 'A', cluster: swap ? C2_labels : C1_labels },
        optionB: { id: 'B', cluster: swap ? C1_labels : C2_labels }
      });
    }
    
    attempts++;
  }
  res.status(500).json({ error: "Could not find a valid match." });
});

app.post('/api/vote', requireAuth, async (req, res) => {
  const { matchId, action, selectedOption } = req.body;
  if (!matchId || !action) return res.status(400).json({ error: "matchId and action required" });

  const matchData = activeMatches.get(matchId);
  if (!matchData) return res.status(404).json({ error: "Match not found or expired" });
  
  activeMatches.delete(matchId);

  let t1, t2;
  if (action === 'win') {
    if (selectedOption === 'A') { t1 = matchData.tA; t2 = matchData.tB; }
    else if (selectedOption === 'B') { t1 = matchData.tB; t2 = matchData.tA; }
    else return res.status(400).json({ error: "invalid selectedOption" });
  } else {
    t1 = matchData.tA; t2 = matchData.tB;
  }

  try {
    const row1 = await getDb(`SELECT * FROM Thresholds WHERE id = ?`, [t1]);
    const row2 = await getDb(`SELECT * FROM Thresholds WHERE id = ?`, [t2]);
    if (!row1 || !row2) return res.status(500).json({ error: "Thresholds not found" });

    const K = 32;
    const expected1 = expectedScore(row1.elo, row2.elo);
    const expected2 = expectedScore(row2.elo, row1.elo);
    
    let s1, s2;
    if (action === 'win') { s1 = 1; s2 = 0; }
    else if (action === 'draw') { s1 = 0.5; s2 = 0.5; }
    else if (action === 'both_lose') { s1 = 0; s2 = 0; }
    else return res.status(400).json({ error: "invalid action" });
    
    const newElo1 = row1.elo + K * (s1 - expected1);
    const newElo2 = row2.elo + K * (s2 - expected2);
    
    const wins1 = action === 'win' ? row1.wins + 1 : row1.wins;
    const losses1 = action === 'both_lose' ? row1.losses + 1 : row1.losses;
    const losses2 = (action === 'win' || action === 'both_lose') ? row2.losses + 1 : row2.losses;

    await runDb(`UPDATE Thresholds SET elo = ?, wins = ?, losses = ? WHERE id = ?`, [newElo1, wins1, losses1, t1]);
    await runDb(`UPDATE Thresholds SET elo = ?, losses = ? WHERE id = ?`, [newElo2, losses2, t2]);
    
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/leaderboard', requireAuth, async (req, res) => {
  try {
    const rows = await allDb(`SELECT * FROM Thresholds ORDER BY elo DESC`);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../client/dist')));

app.post('/api/auth', requireAuth, (req, res) => {
  res.json({ success: true });
});

app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
