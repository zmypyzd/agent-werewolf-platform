import { buildServer } from './server.js';

const app = buildServer();

const port = parseInt(process.env['PORT'] ?? '3000', 10);
const host = process.env['HOST'] ?? '0.0.0.0';

app.listen({ port, host }, (err, address) => {
  if (err) {
    console.error(err);
    process.exit(1);
  }
  console.log(`Agent Poker Platform API running at ${address}`);
  console.log('Endpoints:');
  console.log('  POST   /api/v1/tables');
  console.log('  GET    /api/v1/tables');
  console.log('  GET    /api/v1/tables/:tableId');
  console.log('  POST   /api/v1/tables/:tableId/agents');
  console.log('  POST   /api/v1/tables/:tableId/hands/start');
  console.log('  GET    /api/v1/tables/:tableId/hands/:handId');
  console.log('  GET    /api/v1/tables/:tableId/hands/:handId/replay');
  console.log('  POST   /api/v1/simulate');
});
