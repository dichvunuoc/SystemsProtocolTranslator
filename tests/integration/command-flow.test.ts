import { describe, it, expect, vi } from 'vitest';
import { CommandHandler, CommandValidationError } from '../../src/command/command-handler.js';
import { OpcuaClient } from '../../src/command/opcua-client.js';
import { buildDeviceIndex, validateDeviceMap } from '../../src/config/device-map.schema.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const rawDeviceMap = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../src/config/device-map.json'), 'utf-8'),
);
const deviceMap = validateDeviceMap(rawDeviceMap);
const allDeviceIndex = buildDeviceIndex(deviceMap);

// Helper: build routeMap từ device-map với mock OpcuaClient
function buildTestHandler(mockClient: OpcuaClient) {
  const routeMap = new Map<string, { connectionId: string; protocol: 'opcua' | 'modbus'; client: OpcuaClient; device: any }>();
  for (const conn of deviceMap.connections) {
    if (conn.protocol === 'opcua') {
      for (const device of conn.commands) {
        routeMap.set(device.deviceId, {
          connectionId: conn.connectionId,
          protocol: 'opcua',
          client: mockClient,
          device,
        });
      }
    }
  }
  return new CommandHandler(routeMap, allDeviceIndex);
}

describe('Command Flow — Integration', () => {
  it('command START cho PUMP_01 gọi writeValue đúng nodeId và value', async () => {
    const mockClient = {
      writeValue: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as OpcuaClient;

    const handler = buildTestHandler(mockClient);
    const result = await handler.handleCommand({
      deviceId: 'PUMP_01',
      action: 'START',
    });

    expect(result.success).toBe(true);
    expect(mockClient.writeValue).toHaveBeenCalledWith(
      'ns=2;s=PUMP_01.Command',
      true,
      'Boolean',
    );
  });

  it('command STOP cho PUMP_02 gọi writeValue với value false', async () => {
    const mockClient = {
      writeValue: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as OpcuaClient;

    const handler = buildTestHandler(mockClient);
    const result = await handler.handleCommand({
      deviceId: 'PUMP_02',
      action: 'STOP',
    });

    expect(result.success).toBe(true);
    expect(mockClient.writeValue).toHaveBeenCalledWith(
      'ns=2;s=PUMP_02.Command',
      false,
      'Boolean',
    );
  });

  it('command cho PUMP_03 (Station B) route đúng', async () => {
    const mockClient = {
      writeValue: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as OpcuaClient;

    const handler = buildTestHandler(mockClient);
    const result = await handler.handleCommand({
      deviceId: 'PUMP_03',
      action: 'START',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('PUMP_03');
    expect(mockClient.writeValue).toHaveBeenCalledWith(
      'ns=2;s=PUMP_03.Command',
      true,
      'Boolean',
    );
  });

  it('command cho device không tồn tại → throw error', async () => {
    const mockClient = {
      writeValue: vi.fn(),
    } as unknown as OpcuaClient;

    const handler = buildTestHandler(mockClient);

    await expect(
      handler.handleCommand({ deviceId: 'UNKNOWN', action: 'START' }),
    ).rejects.toThrow('Device không tồn tại');
  });

  it('command cho telemetry-only device → throw error phân biệt', async () => {
    const mockClient = {
      writeValue: vi.fn(),
    } as unknown as OpcuaClient;

    const handler = buildTestHandler(mockClient);

    await expect(
      handler.handleCommand({ deviceId: 'SENSOR_P_01', action: 'START' }),
    ).rejects.toThrow('telemetry-only');
  });

  it('action không hợp lệ → throw error', async () => {
    const mockClient = {
      writeValue: vi.fn(),
    } as unknown as OpcuaClient;

    const handler = buildTestHandler(mockClient);

    await expect(
      handler.handleCommand({ deviceId: 'PUMP_01', action: 'INVALID' }),
    ).rejects.toThrow('Action không hợp lệ');
  });
});
