---
title: 'Profinet IO Protocol Support'
slug: 'profinet-io-protocol-support'
created: '2026-03-18'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
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

- [x] Task 1: Thêm Profinet IO types và interfaces vào `device-map.schema.ts`
  - File: `src/config/device-map.schema.ts`
  - Action: Thêm các interfaces mới ngay sau OPC UA interfaces hiện có
    - `ProfinetTelemetryDevice { deviceId, slot, subslot, index, length, dataType, unit, description }` — `dataType`: `'Float32' | 'UInt16' | 'UInt32' | 'Int16' | 'Int32' | 'Boolean'`
    - `ProfinetCommandDevice { deviceId, slot, subslot, index, length, dataType, description }` — `dataType`: `'Float32' | 'UInt16' | 'UInt32' | 'Int16' | 'Int32' | 'Boolean'`
    - `ProfinetConnection { connectionId, protocol: 'profinet', description, host, port, deviceName?, pollIntervalMs, telemetry: ProfinetTelemetryDevice[], commands: ProfinetCommandDevice[] }`
    - Update `ConnectionConfig` union: `ModbusConnection | OpcuaConnection | ProfinetConnection`
  - Notes: `slot` (number), `subslot` (number), `index` (number) theo chuẩn Profinet IO addressing. `length` là số bytes cần đọc/ghi. `port` default 34964 (Profinet IO default UDP port). `deviceName` là tên thiết bị Profinet (optional, dùng cho DCP discovery).

- [x] Task 2: Thêm Profinet validation functions vào `device-map.schema.ts`
  - File: `src/config/device-map.schema.ts`
  - Action: Thêm validation functions theo pattern hiện có
    - `validateProfinetTelemetryDevice(device, connectionId): ProfinetTelemetryDevice` — validate: deviceId (string, non-empty), slot (number >= 0), subslot (number >= 0), index (number >= 0), length (number > 0), dataType (in allowed list), unit (string), description (string)
    - `validateProfinetCommandDevice(device, connectionId): ProfinetCommandDevice` — validate: deviceId (string, non-empty), slot (number >= 0), subslot (number >= 0), index (number >= 0), length (number > 0), dataType (in allowed list), description (string)
    - Thêm constant `VALID_PROFINET_DATA_TYPES = ['Float32', 'UInt16', 'UInt32', 'Int16', 'Int32', 'Boolean']`
    - Thêm `else if (c.protocol === 'profinet')` branch trong `validateDeviceMap()` — validate: host (string, non-empty), port (number), pollIntervalMs (number, required khi có telemetry), deviceName (string nếu có)
  - Notes: Error messages bằng tiếng Việt, theo pattern: `Profinet connection "${connectionId}" thiếu host`

- [x] Task 3: Tạo Profinet IO Client
  - File: `src/telemetry/profinet-client.ts` (NEW)
  - Action: Tạo `ProfinetClient extends EventEmitter` theo pattern của `ModbusClient`
    - Constructor: `(connectionId, host, port, deviceName?, reconnectConfig)`
    - Methods: `async connect()`, `async disconnect()`, `isConnected()`, `async readData(slot, subslot, index, length): Promise<Buffer>`, `async writeData(slot, subslot, index, data: Buffer): Promise<void>`
    - State: `connected`, `reconnecting`, `shouldReconnect`
    - Events: `'connected'`, `'disconnected'`
    - Reconnect: Exponential backoff giống Modbus — `scheduleReconnect()` với `Math.min(baseMs * 2^attempt, maxMs)`
    - Logger: `logger.child({ module: 'profinet-client', connectionId })`
  - Notes: Sử dụng raw TCP socket (net module) để giao tiếp Profinet IO. Profinet IO cyclic data trao đổi qua Ethernet frames — ở mock level, dùng TCP socket simulate. Production có thể thay bằng native Profinet library.

