// Phase 3 B6: Performance Instrumentation Module
// Centralized performance tracking for SKU detection system

interface PerformanceMetrics {
    totalDetections: number;
    latencyP50: number;
    latencyP95: number;
    latencyP99: number;
    cacheHitRate: number;
    methodDistribution: {
        keyword: number;
        embedding: number;
        gpt: number;
        hybrid: number;
        fasttext?: number;
    };
    errorRate: number;
    avgCost: number;
}

interface DetectionLog {
    timestamp: number;
    method: string;
    latency: number;
    cacheHit: boolean;
    success: boolean;
    cost: number;
}

class PerformanceTracker {
    private logs: DetectionLog[] = [];
    private maxLogs = 1000; // Keep last 1000 detections in memory

    trackDetection(log: DetectionLog) {
        this.logs.push(log);

        // Keep only last N logs
        if (this.logs.length > this.maxLogs) {
            this.logs.shift();
        }
    }

    getMetrics(): PerformanceMetrics {
        if (this.logs.length === 0) {
            return {
                totalDetections: 0,
                latencyP50: 0,
                latencyP95: 0,
                latencyP99: 0,
                cacheHitRate: 0,
                methodDistribution: { keyword: 0, embedding: 0, gpt: 0, hybrid: 0 },
                errorRate: 0,
                avgCost: 0
            };
        }

        // Calculate latency percentiles
        const latencies = this.logs.map(l => l.latency).sort((a, b) => a - b);
        const p50Index = Math.floor(latencies.length * 0.5);
        const p95Index = Math.floor(latencies.length * 0.95);
        const p99Index = Math.floor(latencies.length * 0.99);

        // Calculate cache hit rate
        const cacheHits = this.logs.filter(l => l.cacheHit).length;
        const cacheHitRate = cacheHits / this.logs.length;

        // Calculate method distribution
        const methodCounts = this.logs.reduce((acc, log) => {
            acc[log.method] = (acc[log.method] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const total = this.logs.length;
        const methodDistribution = {
            keyword: (methodCounts['keyword'] || 0) / total,
            embedding: (methodCounts['embedding'] || 0) / total,
            gpt: (methodCounts['gpt'] || 0) / total,
            hybrid: (methodCounts['hybrid'] || 0) / total,
            fasttext: (methodCounts['fasttext'] || 0) / total
        };

        // Calculate error rate
        const errors = this.logs.filter(l => !l.success).length;
        const errorRate = errors / total;

        // Calculate average cost
        const totalCost = this.logs.reduce((sum, l) => sum + l.cost, 0);
        const avgCost = totalCost / total;

        return {
            totalDetections: total,
            latencyP50: latencies[p50Index] || 0,
            latencyP95: latencies[p95Index] || 0,
            latencyP99: latencies[p99Index] || 0,
            cacheHitRate,
            methodDistribution,
            errorRate,
            avgCost
        };
    }

    reset() {
        this.logs = [];
    }

    // Get recent logs for debugging
    getRecentLogs(count: number = 10): DetectionLog[] {
        return this.logs.slice(-count);
    }
}

// Singleton instance
export const performanceTracker = new PerformanceTracker();

// Helper to estimate API cost
export function estimateCost(method: string): number {
    const costs = {
        'keyword': 0,           // No API call
        'embedding': 0.00002,   // text-embedding-3-small
        'gpt': 0.0002,          // gpt-4o-mini
        'hybrid': 0.00022,      // embedding + gpt
        'fasttext': 0           // Local model
    };
    return costs[method as keyof typeof costs] || 0;
}

// Export types
export type { PerformanceMetrics, DetectionLog };
