import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const deviceMap = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../src/config/device-map.json'), 'utf-8'),
);

describe('device-map.json', () => {
  it('có 2 OPC UA devices', () => {
    expect(deviceMap.opcua.devices).toHaveLength(2);
  });

  it('có 6 Modbus devices', () => {
    expect(deviceMap.modbus.devices).toHaveLength(6);
  });

  it('mỗi OPC UA device có đủ các trường bắt buộc', () => {
    for (const device of deviceMap.opcua.devices) {
      expect(device).toHaveProperty('deviceId');
      expect(device).toHaveProperty('nodeId');
      expect(device).toHaveProperty('dataType');
      expect(device).toHaveProperty('description');
    }
  });

  it('mỗi Modbus device có đủ các trường bắt buộc', () => {
    for (const device of deviceMap.modbus.devices) {
      expect(device).toHaveProperty('deviceId');
      expect(device).toHaveProperty('register');
      expect(device).toHaveProperty('length');
      expect(device).toHaveProperty('dataType');
      expect(device).toHaveProperty('wordOrder');
      expect(device).toHaveProperty('unit');
      expect(device).toHaveProperty('description');
    }
  });

  it('lookup PUMP_01 trả về đúng nodeId', () => {
    const pump01 = deviceMap.opcua.devices.find(
      (d: any) => d.deviceId === 'PUMP_01',
    );
    expect(pump01).toBeDefined();
    expect(pump01.nodeId).toBe('ns=2;s=PUMP_01.Command');
    expect(pump01.dataType).toBe('Boolean');
  });

  it('lookup SENSOR_P_02 có wordOrder CD_AB', () => {
    const sensor = deviceMap.modbus.devices.find(
      (d: any) => d.deviceId === 'SENSOR_P_02',
    );
    expect(sensor).toBeDefined();
    expect(sensor.wordOrder).toBe('CD_AB');
    expect(sensor.register).toBe(2);
  });

  it('không có register address bị trùng', () => {
    const addresses = deviceMap.modbus.devices.map((d: any) => d.register);
    const unique = new Set(addresses);
    expect(unique.size).toBe(addresses.length);
  });
});
