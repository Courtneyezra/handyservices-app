// Phase 4 B11: Comprehensive Logging & Alerts
// Monitors system health and sends alerts for critical issues

interface HealthMetrics {
    avgLatency: number;
    errorRate: number;
    cacheHitRate: number;
    requestsPerMinute: number;
}

interface Alert {
    severity: 'warning' | 'error' | 'critical';
    message: string;
    timestamp: number;
    metric: string;
    value: number;
}

class MonitoringSystem {
    private recentLatencies: number[] = [];
    private recentErrors: number = 0;
    private recentRequests: number = 0;
    private cacheHits: number = 0;
    private cacheMisses: number = 0;
    private alerts: Alert[] = [];
    private readonly MAX_HISTORY = 100;

    trackRequest(latency: number, success: boolean, cacheHit: boolean) {
        this.recentLatencies.push(latency);
        if (this.recentLatencies.length > this.MAX_HISTORY) {
            this.recentLatencies.shift();
        }

        if (!success) this.recentErrors++;
        this.recentRequests++;

        if (cacheHit) this.cacheHits++;
        else this.cacheMisses++;

        // Check health after each request
        this.checkHealth();
    }

    private checkHealth() {
        const metrics = this.getMetrics();

        // Alert: High latency
        if (metrics.avgLatency > 1000) {
            const consecutiveHigh = this.recentLatencies.slice(-5).every(l => l > 1000);
            if (consecutiveHigh) {
                this.logAlert({
                    severity: 'warning',
                    message: 'Detection latency above 1000ms for 5 consecutive requests',
                    timestamp: Date.now(),
                    metric: 'latency',
                    value: metrics.avgLatency
                });
            }
        }

        // Alert: Low cache hit rate
        if (metrics.cacheHitRate < 0.7 && (this.cacheHits + this.cacheMisses) > 20) {
            this.logAlert({
                severity: 'warning',
                message: `Cache hit rate below 70% (${Math.round(metrics.cacheHitRate * 100)}%)`,
                timestamp: Date.now(),
                metric: 'cacheHitRate',
                value: metrics.cacheHitRate
            });
        }

        // Alert: High error rate
        if (metrics.errorRate > 0.05) {
            this.logAlert({
                severity: 'error',
                message: `Error rate above 5% (${Math.round(metrics.errorRate * 100)}%)`,
                timestamp: Date.now(),
                metric: 'errorRate',
                value: metrics.errorRate
            });
        }
    }

    private logAlert(alert: Alert) {
        // Deduplicate: Don't log same alert within 5 minutes
        const recentSimilar = this.alerts.find(a =>
            a.metric === alert.metric &&
            Date.now() - a.timestamp < 300000 // 5 minutes
        );

        if (recentSimilar) return;

        this.alerts.push(alert);

        // Log to console with color coding
        const emoji = alert.severity === 'critical' ? '🚨' : alert.severity === 'error' ? '❌' : '⚠️';
        console.log(`\n${emoji} [ALERT] ${alert.severity.toUpperCase()}: ${alert.message}`);
        console.log(`   Metric: ${alert.metric} = ${alert.value}`);
        console.log(`   Time: ${new Date(alert.timestamp).toISOString()}\n`);

        // Optional: Send to webhook (Slack, email, etc.)
        if (process.env.ALERT_WEBHOOK_URL) {
            this.sendWebhookAlert(alert);
        }
    }

    private async sendWebhookAlert(alert: Alert) {
        try {
            await fetch(process.env.ALERT_WEBHOOK_URL!, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    text: `${alert.severity.toUpperCase()}: ${alert.message}`,
                    severity: alert.severity,
                    metric: alert.metric,
                    value: alert.value
                })
            });
        } catch (e) {
            console.error('[Monitoring] Failed to send webhook alert:', e);
        }
    }

    getMetrics(): HealthMetrics {
        const avgLatency = this.recentLatencies.length > 0
            ? this.recentLatencies.reduce((a, b) => a + b, 0) / this.recentLatencies.length
            : 0;

        const errorRate = this.recentRequests > 0
            ? this.recentErrors / this.recentRequests
            : 0;

        const cacheHitRate = (this.cacheHits + this.cacheMisses) > 0
            ? this.cacheHits / (this.cacheHits + this.cacheMisses)
            : 0;

        return {
            avgLatency,
            errorRate,
            cacheHitRate,
            requestsPerMinute: this.recentRequests // Simplified
        };
    }

    getRecentAlerts(count: number = 10): Alert[] {
        return this.alerts.slice(-count);
    }

    reset() {
        this.recentLatencies = [];
        this.recentErrors = 0;
        this.recentRequests = 0;
        this.cacheHits = 0;
        this.cacheMisses = 0;
    }
}

// Singleton instance
export const monitoring = new MonitoringSystem();

// Export types
export type { HealthMetrics, Alert };
