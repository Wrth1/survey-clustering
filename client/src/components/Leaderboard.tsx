import { Trophy } from 'lucide-react';

interface ThresholdRank {
  id: string;
  elo: number;
  wins: number;
  losses: number;
}

interface LeaderboardProps {
  data: ThresholdRank[];
  loading: boolean;
}

export function Leaderboard({ data, loading }: LeaderboardProps) {
  return (
    <div className="leaderboard-sidebar glass">
      <h2>
        <Trophy size={24} color="var(--accent)" />
        Leaderboard
      </h2>
      
      {loading ? (
        <div className="loading" style={{ height: '200px' }}>
          <div className="spinner"></div>
        </div>
      ) : (
        <div className="rank-list">
          {data.map((item, index) => (
            <div key={item.id} className={`rank-item rank-${index + 1} fade-in`} style={{ animationDelay: `${index * 0.05}s` }}>
              <div className="rank-left">
                <span className="rank-number">{index + 1}</span>
                <span className="rank-threshold">T={item.id}</span>
              </div>
              <span className="rank-score">{Math.round(item.elo)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
