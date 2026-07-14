import { useEffect, useState } from 'react';
import './index.css';
import './App.css';
import { VotingArena } from './components/VotingArena';
import type { MatchData } from './components/VotingArena';
import { Leaderboard } from './components/Leaderboard';

const API_URL = import.meta.env.DEV ? 'http://localhost:3001/api' : '/api';

function App() {
  const [password, setPassword] = useState(localStorage.getItem('survey_password') || '');
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [loginError, setLoginError] = useState('');
  
  const [match, setMatch] = useState<MatchData | null>(null);
  const [leaderboard, setLeaderboard] = useState([]);
  const [loadingMatch, setLoadingMatch] = useState(true);
  const [loadingBoard, setLoadingBoard] = useState(true);

  // Helper to append Authorization header
  const authHeaders = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${password}`
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginError('');
    try {
      const res = await fetch(`${API_URL}/auth`, {
        method: 'POST',
        headers: authHeaders
      });
      if (res.ok) {
        localStorage.setItem('survey_password', password);
        setIsAuthenticated(true);
      } else {
        setLoginError('Invalid password');
      }
    } catch (err) {
      setLoginError('Could not connect to server');
    }
  };

  const fetchLeaderboard = async () => {
    try {
      const res = await fetch(`${API_URL}/leaderboard`, { headers: authHeaders });
      if (res.status === 401) return setIsAuthenticated(false);
      const data = await res.json();
      setLeaderboard(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingBoard(false);
    }
  };

  const fetchMatch = async () => {
    setLoadingMatch(true);
    try {
      const res = await fetch(`${API_URL}/match`, { headers: authHeaders });
      if (res.status === 401) return setIsAuthenticated(false);
      const data = await res.json();
      setMatch(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMatch(false);
    }
  };

  const handleVote = async (action: 'win' | 'both_lose' | 'draw' | 'skip', selectedOption?: string) => {
    if (!match) return;
    
    try {
      if (action !== 'skip') {
        const res = await fetch(`${API_URL}/vote`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ 
            matchId: match.matchId, 
            action, 
            selectedOption 
          })
        });
        if (res.status === 401) return setIsAuthenticated(false);
      }
      // Fetch new match and update leaderboard in parallel
      Promise.all([fetchMatch(), fetchLeaderboard()]);
    } catch (e) {
      console.error(e);
    }
  };

  useEffect(() => {
    if (password && !isAuthenticated) {
      // Auto-login if we have a password in localStorage
      fetch(`${API_URL}/auth`, { method: 'POST', headers: authHeaders })
        .then(res => {
          if (res.ok) setIsAuthenticated(true);
          else localStorage.removeItem('survey_password');
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated) {
      fetchLeaderboard();
      fetchMatch();
    }
  }, [isAuthenticated]);

  if (!isAuthenticated) {
    return (
      <div className="app-container" style={{ justifyContent: 'center', alignItems: 'center' }}>
        <div className="login-container glass fade-in">
          <h2>Secret Access Required</h2>
          <p>Please enter the password to participate in the survey.</p>
          <form onSubmit={handleLogin}>
            <input 
              type="password" 
              placeholder="Password" 
              value={password}
              onChange={e => setPassword(e.target.value)}
              className="login-input"
            />
            <button type="submit" className="login-btn">Enter</button>
            {loginError && <p className="login-error">{loginError}</p>}
          </form>
        </div>
      </div>
    );
  }

  return (
    <div className="app-container">
      <main className="main-content">
        <header className="header">
          <h1>Cluster Voting Arena</h1>
          <p>Help us find the perfect similarity threshold by evaluating grouped topics.</p>
        </header>

        <VotingArena 
          match={match} 
          onVote={handleVote} 
          loading={loadingMatch} 
        />
      </main>

      <Leaderboard 
        data={leaderboard} 
        loading={loadingBoard} 
      />
    </div>
  );
}

export default App;
