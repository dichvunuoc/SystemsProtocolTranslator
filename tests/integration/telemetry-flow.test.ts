import { describe, it, expect, vi } from 'vitest';
import { TelemetryPoller, type ModbusDevice } from '../../src/telemetry/telemetry-poller.js';
import { ModbusClient } from '../../src/telemetry/modbus-client.js';

describe('Telemetry Flow — Integration', () => {
  const testDevices: ModbusDevice[] = [
    {
      deviceId: 'SENSOR_P_01',
      register: 0,
      length: 2,
      dataType: 'Float32',
      wordOrder: 'AB_CD',
      unit: 'bar',
      description: 'Inlet pressure',
    },
    {
      deviceId: 'PUMP_01_STATUS',
      register: 8,
      length: 1,
      dataType: 'UInt16',
      wordOrder: 'AB_CD',
      unit: '',
      description: 'Pump 1 status',
    },
  ];

  it('poll cycle phát ra telemetry events với đúng format', async () => {
    // Float32 5.0 = 0x40A00000 → registers [0x40A0, 0x0000]
    // Cần trả về 10 registers (0 đến 9) vì batch read range
    const mockRegisters = [
      0x40a0, 0x0000, // reg 0-1: pressure
      0, 0,           // reg 2-3
      0, 0,           // reg 4-5
      0, 0,           // reg 6-7
      1,              // reg 8: pump status
    ];

    const mockModbus = {
      readHoldingRegisters: vi.fn().mockResolvedValue(mockRegisters),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as ModbusClient;

    const poller = new TelemetryPoller(mockModbus, testDevices, 100);

    const received: any[] = [];
    poller.on('telemetry', (data) => received.push(data));

    // Trigger poll thủ công
    await (poller as any).poll();

    expect(received).toHaveLength(2);

    // Kiểm tra SENSOR_P_01
    const pressure = received.find((d) => d.deviceId === 'SENSOR_P_01');
    expect(pressure).toBeDefined();
    expect(pressure.value).toBeCloseTo(5.0);
    expect(pressure.unit).toBe('bar');
    expect(pressure.timestamp).toBeDefined();

    // Kiểm tra PUMP_01_STATUS
    const pumpStatus = received.find((d) => d.deviceId === 'PUMP_01_STATUS');
    expect(pumpStatus).toBeDefined();
    expect(pumpStatus.value).toBe(1);
  });

  it('poll bỏ qua khi Modbus chưa kết nối', async () => {
    const mockModbus = {
      readHoldingRegisters: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
    } as unknown as ModbusClient;

    const poller = new TelemetryPoller(mockModbus, testDevices, 100);

    const received: any[] = [];
    poller.on('telemetry', (data) => received.push(data));

    await (poller as any).poll();

    expect(received).toHaveLength(0);
    expect(mockModbus.readHoldingRegisters).not.toHaveBeenCalled();
  });

  it('poll cycle parse đúng CD_AB word order', async () => {
    // Test với device dùng CD_AB (SENSOR_P_02)
    // 123.456 ≈ 0x42F6E979 → CD_AB: input [0xE979, 0x42F6]
    const cdAbDevices: ModbusDevice[] = [
      {
        deviceId: 'SENSOR_P_02',
        register: 0,
        length: 2,
        dataType: 'Float32',
        wordOrder: 'CD_AB',
        unit: 'bar',
        description: 'Outlet pressure',
      },
    ];

    const mockRegisters = [0xe979, 0x42f6];
    const mockModbus = {
      readHoldingRegisters: vi.fn().mockResolvedValue(mockRegisters),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as ModbusClient;

    const poller = new TelemetryPoller(mockModbus, cdAbDevices, 100);
    const received: any[] = [];
    poller.on('telemetry', (data) => received.push(data));

    await (poller as any).poll();

    expect(received).toHaveLength(1);
    expect(received[0].deviceId).toBe('SENSOR_P_02');
    expect(received[0].value).toBeCloseTo(123.456, 2);
  });

  it('poll không crash khi read thất bại', async () => {
    const mockModbus = {
      readHoldingRegisters: vi.fn().mockRejectedValue(new Error('Connection lost')),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as ModbusClient;

    const poller = new TelemetryPoller(mockModbus, testDevices, 100);

    // Không throw error
    await expect((poller as any).poll()).resolves.toBeUndefined();
  });
});
