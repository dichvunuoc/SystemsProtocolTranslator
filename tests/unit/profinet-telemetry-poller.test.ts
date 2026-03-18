import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as net from 'net';
import { ProfinetClient } from '../../src/telemetry/profinet-client.js';
import { ProfinetTelemetryPoller } from '../../src/telemetry/profinet-telemetry-poller.js';
import type { ProfinetTelemetryDevice } from '../../src/config/device-map.schema.js';

const TEST_PORT = 39900 + Math.floor(Math.random() * 100);

function createMockServer(port: number): net.Server {
  return net.createServer((socket) => {
    socket.on('data', (data) => {
      const opcode = data.readUInt8(0);
      const length = data.readUInt16BE(7);

      if (opcode === 0x01) {
        const resp = Buffer.alloc(1 + length);
        resp.writeUInt8(0, 0);
        if (length >= 4) resp.writeFloatBE(42.5, 1);
        else if (length >= 1) resp.writeUInt8(1, 1);
        socket.write(resp);
      }
    });
  });
}

const testDevices: ProfinetTelemetryDevice[] = [
  { deviceId: 'PN_TEST_TEMP', slot: 1, subslot: 1, index: 0, length: 4, dataType: 'Float32', unit: '°C', description: 'Test temp' },
  { deviceId: 'PN_TEST_BOOL', slot: 2, subslot: 1, index: 0, length: 1, dataType: 'Boolean', unit: '', description: 'Test bool' },
];

describe('ProfinetTelemetryPoller', () => {
  let server: net.Server;
  let client: ProfinetClient;
  let poller: ProfinetTelemetryPoller;

  beforeEach(async () => {
    server = createMockServer(TEST_PORT);
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
    client = new ProfinetClient('TEST_PN', 'localhost', TEST_PORT, undefined, { baseMs: 100, maxMs: 1000 });
    await client.connect();
    poller = new ProfinetTelemetryPoller('TEST_PN', client, testDevices, 100);
  });

  afterEach(async () => {
    poller.stop();
    await client.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('emit telemetry events khi polling', async () => {
    const events: any[] = [];
    poller.on('telemetry', (data) => events.push(data));

    poller.start();

    // Wait for at least one poll cycle
    await new Promise((resolve) => setTimeout(resolve, 300));

    poller.stop();

    expect(events.length).toBeGreaterThanOrEqual(2);

    const tempEvent = events.find((e) => e.deviceId === 'PN_TEST_TEMP');
    expect(tempEvent).toBeDefined();
    expect(tempEvent.connectionId).toBe('TEST_PN');
    expect(tempEvent.unit).toBe('°C');
    expect(typeof tempEvent.value).toBe('number');
    expect(tempEvent.value).toBeCloseTo(42.5, 1);
    expect(tempEvent.timestamp).toBeDefined();

    const boolEvent = events.find((e) => e.deviceId === 'PN_TEST_BOOL');
    expect(boolEvent).toBeDefined();
    expect(boolEvent.value).toBe(true);
  });

  it('start/stop idempotent', () => {
    poller.start();
    poller.start(); // should not throw or create double timers
    poller.stop();
    poller.stop(); // should not throw
  });

  it('skip poll khi client chưa kết nối', async () => {
    await client.disconnect();

    const events: any[] = [];
    poller.on('telemetry', (data) => events.push(data));

    poller.start();
    await new Promise((resolve) => setTimeout(resolve, 200));
    poller.stop();

    expect(events.length).toBe(0);
  });
});
