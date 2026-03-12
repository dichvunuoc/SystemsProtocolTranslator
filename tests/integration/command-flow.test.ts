import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { CommandHandler } from '../../src/command/command-handler.js';
import { OpcuaClient } from '../../src/command/opcua-client.js';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const deviceMap = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../src/config/device-map.json'), 'utf-8'),
);

describe('Command Flow — Integration', () => {
  it('command START cho PUMP_01 gọi writeValue đúng nodeId và value', async () => {
    // Mock OpcuaClient
    const mockOpcuaClient = {
      writeValue: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as OpcuaClient;

    const handler = new CommandHandler(mockOpcuaClient, deviceMap.opcua.devices);
    const result = await handler.handleCommand({
      deviceId: 'PUMP_01',
      action: 'START',
    });

    expect(result.success).toBe(true);
    expect(mockOpcuaClient.writeValue).toHaveBeenCalledWith(
      'ns=2;s=PUMP_01.Command',
      true,
      'Boolean',
    );
  });

  it('command STOP cho PUMP_02 gọi writeValue với value false', async () => {
    const mockOpcuaClient = {
      writeValue: vi.fn().mockResolvedValue(undefined),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as OpcuaClient;

    const handler = new CommandHandler(mockOpcuaClient, deviceMap.opcua.devices);
    const result = await handler.handleCommand({
      deviceId: 'PUMP_02',
      action: 'STOP',
    });

    expect(result.success).toBe(true);
    expect(mockOpcuaClient.writeValue).toHaveBeenCalledWith(
      'ns=2;s=PUMP_02.Command',
      false,
      'Boolean',
    );
  });

  it('command cho device không tồn tại → throw error', async () => {
    const mockOpcuaClient = {
      writeValue: vi.fn(),
    } as unknown as OpcuaClient;

    const handler = new CommandHandler(mockOpcuaClient, deviceMap.opcua.devices);

    await expect(
      handler.handleCommand({ deviceId: 'UNKNOWN', action: 'START' }),
    ).rejects.toThrow('Device không tồn tại');
  });

  it('action không hợp lệ → throw error', async () => {
    const mockOpcuaClient = {
      writeValue: vi.fn(),
    } as unknown as OpcuaClient;

    const handler = new CommandHandler(mockOpcuaClient, deviceMap.opcua.devices);

    await expect(
      handler.handleCommand({ deviceId: 'PUMP_01', action: 'INVALID' }),
    ).rejects.toThrow('Action không hợp lệ');
  });
});
