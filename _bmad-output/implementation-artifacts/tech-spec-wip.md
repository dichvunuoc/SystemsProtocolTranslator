---
title: 'Profinet IO Protocol Support'
slug: 'profinet-io-protocol-support'
created: '2026-03-18'
status: 'in-progress'
stepsCompleted: [1, 2]
tech_stack: ['TypeScript', 'Node.js 20', 'Vitest', 'tsx', 'pino', 'node-opcua', 'modbus-serial', 'Express', 'ws']
files_to_modify: ['src/config/device-map.schema.ts', 'src/index.ts', 'src/command/command-handler.ts', 'src/transport/rest-server.ts', 'tests/unit/device-map-validation.test.ts', 'tests/unit/device-map.test.ts', 'src/config/device-map.json', 'docker-compose.yml']
code_patterns: ['EventEmitter client with connect/disconnect/isConnected/reconnect', 'Discriminated union on protocol field', 'Manual runtime validation with Vietnamese error messages', 'Telemetry poller (Modbus) vs subscriber (OPC UA)', 'CommandHandler route map deviceId → {connectionId, protocol, client, device}']
test_patterns: ['Vitest', 'describe/it blocks', 'makeValidConfig() helper', 'error message regex matching', 'one-property-at-a-time mutation tests']
---

# Tech-Spec: Profinet IO Protocol Support

**Created:** 2026-03-18

## Overview

### Problem Statement

Hệ thống Protocol Translator hiện chỉ hỗ trợ Modbus và OPC UA. Cần mở rộng thêm giao thức Profinet IO để kết nối với các thiết bị công nghiệp dùng Profinet (Siemens S7, IO modules, drives...).

### Solution

Thêm Profinet IO protocol vào hệ thống theo pattern hiện có — bao gồm: config schema/types/validation, Profinet IO client implementation (cyclic data read/write), telemetry + command support, và mock server cho development/testing.

### Scope

**In Scope:**
- Profinet IO connection config (IP, slot/subslot/index addressing theo chuẩn Profinet IO)
- TypeScript interfaces: `ProfinetConnection`, `ProfinetTelemetryDevice`, `ProfinetCommandDevice`
- Validation functions cho Profinet config
- Profinet IO client implementation (connect, read cyclic data, write output)
- Telemetry poller cho Profinet (cyclic polling model, giống Modbus)
- Command routing cho Profinet devices
- Mock server/data cho development & testing
- Tích hợp vào `index.ts` main loop (giống Modbus/OPC UA)

**Out of Scope:**
- Profinet CBA, DCP, LLDP (chỉ Profinet IO)
- Profinet RT/IRT certification
- GSD file parsing
- Web UI changes

## Context for Development

### Codebase Patterns

- **Client pattern:** Mỗi protocol client extends `EventEmitter`, expose `connect()`, `disconnect()`, `isConnected()`, exponential backoff reconnect với `ReconnectConfig { baseMs, maxMs }`. Emit events: `'connected'`, `'disconnected'`. State tracking: `connected`, `reconnecting`, `shouldReconnect`.
- **Telemetry:** Modbus dùng polling model (`TelemetryPoller` — setInterval + batch read), OPC UA dùng subscription model (`OpcuaTelemetrySubscriber`). Cả hai emit `'telemetry'` event với format `{ connectionId, deviceId, value, unit, description, timestamp }`.
- **Command:** `CommandHandler` nhận route map `Map<deviceId, CommandRouteEntry>`. Entry chứa `{ connectionId, protocol, client, device }`. Action mapping: `mapActionToValue(action, dataType)`. Hiện chỉ support Boolean (START/STOP).
- **Validation:** Manual runtime validation trong `device-map.schema.ts`. Mỗi protocol có riêng validate functions. Error messages bằng tiếng Việt. Discriminated union `ConnectionConfig` trên field `protocol`.
- **Config loading:** `device-map.json` → `validateDeviceMap()` → typed `DeviceMap`. `buildDeviceIndex()` tạo lookup map.
- **Safety patterns:** F2 (listener stack prevention), F5 (NaN guard), F6 (forced exit timer), F13 (reconnect config copy per client).

### Files to Reference

| File | Purpose |
| ---- | ------- |
| `src/config/device-map.schema.ts` | Types, interfaces, validation — thêm Profinet types + validators |
| `src/index.ts` | Main loop — thêm Profinet branch |
| `src/command/command-handler.ts` | Command routing — mở rộng cho Profinet |
| `src/command/opcua-client.ts` | Reference: OPC UA client pattern |
| `src/telemetry/modbus-client.ts` | Reference: Modbus client pattern (gần nhất với Profinet) |
| `src/telemetry/telemetry-poller.ts` | Reference: Polling telemetry model |
| `src/telemetry/opcua-telemetry-subscriber.ts` | Reference: Subscriber telemetry model |
| `src/transport/rest-server.ts` | REST server — update ConnectionStatus protocol union |
| `src/transport/ws-server.ts` | WebSocket — không cần sửa (generic telemetry sources) |
| `src/config/gateway.config.ts` | Gateway config — reconnect settings |
| `tests/unit/device-map-validation.test.ts` | Validation tests — thêm Profinet test cases |
| `tests/unit/device-map.test.ts` | Schema tests — thêm Profinet examples |
| `docker-compose.yml` | Docker — thêm profinet-mock service |

### Technical Decisions

- **Addressing:** Profinet IO chuẩn — dùng `slot`, `subslot`, `index` cho cyclic data addressing
- **Telemetry model:** Polling (giống Modbus) — Profinet IO cyclic data được đọc theo interval
- **Command model:** Write output data qua slot/subslot/index addressing
- **Data types:** Hỗ trợ Profinet IO data types: `Float32`, `UInt16`, `UInt32`, `Int16`, `Int32`, `Boolean`
- **Mock server:** Node.js mock simulate Profinet IO device với random sensor data

## Implementation Plan

### Tasks

### Acceptance Criteria

## Additional Context

### Dependencies

### Testing Strategy

### Notes
