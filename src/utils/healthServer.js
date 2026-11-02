import { createServer } from 'node:http';
import { formatError } from './logger.js';

/**
 * Optional generic HTTP health endpoint for hosting platforms. It exposes no secrets
 * and is disabled unless PORT is set.
 */
export function startHealthServer(port, client, logger) {
  const server = createServer((request, response) => {
    const pathname = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (request.method !== 'GET' || (pathname !== '/healthz' && pathname !== '/health')) {
      response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
      response.end('Not found');
      return;
    }

    const body = JSON.stringify({
      status: client.isReady() ? 'ok' : 'starting',
      gateway: client.isReady() ? 'connected' : 'not_ready',
      uptimeSeconds: Math.floor((client.uptime ?? 0) / 1000),
    });
    response.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    });
    response.end(body);
  });

  server.on('error', (error) => {
    logger.error('Health server error', { port, error: formatError(error) });
  });
  server.listen(port, '0.0.0.0', () => {
    logger.info('Health endpoint listening', { port, path: '/healthz' });
  });
  return server;
}
