import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as net from 'net';
import { ProfinetClient } from '../../src/telemetry/profinet-client.js';

const TEST_PORT = 39800 + Math.floor(Math.random() * 100);
const OP_READ = 0x01;
const OP_WRITE = 0x02;

function createMockServer(port: number): net.Server {
  const server = net.createServer((socket) => {
    socket.on('data', (data) => {
      const opcode = data.readUInt8(0);
      const length = data.readUInt16BE(7);

      if (opcode === OP_READ) {
        // Return status OK + random data
        const resp = Buffer.alloc(1 + length);
        resp.writeUInt8(0, 0); // status OK
        // Write a known float value for testing
        if (length >= 4) {
          resp.writeFloatBE(42.5, 1);
        } else if (length >= 1) {
          resp.writeUInt8(1, 1);
        }
        socket.write(resp);
      } else if (opcode === OP_WRITE) {
        socket.write(Buffer.from([0x00])); // status OK
      }
    });
  });
  return server;
}

describe('ProfinetClient', () => {
  let server: net.Server;
  let client: ProfinetClient;

  beforeEach(async () => {
    server = createMockServer(TEST_PORT);
    await new Promise<void>((resolve) => server.listen(TEST_PORT, resolve));
    client = new ProfinetClient('TEST_PN', 'localhost', TEST_PORT, 'test-device', { baseMs: 100, maxMs: 1000 });
  });

  afterEach(async () => {
    await client.disconnect();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('connect thành công → emit connected + isConnected = true', async () => {
    const events: string[] = [];
    client.on('connected', () => events.push('connected'));

    await client.connect();

    expect(client.isConnected()).toBe(true);
    expect(events).toContain('connected');
  });

  it('connect thất bại → throw error', async () => {
    const badClient = new ProfinetClient('BAD', 'localhost', 1, undefined, { baseMs: 100, maxMs: 200 });
    await expect(badClient.connect()).rejects.toThrow();
    expect(badClient.isConnected()).toBe(false);
    await badClient.disconnect();
  });

  it('readData trả về buffer đúng length', async () => {
    await client.connect();
    const buffer = await client.readData(1, 1, 0, 4);
    expect(buffer).toBeInstanceOf(Buffer);
    expect(buffer.length).toBe(4);
    expect(buffer.readFloatBE(0)).toBeCloseTo(42.5, 1);
  });

  it('readData khi chưa kết nối → throw', async () => {
    await expect(client.readData(1, 1, 0, 4)).rejects.toThrowError(/chưa kết nối/);
  });

  it('writeData thành công', async () => {
    await client.connect();
    const data = Buffer.alloc(1);
    data.writeUInt8(1, 0);
    await expect(client.writeData(2, 1, 0, data)).resolves.toBeUndefined();
  });

  it('writeData khi chưa kết nối → throw', async () => {
    const data = Buffer.alloc(1);
    await expect(client.writeData(2, 1, 0, data)).rejects.toThrowError(/chưa kết nối/);
  });

  it('serializes concurrent requests correctly', async () => {
    await client.connect();
    // Fire 3 reads concurrently — they should all resolve correctly
    const results = await Promise.all([
      client.readData(1, 1, 0, 4),
      client.readData(1, 1, 4, 4),
      client.readData(1, 1, 0, 1),
    ]);
    expect(results[0].length).toBe(4);
    expect(results[1].length).toBe(4);
    expect(results[2].length).toBe(1);
  });

  it('disconnect → isConnected = false + emit disconnected', async () => {
    await client.connect();
    expect(client.isConnected()).toBe(true);

    const events: string[] = [];
    client.on('disconnected', () => events.push('disconnected'));

    await client.disconnect();
    expect(client.isConnected()).toBe(false);
    expect(events).toContain('disconnected');
  });

  it('getConnectionId trả về đúng', () => {
    expect(client.getConnectionId()).toBe('TEST_PN');
  });
});
