import { describe, it, expect, vi } from 'vitest';
import { EventEmitter } from 'events';
import { TelemetryPoller, type ModbusDevice } from '../../src/telemetry/telemetry-poller.js';
import { OpcuaTelemetrySubscriber } from '../../src/telemetry/opcua-telemetry-subscriber.js';
import { ModbusClient } from '../../src/telemetry/modbus-client.js';
import { OpcuaClient } from '../../src/command/opcua-client.js';
import type { OpcuaTelemetryDevice } from '../../src/config/device-map.schema.js';

describe('Telemetry Flow — Modbus Polling', () => {
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

  it('poll cycle phát ra telemetry events với connectionId', async () => {
    // Float32 5.0 = 0x40A00000 → registers [0x40A0, 0x0000]
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

    const poller = new TelemetryPoller('TEST_STATION', mockModbus, testDevices, 100);

    const received: any[] = [];
    poller.on('telemetry', (data) => received.push(data));

    await (poller as any).poll();

    expect(received).toHaveLength(2);

    // Kiểm tra SENSOR_P_01
    const pressure = received.find((d) => d.deviceId === 'SENSOR_P_01');
    expect(pressure).toBeDefined();
    expect(pressure.connectionId).toBe('TEST_STATION');
    expect(pressure.value).toBeCloseTo(5.0);
    expect(pressure.unit).toBe('bar');
    expect(pressure.timestamp).toBeDefined();

    // Kiểm tra PUMP_01_STATUS
    const pumpStatus = received.find((d) => d.deviceId === 'PUMP_01_STATUS');
    expect(pumpStatus).toBeDefined();
    expect(pumpStatus.connectionId).toBe('TEST_STATION');
    expect(pumpStatus.value).toBe(1);
  });

  it('poll bỏ qua khi Modbus chưa kết nối', async () => {
    const mockModbus = {
      readHoldingRegisters: vi.fn(),
      isConnected: vi.fn().mockReturnValue(false),
    } as unknown as ModbusClient;

    const poller = new TelemetryPoller('TEST_STATION', mockModbus, testDevices, 100);

    const received: any[] = [];
    poller.on('telemetry', (data) => received.push(data));

    await (poller as any).poll();

    expect(received).toHaveLength(0);
    expect(mockModbus.readHoldingRegisters).not.toHaveBeenCalled();
  });

  it('poll cycle parse đúng CD_AB word order', async () => {
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

    const poller = new TelemetryPoller('TEST_STATION', mockModbus, cdAbDevices, 100);
    const received: any[] = [];
    poller.on('telemetry', (data) => received.push(data));

    await (poller as any).poll();

    expect(received).toHaveLength(1);
    expect(received[0].deviceId).toBe('SENSOR_P_02');
    expect(received[0].connectionId).toBe('TEST_STATION');
    expect(received[0].value).toBeCloseTo(123.456, 2);
  });

  it('poll không crash khi read thất bại', async () => {
    const mockModbus = {
      readHoldingRegisters: vi.fn().mockRejectedValue(new Error('Connection lost')),
      isConnected: vi.fn().mockReturnValue(true),
    } as unknown as ModbusClient;

    const poller = new TelemetryPoller('TEST_STATION', mockModbus, testDevices, 100);

    await expect((poller as any).poll()).resolves.toBeUndefined();
  });
});

describe('Telemetry Flow — OPC UA Subscription', () => {
  const testDevices: OpcuaTelemetryDevice[] = [
    {
      deviceId: 'SENSOR_P_01',
      nodeId: 'ns=2;s=SENSOR_P_01.Value',
      dataType: 'Double',
      unit: 'bar',
      description: 'Inlet pressure',
    },
    {
      deviceId: 'SENSOR_F_01',
      nodeId: 'ns=2;s=SENSOR_F_01.Value',
      dataType: 'Double',
      unit: 'm3/h',
      description: 'Flow rate',
    },
  ];

  it('khi monitored item emit changed → subscriber emit telemetry với đúng format', async () => {
    // Mock monitored items as EventEmitters
    const monitoredItem1 = new EventEmitter();
    const monitoredItem2 = new EventEmitter();
    const mockSubscription = { terminate: vi.fn().mockResolvedValue(undefined) };

    const mockOpcuaClient = {
      createSubscription: vi.fn().mockResolvedValue(mockSubscription),
      monitorItem: vi.fn()
        .mockResolvedValueOnce(monitoredItem1)
        .mockResolvedValueOnce(monitoredItem2),
    } as unknown as OpcuaClient;

    const subscriber = new OpcuaTelemetrySubscriber('TEST_STATION', mockOpcuaClient, testDevices);

    const received: any[] = [];
    subscriber.on('telemetry', (data) => received.push(data));

    await subscriber.start();

    // Simulate value changes
    monitoredItem1.emit('changed', { value: { value: 2.5 } });
    monitoredItem2.emit('changed', { value: { value: 35.2 } });

    expect(received).toHaveLength(2);

    const pressure = received.find((d) => d.deviceId === 'SENSOR_P_01');
    expect(pressure).toBeDefined();
    expect(pressure.connectionId).toBe('TEST_STATION');
    expect(pressure.value).toBeCloseTo(2.5);
    expect(pressure.unit).toBe('bar');
    expect(pressure.timestamp).toBeDefined();

    const flow = received.find((d) => d.deviceId === 'SENSOR_F_01');
    expect(flow).toBeDefined();
    expect(flow.value).toBeCloseTo(35.2);
    expect(flow.unit).toBe('m3/h');
  });

  it('subscriber stop → subscription terminated', async () => {
    const mockSubscription = { terminate: vi.fn().mockResolvedValue(undefined) };

    const mockOpcuaClient = {
      createSubscription: vi.fn().mockResolvedValue(mockSubscription),
      monitorItem: vi.fn().mockResolvedValue(new EventEmitter()),
    } as unknown as OpcuaClient;

    const subscriber = new OpcuaTelemetrySubscriber('TEST_STATION', mockOpcuaClient, testDevices);

    await subscriber.start();
    await subscriber.stop();

    expect(mockSubscription.terminate).toHaveBeenCalled();
  });

  it('subscriber bỏ qua giá trị null/undefined', async () => {
    const monitoredItem = new EventEmitter();
    const mockSubscription = { terminate: vi.fn().mockResolvedValue(undefined) };

    const mockOpcuaClient = {
      createSubscription: vi.fn().mockResolvedValue(mockSubscription),
      monitorItem: vi.fn().mockResolvedValue(monitoredItem),
    } as unknown as OpcuaClient;

    const subscriber = new OpcuaTelemetrySubscriber(
      'TEST_STATION',
      mockOpcuaClient,
      [testDevices[0]],
    );

    const received: any[] = [];
    subscriber.on('telemetry', (data) => received.push(data));

    await subscriber.start();

    // Emit null value — should be ignored
    monitoredItem.emit('changed', { value: { value: null } });
    monitoredItem.emit('changed', { value: { value: undefined } });

    expect(received).toHaveLength(0);

    // Emit valid value — should be captured
    monitoredItem.emit('changed', { value: { value: 3.14 } });
    expect(received).toHaveLength(1);
  });
});
