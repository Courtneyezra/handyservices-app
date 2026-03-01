/**
 * Test Tube Map WebSocket Real-time Updates
 *
 * This script tests WebSocket functionality for real-time lead updates:
 * 1. Connect to WebSocket server
 * 2. Create a lead via API
 * 3. Verify `lead:created` event received
 * 4. Update lead stage
 * 5. Verify `lead:stage_change` event received
 *
 * Prerequisites:
 * - Server must be running with WebSocket support: npm run dev
 *
 * Usage: npx tsx scripts/test-tube-map-websocket.ts
 */

import WebSocket from 'ws';
import { nanoid } from 'nanoid';

const WS_URL = process.env.WS_URL || 'ws://localhost:5000';
const API_BASE = process.env.API_BASE || 'http://localhost:5000';
const TEST_TIMEOUT = 30000; // 30 seconds

interface WebSocketMessage {
    type: string;
    payload?: any;
    timestamp?: string;
}

interface TestResult {
    name: string;
    passed: boolean;
    error?: string;
    duration?: number;
}

const results: TestResult[] = [];

class TubeMapWebSocketTester {
    private ws: WebSocket | null = null;
    private messageQueue: WebSocketMessage[] = [];
    private connected = false;
    private testLeadId: string | null = null;
    private testPhone: string;

    constructor() {
        this.testPhone = `07700666${Math.floor(1000 + Math.random() * 9000)}`;
    }

    async connect(): Promise<void> {
        return new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, 10000);