- [x] Task 4: Tạo Profinet Telemetry Poller
  - File: `src/telemetry/profinet-telemetry-poller.ts` (NEW)
  - Action: Tạo `ProfinetTelemetryPoller extends EventEmitter` theo pattern của `TelemetryPoller`
    - Constructor: `(connectionId, profinetClient, devices: ProfinetTelemetryDevice[], pollIntervalMs)`
    - Methods: `start()`, `stop()`
    - Polling logic: `setInterval` → loop qua devices → `client.readData(slot, subslot, index, length)` → parse buffer theo dataType → emit `'telemetry'` event
    - Data parsing: Buffer → value dựa trên dataType (Float32 → `readFloatBE`, UInt16 → `readUInt16BE`, Int16 → `readInt16BE`, UInt32 → `readUInt32BE`, Int32 → `readInt32BE`, Boolean → `readUInt8` !== 0)
    - NaN guard (F5 pattern): Skip emit nếu parsed value là NaN
    - Telemetry event format: `{ connectionId, deviceId, value, unit, description, timestamp: new Date().toISOString() }`
  - Notes: Mỗi device đọc riêng (không batch) vì Profinet IO addressing theo slot/subslot/index, không liên tục như Modbus registers.

- [x] Task 5: Mở rộng Command Handler cho Profinet
  - File: `src/command/command-handler.ts`
  - Action:
    - Update `CommandRouteEntry.protocol` type: `'opcua' | 'modbus' | 'profinet'`
    - Update `CommandRouteEntry.client` type: union thêm `ProfinetClient`
    - Update `CommandRouteEntry.device` type: union thêm `ProfinetCommandDevice`
    - Thêm `else if (route.protocol === 'profinet')` branch trong `handleCommand()`:
      - Map action → value bằng `mapActionToValue(action, device.dataType)`
      - Convert value → Buffer theo dataType
      - Call `client.writeData(device.slot, device.subslot, device.index, buffer)`
    - Mở rộng `mapActionToValue()` nếu cần hỗ trợ thêm data types cho Profinet (UInt32, Int16, Int32)
  - Notes: Import `ProfinetClient` và `ProfinetCommandDevice` từ tương ứng files.

- [x] Task 6: Tích hợp Profinet vào Main Loop
  - File: `src/index.ts`
  - Action:
    - Import: `ProfinetClient` từ `./telemetry/profinet-client.js`, `ProfinetTelemetryPoller` từ `./telemetry/profinet-telemetry-poller.js`, `ProfinetConnection` từ `./config/device-map.schema.js`
    - Thêm `const profinetClients = new Map<string, ProfinetClient>()`
    - Thêm `const profinetPollers: ProfinetTelemetryPoller[] = []`
    - Thêm `else if (conn.protocol === 'profinet')` branch trong connection loop (sau opcua branch):
      - Cast: `const pc = conn as ProfinetConnection`
      - Tạo client: `new ProfinetClient(pc.connectionId, pc.host, pc.port, pc.deviceName, makeReconnectConfig())`
      - Add to `profinetClients` map và `connectionStatuses`
      - Nếu có telemetry: tạo `ProfinetTelemetryPoller`, attach `connected`/`disconnected` events, add to `telemetrySources`
      - Log: `Đã khởi tạo Profinet IO connection`
    - Update command route map builder: thêm `else if (conn.protocol === 'profinet')` branch — tương tự opcua nhưng dùng `profinetClients` và `ProfinetCommandDevice`
    - Connect loop: thêm `for (const [connId, client] of profinetClients)` block
    - Shutdown: thêm profinet disconnect vào `Promise.allSettled`, stop pollers
    - Log: thêm `profinetConnections: profinetClients.size` vào startup log
  - Notes: Theo đúng pattern Modbus/OPC UA. Profinet pollers stop trong shutdown giống telemetryPollers.

- [x] Task 7: Update REST Server protocol type
  - File: `src/transport/rest-server.ts`
  - Action: Update `ConnectionStatus.protocol` type từ `'modbus' | 'opcua'` thành `'modbus' | 'opcua' | 'profinet'`
  - Notes: Chỉ cần update type — logic health check và device listing đã generic.

- [x] Task 8: Thêm Profinet connection vào device-map.json
  - File: `src/config/device-map.json`
  - Action: Thêm 1 Profinet IO connection example vào array `connections`:
    ```json
    {
      "connectionId": "PROFINET_STATION_A",
      "protocol": "profinet",
      "description": "Profinet IO Station A — Siemens S7-1500",
      "host": "profinet-mock-a",
      "port": 34964,
      "deviceName": "s7-1500-station-a",
      "pollIntervalMs": 500,
      "telemetry": [
        {
          "deviceId": "PN_TEMP_01",
          "slot": 1,
          "subslot": 1,
          "index": 0,
          "length": 4,
          "dataType": "Float32",
          "unit": "°C",
          "description": "Nhiệt độ đầu vào"
        },
        {
          "deviceId": "PN_PRESSURE_01",
          "slot": 1,
          "subslot": 1,
          "index": 4,
          "length": 4,
          "dataType": "Float32",
          "unit": "bar",
          "description": "Áp suất đầu ra"
        }
      ],
      "commands": [
        {
          "deviceId": "PN_VALVE_01",
          "slot": 2,
          "subslot": 1,
          "index": 0,
          "length": 1,
          "dataType": "Boolean",
          "description": "Van điều khiển 1"
        }
      ]
    }
    ```
  - Notes: Sử dụng hostname Docker `profinet-mock-a` cho môi trường Docker Compose.

