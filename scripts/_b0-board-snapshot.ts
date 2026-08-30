// B-Phase0: capture GET /api/inbox/board response via the router directly
// (bypasses requireAdmin by mounting the router in a throwaway express app).
import express from 'express';
import { inboxBoardRouter } from '../server/inbox-board';
import http from 'node:http';
import fs from 'node:fs';

async function main() {
  const app = express();
  app.use(express.json());
  app.use('/api/inbox', inboxBoardRouter);
  const server = http.createServer(app);
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as any).port;
  const out = process.argv[2] || '/tmp/board-before.json';
  const res = await fetch(`http://127.0.0.1:${port}/api/inbox/board`);
  const json = await res.json();
  fs.writeFileSync(out, JSON.stringify(json, null, 2));
  console.log('status', res.status, '→', out, 'cards:', json?.totals?.conversations);
  server.close();
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