            try {
                this.ws = new WebSocket(WS_URL);

                this.ws.on('open', () => {
                    clearTimeout(timeout);
                    this.connected = true;
                    console.log('   \u2713 WebSocket connected');
                    resolve();
                });

                this.ws.on('message', (data: WebSocket.RawData) => {
                    try {
                        const message = JSON.parse(data.toString()) as WebSocketMessage;
                        this.messageQueue.push(message);
                        console.log(`   <- Received: ${message.type}`);
                    } catch (e) {
                        console.log(`   <- Received non-JSON: ${data.toString().substring(0, 50)}`);
                    }
                });

                this.ws.on('error', (error) => {
                    clearTimeout(timeout);
                    console.error('   WebSocket error:', error.message);
                    reject(error);
                });

                this.ws.on('close', () => {
                    this.connected = false;
                    console.log('   WebSocket disconnected');
                });
            } catch (error) {
                clearTimeout(timeout);
                reject(error);
            }
        });
    }

    disconnect(): void {
        if (this.ws) {
            this.ws.close();
            this.ws = null;
        }
    }

    clearMessages(): void {
        this.messageQueue = [];
    }

    async waitForMessage(type: string, timeout = 5000): Promise<WebSocketMessage | null> {
        const startTime = Date.now();

        while (Date.now() - startTime < timeout) {
            const message = this.messageQueue.find(m => m.type === type);
            if (message) {
                // Remove from queue
                const index = this.messageQueue.indexOf(message);
                if (index > -1) {
                    this.messageQueue.splice(index, 1);
                }
                return message;
            }
            await this.sleep(100);
        }

        return null;
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // ==========================================
    // TEST METHODS
    // ==========================================

    async testConnection(): Promise<TestResult> {
        const start = Date.now();
        try {
            await this.connect();
            return {
                name: 'WebSocket Connection',
                passed: this.connected,
                duration: Date.now() - start,
            };
        } catch (e: any) {
            return {
                name: 'WebSocket Connection',
                passed: false,
                error: e.message,
                duration: Date.now() - start,
            };
        }
    }

    async testLeadCreatedEvent(): Promise<TestResult> {
        const start = Date.now();
        this.clearMessages();

        try {
            // Create lead via API
            const response = await fetch(`${API_BASE}/api/leads`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    customerName: 'WebSocket Test User',
                    phone: this.testPhone,
                    jobDescription: 'WebSocket test - TV mounting',
                    source: 'test_websocket',
                }),
            });

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            const data = await response.json();
            this.testLeadId = data.leadId;

            console.log(`   Created lead: ${this.testLeadId}`);

            // Wait for WebSocket event
            const message = await this.waitForMessage('lead:created', 5000);

            if (message) {
                const matchesLead = message.payload?.leadId === this.testLeadId;
                return {
                    name: 'Lead Created Event',
                    passed: matchesLead,
                    error: matchesLead ? undefined : 'Event received but leadId mismatch',
                    duration: Date.now() - start,
                };
            }

            // If no WebSocket event, it might not be implemented yet
            return {
                name: 'Lead Created Event',
                passed: false,
                error: 'No lead:created event received (may not be implemented)',
                duration: Date.now() - start,
            };
        } catch (e: any) {
            return {
                name: 'Lead Created Event',
                passed: false,
                error: e.message,
                duration: Date.now() - start,
            };
        }
    }

    async testStageChangeEvent(): Promise<TestResult> {
        const start = Date.now();
        this.clearMessages();

        if (!this.testLeadId) {
            return {
                name: 'Stage Change Event',
                passed: false,
                error: 'No test lead available',
                duration: Date.now() - start,
            };
        }

        try {
            // Update stage via API
            const response = await fetch(`${API_BASE}/api/admin/leads/${this.testLeadId}/stage`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    stage: 'contacted',
                    reason: 'WebSocket test',
                }),
            });

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            console.log(`   Updated stage to: contacted`);

            // Wait for WebSocket event
            const message = await this.waitForMessage('lead:stage_change', 5000);

            if (message) {
                const matchesLead = message.payload?.leadId === this.testLeadId;
                const hasNewStage = message.payload?.newStage === 'contacted';
                return {
                    name: 'Stage Change Event',
                    passed: matchesLead && hasNewStage,
                    error: (matchesLead && hasNewStage) ? undefined : 'Event mismatch',
                    duration: Date.now() - start,
                };
            }

            return {
                name: 'Stage Change Event',
                passed: false,
                error: 'No lead:stage_change event received (may not be implemented)',
                duration: Date.now() - start,
            };
        } catch (e: any) {
            return {
                name: 'Stage Change Event',
                passed: false,
                error: e.message,
                duration: Date.now() - start,
            };
        }
    }

    async testRouteAssignmentEvent(): Promise<TestResult> {
        const start = Date.now();
        this.clearMessages();

        if (!this.testLeadId) {
            return {
                name: 'Route Assignment Event',
                passed: false,
                error: 'No test lead available',
                duration: Date.now() - start,
            };
        }

        try {
            // This endpoint may not exist yet
            const response = await fetch(`${API_BASE}/api/admin/leads/${this.testLeadId}/route`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    route: 'video',
                }),
            });

            if (response.status === 404) {
                return {
                    name: 'Route Assignment Event',
                    passed: false,
                    error: 'Endpoint not implemented yet',
                    duration: Date.now() - start,
                };
            }

            if (!response.ok) {
                throw new Error(`API returned ${response.status}`);
            }

            // Wait for WebSocket event
            const message = await this.waitForMessage('lead:route_assigned', 5000);

            if (message) {
                return {
                    name: 'Route Assignment Event',
                    passed: true,
                    duration: Date.now() - start,
                };
            }

            return {
                name: 'Route Assignment Event',
                passed: false,
                error: 'No lead:route_assigned event received',
                duration: Date.now() - start,
            };
        } catch (e: any) {
            return {
                name: 'Route Assignment Event',
                passed: false,
                error: e.message,
                duration: Date.now() - start,
            };
        }
    }

    async testPingPong(): Promise<TestResult> {
        const start = Date.now();

        if (!this.ws || !this.connected) {
            return {
                name: 'Ping/Pong',
                passed: false,
                error: 'Not connected',
                duration: Date.now() - start,
            };
        }

        try {
            // Send ping
            this.ws.send(JSON.stringify({ type: 'ping' }));

            // Wait for pong
            const message = await this.waitForMessage('pong', 3000);

            return {
                name: 'Ping/Pong',
                passed: !!message,
                error: message ? undefined : 'No pong received (ping/pong may not be implemented)',
                duration: Date.now() - start,
            };
        } catch (e: any) {
            return {
                name: 'Ping/Pong',
                passed: false,
                error: e.message,
                duration: Date.now() - start,
            };
        }
    }

    async cleanup(): Promise<void> {
        if (this.testLeadId) {
            try {
                // Delete test lead
                await fetch(`${API_BASE}/api/leads/${this.testLeadId}`, {
                    method: 'DELETE',
                });
            } catch (e) {
                // Ignore cleanup errors
            }
        }
        this.disconnect();
    }
}

