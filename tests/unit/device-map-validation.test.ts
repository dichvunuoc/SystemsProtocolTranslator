import { describe, it, expect } from 'vitest';
import { validateDeviceMap, buildDeviceIndex } from '../../src/config/device-map.schema.js';

// Helper: tạo valid config cho test
function makeValidConfig() {
  return {
    connections: [
      {
        connectionId: 'CONN_A',
        protocol: 'modbus',
        description: 'Test modbus',
        host: 'localhost',
        port: 502,
        unitId: 1,
        pollIntervalMs: 1000,
        telemetry: [
          { deviceId: 'DEV_01', register: 0, length: 2, dataType: 'Float32', wordOrder: 'AB_CD', unit: 'bar', description: 'Test' },
        ],
        commands: [],
      },
      {
        connectionId: 'CONN_B',
        protocol: 'opcua',
        description: 'Test opcua',
        endpoint: 'opc.tcp://localhost:4840',
        telemetry: [],
        commands: [
          { deviceId: 'DEV_02', nodeId: 'ns=2;s=DEV_02.Command', dataType: 'Boolean', description: 'Test' },
        ],
      },
    ],
  };
}

describe('validateDeviceMap', () => {
  it('happy path: valid config trả về DeviceMap', () => {
    const result = validateDeviceMap(makeValidConfig());
    expect(result.connections).toHaveLength(2);
  });

  it('connection chỉ có telemetry (không commands) → valid', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'Telemetry only',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [
            { deviceId: 'SENSOR_01', nodeId: 'ns=2;s=SENSOR_01', dataType: 'Double', unit: 'bar', description: 'Test' },
          ],
          commands: [],
        },
      ],
    };
    const result = validateDeviceMap(config);
    expect(result.connections).toHaveLength(1);
  });

  it('connection chỉ có commands (không telemetry) → valid', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'Command only',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [],
          commands: [
            { deviceId: 'PUMP_01', nodeId: 'ns=2;s=PUMP_01', dataType: 'Boolean', description: 'Test' },
          ],
        },
      ],
    };
    const result = validateDeviceMap(config);
    expect(result.connections).toHaveLength(1);
  });

  it('connection không có cả telemetry lẫn commands → invalid', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'Empty',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [],
          commands: [],
        },
      ],
    };
    expect(() => validateDeviceMap(config)).toThrowError(/ít nhất 1 telemetry hoặc command/);
  });

  it('connection không có telemetry và commands arrays → invalid', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'No arrays',
          endpoint: 'opc.tcp://localhost:4840',
        },
      ],
    };
    expect(() => validateDeviceMap(config)).toThrowError(/ít nhất 1 telemetry hoặc command/);
  });

  it('throw error khi deviceId trùng across connections', () => {
    const config = makeValidConfig();
    config.connections[1].commands[0].deviceId = 'DEV_01';
    expect(() => validateDeviceMap(config)).toThrowError(
      /deviceId trùng.*DEV_01.*CONN_A.*CONN_B/,
    );
  });

  it('throw error khi deviceId trùng across telemetry và commands', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'Mixed',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [
            { deviceId: 'SAME_ID', nodeId: 'ns=2;s=SAME_ID', dataType: 'Double', unit: '', description: 'Tel' },
          ],
          commands: [],
        },
        {
          connectionId: 'CONN_B',
          protocol: 'opcua',
          description: 'Mixed 2',
          endpoint: 'opc.tcp://localhost:4841',
          telemetry: [],
          commands: [
            { deviceId: 'SAME_ID', nodeId: 'ns=2;s=SAME_ID', dataType: 'Boolean', description: 'Cmd' },
          ],
        },
      ],
    };
    expect(() => validateDeviceMap(config)).toThrowError(/deviceId trùng.*SAME_ID/);
  });

  it('throw error khi Modbus connection thiếu host', () => {
    const config = makeValidConfig();
    delete (config.connections[0] as any).host;
    expect(() => validateDeviceMap(config)).toThrowError(/thiếu host/);
  });

  it('throw error khi OPC UA connection thiếu endpoint', () => {
    const config = makeValidConfig();
    delete (config.connections[1] as any).endpoint;
    expect(() => validateDeviceMap(config)).toThrowError(/thiếu endpoint/);
  });

  it('throw error khi OPC UA telemetry device thiếu nodeId', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'Test',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [
            { deviceId: 'SENSOR_01', dataType: 'Double', unit: 'bar', description: 'Test' },
          ],
          commands: [],
        },
      ],
    };
    expect(() => validateDeviceMap(config)).toThrowError(/thiếu nodeId/);
  });

  it('throw error khi OPC UA telemetry device thiếu unit', () => {
    const config = {
      connections: [
        {
          connectionId: 'CONN_A',
          protocol: 'opcua',
          description: 'Test',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [
            { deviceId: 'SENSOR_01', nodeId: 'ns=2;s=S', dataType: 'Double', description: 'Test' },
          ],
          commands: [],
        },
      ],
    };
    expect(() => validateDeviceMap(config)).toThrowError(/thiếu unit/);
  });

  it('throw error khi protocol không hợp lệ', () => {
    const config = makeValidConfig();
    (config.connections[0] as any).protocol = 'mqtt';
    expect(() => validateDeviceMap(config)).toThrowError(/Protocol không hợp lệ.*mqtt/);
  });

  it('throw error khi connections rỗng', () => {
    expect(() => validateDeviceMap({ connections: [] })).toThrowError(/không rỗng/);
  });

  it('throw error khi connectionId trùng', () => {
    const config = makeValidConfig();
    config.connections[1].connectionId = 'CONN_A';
    expect(() => validateDeviceMap(config)).toThrowError(/connectionId trùng.*CONN_A/);
  });

  it('Modbus connection có telemetry nhưng thiếu pollIntervalMs → invalid', () => {
    const config = makeValidConfig();
    delete (config.connections[0] as any).pollIntervalMs;
    expect(() => validateDeviceMap(config)).toThrowError(/thiếu pollIntervalMs/);
  });

  it('mixed protocols trong cùng device-map → valid', () => {
    const config = {
      connections: [
        {
          connectionId: 'MODBUS_CONN',
          protocol: 'modbus',
          description: 'Modbus',
          host: 'localhost',
          port: 502,
          unitId: 1,
          pollIntervalMs: 1000,
          telemetry: [
            { deviceId: 'MB_SENSOR', register: 0, length: 2, dataType: 'Float32', wordOrder: 'AB_CD', unit: 'bar', description: 'Test' },
          ],
          commands: [],
        },
        {
          connectionId: 'OPCUA_CONN',
          protocol: 'opcua',
          description: 'OPC UA',
          endpoint: 'opc.tcp://localhost:4840',
          telemetry: [
            { deviceId: 'OPC_SENSOR', nodeId: 'ns=2;s=OPC_SENSOR', dataType: 'Double', unit: 'bar', description: 'Test' },
          ],
          commands: [
            { deviceId: 'OPC_PUMP', nodeId: 'ns=2;s=OPC_PUMP', dataType: 'Boolean', description: 'Test' },
          ],
        },
      ],
    };
    const result = validateDeviceMap(config);
    expect(result.connections).toHaveLength(2);
  });
});

describe('buildDeviceIndex', () => {
  it('build index đúng với role telemetry và command', () => {
    const deviceMap = validateDeviceMap(makeValidConfig());
    const index = buildDeviceIndex(deviceMap);
    expect(index.size).toBe(2);
    expect(index.get('DEV_01')).toEqual({ connectionId: 'CONN_A', protocol: 'modbus', role: 'telemetry' });
    expect(index.get('DEV_02')).toEqual({ connectionId: 'CONN_B', protocol: 'opcua', role: 'command' });
  });
});
