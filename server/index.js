const express = require('express');
const cors = require('cors');
const sqlite3 = require('sqlite3').verbose();
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

// Auth Middleware
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

// Initialize DB
const db = new sqlite3.Database(path.join(__dirname, 'survey.db'));

db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS Thresholds (
      id TEXT PRIMARY KEY,
      elo REAL DEFAULT 1200,
      wins INTEGER DEFAULT 0,
      losses INTEGER DEFAULT 0
    )
  `);

  const stmt = db.prepare(`INSERT OR IGNORE INTO Thresholds (id, elo, wins, losses) VALUES (?, 1200, 0, 0)`);
  thresholdsList.forEach(t => stmt.run(t));
  stmt.finalize();
});

function expectedScore(ratingA, ratingB) {
  return 1 / (1 + Math.pow(10, (ratingB - ratingA) / 400));
}

// In-memory store for active matches (prevents client from knowing threshold IDs)
const activeMatches = new Map();

// Cleanup stale matches every 10 minutes
setInterval(() => {
  const now = Date.now();
  for (const [id, match] of activeMatches.entries()) {
    if (now - match.createdAt > 30 * 60 * 1000) { // 30 min expiry
      activeMatches.delete(id);
    }
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
    
    if (C1_ids.length >= 3) {
      const leaderLabel = labels[leaderId];
      const C1_labels = C1_ids.map(id => labels[id]);
      const C2_labels = C2_ids.map(id => labels[id]);
      
      const swap = Math.random() > 0.5;
      const matchId = uuidv4();
      
      // Store the real mapping secretly
      activeMatches.set(matchId, {
        tA: swap ? t2 : t1,
        tB: swap ? t1 : t2,
        createdAt: Date.now()
      });
      
      return res.json({
        matchId,
        leader: leaderLabel,
        optionA: {
          id: 'A',
          cluster: swap ? C2_labels : C1_labels
        },
        optionB: {
          id: 'B',
          cluster: swap ? C1_labels : C2_labels
        }
      });
    }
    
    attempts++;
  }
  
  res.status(500).json({ error: "Could not find a valid match." });
});

app.post('/api/vote', requireAuth, (req, res) => {
  const { matchId, action, selectedOption } = req.body;
  if (!matchId || !action) {
    return res.status(400).json({ error: "matchId and action required" });
  }

  const matchData = activeMatches.get(matchId);
  if (!matchData) {
    return res.status(404).json({ error: "Match not found or expired" });
  }
  
  // We can immediately delete the match to prevent double-voting
  activeMatches.delete(matchId);

  let t1, t2;
  
  if (action === 'win') {
    if (selectedOption === 'A') {
      t1 = matchData.tA;
      t2 = matchData.tB;
    } else if (selectedOption === 'B') {
      t1 = matchData.tB;
      t2 = matchData.tA;
    } else {
      return res.status(400).json({ error: "invalid selectedOption" });
    }
  } else {
    // For draw or both_lose, order doesn't affect calculation
    t1 = matchData.tA;
    t2 = matchData.tB;
  }

  db.serialize(() => {
    db.get(`SELECT * FROM Thresholds WHERE id = ?`, [t1], (err, row1) => {
      if (err || !row1) return res.status(500).json({ error: "t1 not found" });
      
      db.get(`SELECT * FROM Thresholds WHERE id = ?`, [t2], (err, row2) => {
        if (err || !row2) return res.status(500).json({ error: "t2 not found" });
        
        const K = 32;
        const expected1 = expectedScore(row1.elo, row2.elo);
        const expected2 = expectedScore(row2.elo, row1.elo);
        
        let s1, s2;
        if (action === 'win') {
          s1 = 1; s2 = 0;
        } else if (action === 'draw') {
          s1 = 0.5; s2 = 0.5;
        } else if (action === 'both_lose') {
          s1 = 0; s2 = 0;
        } else {
          return res.status(400).json({ error: "invalid action" });
        }
        
        const newElo1 = row1.elo + K * (s1 - expected1);
        const newElo2 = row2.elo + K * (s2 - expected2);
        
        const wins1 = action === 'win' ? row1.wins + 1 : row1.wins;
        const losses1 = action === 'both_lose' ? row1.losses + 1 : row1.losses;
        const losses2 = (action === 'win' || action === 'both_lose') ? row2.losses + 1 : row2.losses;

        db.run(
          `UPDATE Thresholds SET elo = ?, wins = ?, losses = ? WHERE id = ?`,
          [newElo1, wins1, losses1, t1]
        );
        db.run(
          `UPDATE Thresholds SET elo = ?, losses = ? WHERE id = ?`,
          [newElo2, losses2, t2]
        );
        
        res.json({ success: true });
      });
    });
  });
});

app.get('/api/leaderboard', requireAuth, (req, res) => {
  db.all(`SELECT * FROM Thresholds ORDER BY elo DESC`, (err, rows) => {
    if (err) return res.status(500).json({ error: err.message });
    res.json(rows);
  });
});

// Serve static frontend files
app.use(express.static(path.join(__dirname, '../client/dist')));

// Explicit health check / ping endpoint to verify password
app.post('/api/auth', requireAuth, (req, res) => {
  res.json({ success: true });
});

// Catch-all route to serve index.html for React Router (if needed) or just the main app
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, '../client/dist/index.html'));
});

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Backend running on port ${PORT}`);
});