// ==========================================
// MAIN TEST RUNNER
// ==========================================

async function main() {
    console.log('='.repeat(60));
    console.log(' TUBE MAP WEBSOCKET TEST SUITE');
    console.log('='.repeat(60));
    console.log(`\n  WebSocket URL: ${WS_URL}`);
    console.log(`  API URL: ${API_BASE}\n`);

    const tester = new TubeMapWebSocketTester();
    const startTime = Date.now();

    try {
        // Test 1: Connection
        console.log('\n1. Testing WebSocket Connection...');
        const connResult = await tester.testConnection();
        results.push(connResult);
        console.log(`   ${connResult.passed ? '\u2713' : '\u2717'} ${connResult.name}: ${connResult.passed ? 'PASS' : connResult.error}`);

        if (!connResult.passed) {
            console.log('\n   Cannot continue without WebSocket connection.');
            console.log('   Make sure the server is running: npm run dev\n');
            process.exit(1);
        }

        // Test 2: Ping/Pong
        console.log('\n2. Testing Ping/Pong...');
        const pingResult = await tester.testPingPong();
        results.push(pingResult);
        console.log(`   ${pingResult.passed ? '\u2713' : '\u2717'} ${pingResult.name}: ${pingResult.passed ? 'PASS' : pingResult.error}`);

        // Test 3: Lead Created Event
        console.log('\n3. Testing Lead Created Event...');
        const createResult = await tester.testLeadCreatedEvent();
        results.push(createResult);
        console.log(`   ${createResult.passed ? '\u2713' : '\u2717'} ${createResult.name}: ${createResult.passed ? 'PASS' : createResult.error}`);

        // Test 4: Stage Change Event
        console.log('\n4. Testing Stage Change Event...');
        const stageResult = await tester.testStageChangeEvent();
        results.push(stageResult);
        console.log(`   ${stageResult.passed ? '\u2713' : '\u2717'} ${stageResult.name}: ${stageResult.passed ? 'PASS' : stageResult.error}`);

        // Test 5: Route Assignment Event
        console.log('\n5. Testing Route Assignment Event...');
        const routeResult = await tester.testRouteAssignmentEvent();
        results.push(routeResult);
        console.log(`   ${routeResult.passed ? '\u2713' : '\u2717'} ${routeResult.name}: ${routeResult.passed ? 'PASS' : routeResult.error}`);

        // Cleanup
        console.log('\n6. Cleaning up...');
        await tester.cleanup();
        console.log('   \u2713 Cleanup complete');

    } catch (error: any) {
        console.error('\n Test suite error:', error.message);
        await tester.cleanup();
    }

    // Summary
    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    const passed = results.filter(r => r.passed).length;
    const failed = results.filter(r => !r.passed).length;

    console.log('\n' + '='.repeat(60));
    console.log(' WEBSOCKET TEST SUMMARY');
    console.log('='.repeat(60));
    console.log(`  Duration: ${duration}s`);
    console.log(`  Total: ${results.length}`);
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);

    if (failed > 0) {
        console.log('\n  Failed tests:');
        for (const result of results.filter(r => !r.passed)) {
            console.log(`    \u2717 ${result.name}: ${result.error}`);
        }
    }

    // Note about implementation status
    console.log('\n  Note: Some tests may fail if WebSocket events');
    console.log('  are not yet implemented in the server.');
    console.log('  Required events for Tube Map:');
    console.log('    - lead:created');
    console.log('    - lead:stage_change');
    console.log('    - lead:route_assigned');
    console.log('    - lead:snoozed');
    console.log('    - lead:merged');

    if (passed === results.length) {
        console.log('\n ALL TESTS PASSED');
    } else {
        console.log(`\n ${passed}/${results.length} TESTS PASSED`);
    }
    console.log('='.repeat(60) + '\n');

    process.exit(failed > 0 ? 1 : 0);
}

main().catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
});