- [x] Task 9: Tạo Profinet Mock Server
  - File: `mock-servers/profinet-mock/server.ts` (NEW)
  - File: `mock-servers/profinet-mock/Dockerfile` (NEW)
  - Action:
    - Mock server: TCP server listen trên `PROFINET_PORT` (env, default 34964)
    - Parse incoming read requests (slot/subslot/index/length) → return random sensor data
    - Parse incoming write requests (slot/subslot/index/data) → log và acknowledge
    - Environment variables: `PROFINET_PORT`, `DEVICE_NAME`, `TELEMETRY_DEVICES` (format: `NAME:Slot:Subslot:Index:DataType:Min:Max`), `COMMAND_DEVICES` (format: `NAME:Slot:Subslot:Index:DataType`)
    - Simulate realistic values: temperature 20-80°C, pressure 1-10 bar, fluctuate ±2% mỗi cycle
    - Dockerfile: `FROM node:20-alpine`, copy + install deps, expose port, CMD `npx tsx server.ts`
  - Notes: Protocol mock đơn giản qua TCP — không cần implement full Profinet IO stack. Đủ để test integration.

- [x] Task 10: Update Docker Compose
  - File: `docker-compose.yml`
  - Action: Thêm service `profinet-mock-a`:
    ```yaml
    profinet-mock-a:
      build:
        context: .
        dockerfile: mock-servers/profinet-mock/Dockerfile
      environment:
        PROFINET_PORT: 34964
        DEVICE_NAME: s7-1500-station-a
        TELEMETRY_DEVICES: "PN_TEMP_01:1:1:0:Float32:20:80,PN_PRESSURE_01:1:1:4:Float32:1:10"
        COMMAND_DEVICES: "PN_VALVE_01:2:1:0:Boolean"
      networks:
        - iiot-net
    ```
    - Update gateway service `depends_on` thêm `profinet-mock-a`
  - Notes: Thêm npm script `mock:profinet:a` trong `package.json` cho local dev.

- [x] Task 11: Thêm Profinet validation tests
  - File: `tests/unit/device-map-validation.test.ts`
  - Action: Thêm test cases trong describe block mới `'Profinet IO validation'`:
    - Happy path: Valid Profinet connection passes validation
    - Valid Profinet telemetry-only connection (no commands)
    - Valid Profinet command-only connection (no telemetry)
    - Missing host → throw error
    - Missing port → throw error
    - Missing pollIntervalMs khi có telemetry → throw error
    - Invalid slot (negative) → throw error
    - Invalid subslot (negative) → throw error
    - Invalid index (negative) → throw error
    - Invalid dataType → throw error
    - Missing deviceId → throw error
    - Missing unit trên telemetry device → throw error
    - Mixed protocol (Modbus + OPC UA + Profinet) in same config → passes
    - DeviceId uniqueness across Profinet + other protocols → throw error on duplicate
  - Notes: Extend `makeValidConfig()` hoặc tạo `makeValidProfinetConfig()` helper. Error messages check bằng regex.

- [x] Task 12: Update device-map.test.ts cho Profinet
  - File: `tests/unit/device-map.test.ts`
  - Action: Update existing tests để include Profinet connections:
    - Update connection count expectations
    - Add test: Profinet connection has correct properties
    - Add test: Profinet telemetry devices accessible via buildDeviceIndex
    - Add test: Profinet command devices accessible via buildDeviceIndex
    - Verify device lookup: `PN_TEMP_01 → PROFINET_STATION_A`
  - Notes: Tests read từ `device-map.json` trực tiếp — file đã được update ở Task 8.

### Acceptance Criteria

