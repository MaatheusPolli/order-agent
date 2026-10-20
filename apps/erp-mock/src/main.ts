import { buildErpServer } from './server.js';

const port = Number(process.env.PORT ?? 4001);
await buildErpServer().listen({ port, host: '0.0.0.0' });
console.log(`ERP mock ouvindo em :${port}`);
