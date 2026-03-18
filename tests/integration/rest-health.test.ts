import { describe, it, expect, afterAll } from 'vitest';
import http from 'http';
import { createRestServer, type ConnectionStatus } from '../../src/transport/rest-server.js';
import { CommandHandler } from '../../src/command/command-handler.js';
import type { DeviceMap } from '../../src/config/device-map.schema.js';

// Helper: HTTP GET request
function httpGet(server: http.Server, path: string): Promise<{ status: number; body: any }> {
  return new Promise((resolve, reject) => {
    const addr = server.address() as { port: number };
    http.get(`http://localhost:${addr.port}${path}`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => resolve({ status: res.statusCode!, body: JSON.parse(data) }));
    }).on('error', reject);
  });
}

describe('REST /api/health — Multi-Connection', () => {
  const mockConnections: ConnectionStatus[] = [
    { connectionId: 'STATION_A', protocol: 'opcua', isConnected: () => true },
    { connectionId: 'STATION_B', protocol: 'opcua', isConnected: () => false },
  ];

  const mockDeviceMap: DeviceMap = { connections: [] };
  const mockHandler = new CommandHandler(new Map(), new Map());

  const app = createRestServer({
    commandHandler: mockHandler,
    connections: mockConnections,
    deviceMap: mockDeviceMap,
    startTime: Date.now(),
  });

  const server = app.listen(0); // random port

  afterAll(() => {
    server.close();
  });

  it('trả về trạng thái từng connection riêng biệt với overall status', async () => {
    const res = await httpGet(server, '/api/health');

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.connections).toBeDefined();
    expect(res.body.connections.STATION_A).toEqual({ protocol: 'opcua', status: 'connected' });
    expect(res.body.connections.STATION_B).toEqual({ protocol: 'opcua', status: 'disconnected' });
    expect(typeof res.body.uptime).toBe('number');
  });

  it('GET /api/devices trả về device map', async () => {
    const res = await httpGet(server, '/api/devices');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('connections');
  });
});