- [x] AC 1: Given một device-map.json có Profinet connection hợp lệ, when `validateDeviceMap()` được gọi, then trả về `DeviceMap` typed object với Profinet connection parsed đúng (host, port, slot/subslot/index trên devices)
- [x] AC 2: Given một device-map.json có Profinet connection thiếu host, when `validateDeviceMap()` được gọi, then throw Error với message chứa `"thiếu host"`
- [x] AC 3: Given Profinet telemetry device có dataType không hợp lệ, when validate, then throw Error với message chứa `"dataType không hợp lệ"`
- [x] AC 4: Given Profinet client connect thành công tới mock server, when connection established, then emit `'connected'` event và `isConnected()` trả về `true`
- [x] AC 5: Given Profinet client mất kết nối, when disconnect detected, then emit `'disconnected'` event và tự động reconnect với exponential backoff
- [x] AC 6: Given Profinet telemetry poller đang chạy, when poll cycle thực hiện, then emit `'telemetry'` event với format `{ connectionId, deviceId, value, unit, description, timestamp }`
- [x] AC 7: Given command `{ deviceId: "PN_VALVE_01", action: "START" }` gửi qua REST API, when CommandHandler xử lý, then ghi giá trị `true` vào Profinet device tại slot/subslot/index đúng
- [x] AC 8: Given gateway khởi động với device-map chứa Modbus + OPC UA + Profinet connections, when main loop chạy, then tất cả 3 protocol types được khởi tạo và connect
- [x] AC 9: Given `GET /api/health` gọi, when có Profinet connection, then response bao gồm Profinet connection status
- [x] AC 10: Given Docker Compose chạy, when `profinet-mock-a` service start, then mock server listen và return data cho read requests
- [x] AC 11: Given tất cả validation tests chạy, when `vitest run`, then tất cả tests pass bao gồm Profinet test cases mới

## Additional Context

### Dependencies

- **Node.js `net` module (built-in):** Dùng cho TCP socket communication với Profinet IO devices. Không cần thêm npm package cho mock level.
- **Potential future:** Nếu cần Profinet IO stack thực (production-grade), có thể cần native C/C++ addon hoặc thư viện như `node-snap7` cho Siemens S7. Hiện tại dùng raw TCP socket đủ cho MVP.
- **Existing dependencies:** Không cần thêm npm packages mới — tận dụng `net`, `EventEmitter`, `pino` đã có.

### Testing Strategy

- **Unit tests (Vitest):**
  - Validation: 14+ test cases cho Profinet config validation (happy path, missing fields, invalid values, mixed protocols, uniqueness)
  - Device index: Verify `buildDeviceIndex()` index Profinet devices đúng role (telemetry/command)
- **Integration tests (manual/Docker):**
  - Start Docker Compose → verify Profinet mock responds
  - Gateway connects to Profinet mock → telemetry data flows qua WebSocket
  - Send command via REST → verify mock receives write request
  - Kill mock → verify reconnect logic hoạt động
  - Mixed protocol: Modbus + OPC UA + Profinet cùng chạy
- **Mock server tests:**
  - Mock server start/stop cleanly
  - Mock returns realistic fluctuating values
  - Mock handles concurrent connections

### Notes

- **High-risk:** Profinet IO real-world protocol phức tạp hơn TCP socket mock rất nhiều. Mock chỉ simulate read/write pattern — production deployment sẽ cần thay thế bằng real Profinet IO stack.
- **Known limitation:** Mock server không implement Profinet IO frame format thực — dùng custom TCP protocol đơn giản. Đủ cho development và testing, không dùng với thiết bị Profinet thật.
- **Byte order:** Profinet IO dùng Big Endian (network byte order). Cần consistent BE parsing trong client và mock.
- **Future consideration:** Nếu cần hỗ trợ nhiều Profinet stations, có thể cần Profinet IO Controller role — phức tạp hơn đáng kể, nằm ngoài scope hiện tại.

## Review Notes

- Adversarial review completed
- Findings: 7 total, 7 fixed, 0 skipped
- Resolution approach: auto-fix
- F1 (Critical): TCP stream framing — added response buffer accumulation
- F2 (High): Race condition — added request serialization queue
- F3 (High): connect() error handling — now properly rejects on failure
- F4 (High): Reconnect socket error handler — added persistent error+close handlers via attachSocketHandlers()
- F5 (Medium): Buffer underflow — added minBytesForType validation before parsing
- F6 (Medium): Missing tests — added unit tests for ProfinetClient (8 tests) and ProfinetTelemetryPoller (3 tests)
- F7 (Low): valueToBuffer type safety — changed `any` to `boolean | number`, added runtime type checks
