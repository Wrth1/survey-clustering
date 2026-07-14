import { Crown, HelpCircle } from 'lucide-react';
import { useState } from 'react';

export interface MatchOption {
  id: string; // 'A' or 'B'
  cluster: string[];
}

export interface MatchData {
  matchId: string;
  leader: string;
  optionA: MatchOption;
  optionB: MatchOption;
}

interface VotingArenaProps {
  match: MatchData | null;
  onVote: (action: 'win' | 'both_lose' | 'draw' | 'skip', selectedOption?: string) => void;
  loading: boolean;
}

export function VotingArena({ match, onVote, loading }: VotingArenaProps) {
  const [animating, setAnimating] = useState(false);

  const handleAction = (action: 'win' | 'both_lose' | 'draw' | 'skip', selectedOption?: string) => {
    if (animating) return;
    setAnimating(true);
    onVote(action, selectedOption);
    setTimeout(() => {
      setAnimating(false);
    }, 400); // Wait for transition
  };

  if (loading || !match) {
    return (
      <div className="arena-container">
        <div className="loading">
          <div className="spinner"></div>
          <p>Finding a match...</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`arena-container fade-in ${animating ? 'opacity-50 pointer-events-none' : ''}`}>
      
      <div className="leader-topic-container glass fade-in">
        <div className="leader-label">
          <Crown size={16} /> Leader Topic
        </div>
        <div className="leader-title">{match.leader}</div>
        <p style={{ color: 'var(--text-secondary)', marginTop: '0.5rem', fontSize: '0.9rem' }}>
          Which clustering makes more sense for this topic?
        </p>
      </div>

      <div className="actions-container" style={{ marginBottom: '2rem', marginTop: '0' }}>
        <button className="action-btn bad-btn" onClick={() => handleAction('both_lose')}>
          Both are bad
        </button>
        <button className="action-btn draw-btn" onClick={() => handleAction('draw')}>
          I don't know (Draw)
        </button>
        <button className="action-btn skip-btn" onClick={() => handleAction('skip')}>
          Skip
        </button>
      </div>
      
      <p className="hint-text" style={{ marginTop: '0', marginBottom: '2rem' }}>
        <HelpCircle size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }}/>
        If you don't have the expertise on this subject to judge the clusters, just click <strong>Skip</strong>.
      </p>

      <div className="options-grid">
        <div className="cluster-card glass" onClick={() => handleAction('win', match.optionA.id)}>
          <h3>
            Option A
            <span className="tag-count">{match.optionA.cluster.length} Items</span>
          </h3>
          <ul className="topic-list">
            {match.optionA.cluster.map((topic, i) => (
              <li key={i} className={`topic-tag ${topic === match.leader ? 'leader-tag' : ''}`}>
                {topic === match.leader && <Crown size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }}/>}
                {topic}
              </li>
            ))}
          </ul>
        </div>

        <div className="cluster-card glass" onClick={() => handleAction('win', match.optionB.id)}>
          <h3>
            Option B
            <span className="tag-count">{match.optionB.cluster.length} Items</span>
          </h3>
          <ul className="topic-list">
            {match.optionB.cluster.map((topic, i) => (
              <li key={i} className={`topic-tag ${topic === match.leader ? 'leader-tag' : ''}`}>
                {topic === match.leader && <Crown size={14} style={{ display: 'inline', marginRight: '4px', verticalAlign: 'text-bottom' }}/>}
                {topic}
              </li>
            ))}
          </ul>
        </div>
      </div>


    </div>
  );
}
