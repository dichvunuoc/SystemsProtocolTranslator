import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { validateDeviceMap, buildDeviceIndex } from '../../src/config/device-map.schema.js';

const deviceMap = JSON.parse(
  readFileSync(resolve(import.meta.dirname, '../../src/config/device-map.json'), 'utf-8'),
);

describe('device-map.json', () => {
  it('có 3 connections (2 OPC UA + 1 Profinet)', () => {
    expect(deviceMap.connections).toHaveLength(3);
    const opcua = deviceMap.connections.filter((c: any) => c.protocol === 'opcua');
    expect(opcua).toHaveLength(2);
    const profinet = deviceMap.connections.filter((c: any) => c.protocol === 'profinet');
    expect(profinet).toHaveLength(1);
  });

  it('mỗi connection có connectionId, protocol, và ít nhất telemetry hoặc commands', () => {
    for (const conn of deviceMap.connections) {
      expect(conn).toHaveProperty('connectionId');
      expect(conn).toHaveProperty('protocol');
      const hasTelemetry = Array.isArray(conn.telemetry) && conn.telemetry.length > 0;
      const hasCommands = Array.isArray(conn.commands) && conn.commands.length > 0;
      expect(hasTelemetry || hasCommands).toBe(true);
    }
  });

  it('OPC UA connections có endpoint', () => {
    const opcuaConns = deviceMap.connections.filter((c: any) => c.protocol === 'opcua');
    for (const conn of opcuaConns) {
      expect(conn).toHaveProperty('endpoint');
    }
  });

  it('deviceId unique across ALL connections (telemetry + commands)', () => {
    const allDeviceIds: string[] = [];
    for (const conn of deviceMap.connections) {
      if (conn.telemetry) {
        for (const device of conn.telemetry) {
          allDeviceIds.push(device.deviceId);
        }
      }
      if (conn.commands) {
        for (const device of conn.commands) {
          allDeviceIds.push(device.deviceId);
        }
      }
    }
    const unique = new Set(allDeviceIds);
    expect(unique.size).toBe(allDeviceIds.length);
  });

  it('lookup PUMP_01 tìm đúng connection STATION_A trong commands', () => {
    const conn = deviceMap.connections.find((c: any) =>
      c.commands?.some((d: any) => d.deviceId === 'PUMP_01'),
    );
    expect(conn).toBeDefined();
    expect(conn.connectionId).toBe('STATION_A');
    expect(conn.protocol).toBe('opcua');
    const pump01 = conn.commands.find((d: any) => d.deviceId === 'PUMP_01');
    expect(pump01.nodeId).toBe('ns=2;s=PUMP_01.Command');
  });

  it('lookup SENSOR_P_03 tìm đúng connection STATION_B trong telemetry', () => {
    const conn = deviceMap.connections.find((c: any) =>
      c.telemetry?.some((d: any) => d.deviceId === 'SENSOR_P_03'),
    );
    expect(conn).toBeDefined();
    expect(conn.connectionId).toBe('STATION_B');
    expect(conn.protocol).toBe('opcua');
  });

  it('STATION_A có cả telemetry và commands (unified)', () => {
    const stationA = deviceMap.connections.find((c: any) => c.connectionId === 'STATION_A');
    expect(stationA).toBeDefined();
    expect(stationA.telemetry.length).toBeGreaterThan(0);
    expect(stationA.commands.length).toBeGreaterThan(0);
  });

  it('Profinet connection has correct properties', () => {
    const pnConn = deviceMap.connections.find((c: any) => c.connectionId === 'PROFINET_STATION_A');
    expect(pnConn).toBeDefined();
    expect(pnConn.protocol).toBe('profinet');
    expect(pnConn.host).toBe('profinet-mock-a');
    expect(pnConn.port).toBe(34964);
    expect(pnConn.deviceName).toBe('s7-1500-station-a');
    expect(pnConn.pollIntervalMs).toBe(500);
  });

  it('Profinet telemetry devices accessible via buildDeviceIndex', () => {
    const validated = validateDeviceMap(deviceMap);
    const index = buildDeviceIndex(validated);
    const pnTemp = index.get('PN_TEMP_01');
    expect(pnTemp).toBeDefined();
    expect(pnTemp!.connectionId).toBe('PROFINET_STATION_A');
    expect(pnTemp!.protocol).toBe('profinet');
    expect(pnTemp!.role).toBe('telemetry');
  });

  it('Profinet command devices accessible via buildDeviceIndex', () => {
    const validated = validateDeviceMap(deviceMap);
    const index = buildDeviceIndex(validated);
    const pnValve = index.get('PN_VALVE_01');
    expect(pnValve).toBeDefined();
    expect(pnValve!.connectionId).toBe('PROFINET_STATION_A');
    expect(pnValve!.protocol).toBe('profinet');
    expect(pnValve!.role).toBe('command');
  });

  it('lookup PN_TEMP_01 → PROFINET_STATION_A', () => {
    const conn = deviceMap.connections.find((c: any) =>
      c.telemetry?.some((d: any) => d.deviceId === 'PN_TEMP_01'),
    );
    expect(conn).toBeDefined();
    expect(conn.connectionId).toBe('PROFINET_STATION_A');
    expect(conn.protocol).toBe('profinet');
  });
});
