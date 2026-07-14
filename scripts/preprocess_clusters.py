import json
import os
from collections import defaultdict

def main():
    print("Loading data...")
    # Read web_similarities.json
    with open('../data/web_similarities.json', 'r') as f:
        similarities = json.load(f)
    
    with open('../data/web_labels.json', 'r') as f:
        labels = json.load(f)

    num_nodes = len(labels)
    
    # We will build a symmetric adjacency list with original weights (0-100)
    # to quickly compute clusters and leader average similarity.
    print("Building adjacency list...")
    adj = [{} for _ in range(num_nodes)]
    for id1, inner_array in enumerate(similarities):
        if not inner_array:
            continue
        for i in range(0, len(inner_array), 2):
            id2 = inner_array[i]
            score = inner_array[i + 1]
            adj[id1][id2] = score
            adj[id2][id1] = score # Make symmetric

    thresholds = [40, 45, 50, 55, 60, 65, 70, 75, 80, 85, 90, 95]
    output_data = {}

    for t in thresholds:
        print(f"Processing threshold {t/100:.2f}...")
        visited = [False] * num_nodes
        clusters = []
        leaders = []
        node_to_cluster = [-1] * num_nodes

        for i in range(num_nodes):
            if not visited[i]:
                # BFS to find connected component for threshold `t`
                comp = []
                queue = [i]
                visited[i] = True
                
                while queue:
                    curr = queue.pop(0)
                    comp.append(curr)
                    for neighbor, score in adj[curr].items():
                        if score >= t and not visited[neighbor]:
                            visited[neighbor] = True
                            queue.append(neighbor)
                
                # Now find the leader of `comp`
                leader = -1
                max_avg_sim = -1.0
                
                if len(comp) == 1:
                    leader = comp[0]
                else:
                    for node in comp:
                        total_sim = 0
                        for other in comp:
                            if node != other:
                                total_sim += adj[node].get(other, 0) # 0 if not connected
                        avg_sim = total_sim / (len(comp) - 1)
                        if avg_sim > max_avg_sim:
                            max_avg_sim = avg_sim
                            leader = node
                
                cluster_idx = len(clusters)
                clusters.append(comp)
                leaders.append(leader)
                for node in comp:
                    node_to_cluster[node] = cluster_idx
        
        output_data[f"{t/100:.2f}"] = {
            "clusters": clusters,
            "leaders": leaders,
            "node_to_cluster": node_to_cluster
        }
    
    print("Saving precomputed_clusters.json...")
    with open('../data/precomputed_clusters.json', 'w') as f:
        json.dump(output_data, f, separators=(',', ':')) # Compress slightly
    print("Done!")

if __name__ == '__main__':
    main()
