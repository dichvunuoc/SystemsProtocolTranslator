---
title: 'Unified OPC UA Telemetry & Flexible Protocol Configuration'
slug: 'unified-opcua-flexible-protocol'
created: '2026-03-16'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript ES2022/NodeNext', 'Express 5', 'node-opcua (ClientSubscription, ClientMonitoredItem)', 'modbus-serial', 'ws', 'Pino logger', 'Vitest']
files_to_modify: ['src/config/device-map.json', 'src/config/device-map.schema.ts', 'src/command/opcua-client.ts', 'src/telemetry/telemetry-poller.ts', 'src/command/command-handler.ts', 'src/index.ts', 'src/transport/ws-server.ts', 'mock-servers/opcua-mock/server.ts', 'docker-compose.yml']
files_to_create: ['src/telemetry/opcua-telemetry-subscriber.ts']
code_patterns: ['EventEmitter-based clients (emit connected/disconnected)', 'Custom reconnect with exponential backoff', 'Config-driven via device-map.json → validate → build indexes', 'Vietnamese logs and comments']
test_patterns: ['Vitest with vi.fn() manual mocks', 'Load real JSON fixtures in tests', 'Event-driven assertions for telemetry', 'toBeCloseTo() for float precision', 'httpGet() helper for REST tests']
---

# Tech-Spec: Unified OPC UA Telemetry & Flexible Protocol Configuration

**Created:** 2026-03-16

## Overview

### Problem Statement

Hiện tại hệ thống cứng nhắc — Modbus chỉ dùng để đọc telemetry, OPC UA chỉ dùng để ghi command. Cần linh hoạt để một connection có thể vừa đọc (telemetry) vừa ghi (command) bất kể protocol, và hỗ trợ OPC UA subscription thay vì chỉ polling.

### Solution

Thiết kế lại device-map schema cho phép mỗi connection khai báo cả telemetry devices (đọc) lẫn command devices (ghi) bất kể protocol. Thêm OPC UA subscription (monitored items) cho telemetry. Giữ Modbus như protocol option song song.

### Scope

**In Scope:**
- Thiết kế lại `device-map.json` schema — linh hoạt, một connection có cả telemetry + command devices
- Thêm `readValue` / subscription (monitored items) vào `OpcuaClient`
- Refactor `TelemetryPoller` thành protocol-agnostic, hỗ trợ cả Modbus polling và OPC UA subscription
- Refactor `CommandHandler` hỗ trợ routing linh hoạt theo protocol
- Cập nhật `index.ts` orchestration theo schema mới
- Cập nhật `opcua-mock` server expose sensor nodes
- Cập nhật tests

**Out of Scope:**
- Thêm protocol mới ngoài Modbus/OPC UA
- UI/dashboard
- Authentication/security cho OPC UA
- Subscription advanced features (deadband, sampling interval tuning)

## Context for Development

### Codebase Patterns

- Clients (`ModbusClient`, `OpcuaClient`) kế thừa `EventEmitter`, emit `connected`/`disconnected`
- Reconnect logic custom với exponential backoff (không dùng SDK auto-reconnect)
- Config-driven: `device-map.json` → validate bằng schema → build indexes/routes trong `index.ts`
- Telemetry flow hiện tại: `ModbusClient` → `TelemetryPoller` (setInterval poll) → emit `telemetry` event → `WsServer` broadcast
- Command flow hiện tại: REST POST → `CommandHandler` → route lookup → `OpcuaClient.writeValue()`
- Vietnamese logs/comments xuyên suốt codebase
- Docker Compose: 4 mock servers (2 Modbus profiles: full/minimal, 2 OPC UA) + gateway trên `iiot-net` bridge network

### Files to Reference

| File | Purpose | Thay đổi cần thiết |
| ---- | ------- | ------------------- |
| `src/config/device-map.json` | Cấu hình connections và devices | Redesign schema: tách `telemetry[]` + `commands[]` |
| `src/config/device-map.schema.ts` | Validation schema và types | Thêm types mới, validate telemetry/command arrays |
| `src/command/opcua-client.ts` | OPC UA client — chỉ có writeValue | Thêm subscribe() với ClientSubscription + MonitoredItem |
| `src/telemetry/modbus-client.ts` | Modbus client — readHoldingRegisters | Giữ nguyên |
| `src/telemetry/telemetry-poller.ts` | Polling logic — hardcoded ModbusClient | Refactor: protocol-agnostic hoặc giữ cho Modbus only |
| `src/telemetry/register-parser.ts` | Parse Modbus registers → JS numbers | Giữ nguyên — chỉ dùng cho Modbus |
| `src/command/command-handler.ts` | Command routing — hardcoded OPC UA | Refactor: hỗ trợ routing theo protocol |
| `src/index.ts` | Main orchestration | Refactor theo schema mới, tạo OPC UA subscribers |
| `src/transport/ws-server.ts` | WebSocket broadcast | Refactor: nhận EventEmitter chung thay vì TelemetryPoller[] |
| `mock-servers/opcua-mock/server.ts` | OPC UA mock — chỉ có command nodes | Thêm sensor nodes (Float/Double) với giá trị thay đổi |
| `mock-servers/modbus-mock/server.ts` | Modbus mock với profiles | Giữ nguyên |
| `docker-compose.yml` | Docker orchestration | Cập nhật env vars cho OPC UA mock mới |
| `tests/integration/command-flow.test.ts` | Test command routing | Update theo schema mới |
| `tests/integration/telemetry-flow.test.ts` | Test telemetry polling | Thêm test OPC UA subscription |
| `tests/unit/device-map.test.ts` | Test device-map structure | Update theo schema mới |
| `tests/unit/device-map-validation.test.ts` | Test schema validation | Thêm test cases cho telemetry/command arrays |

### Technical Decisions

- OPC UA telemetry dùng **subscription (monitored items)** thay vì polling — server push khi giá trị thay đổi, hiệu quả hơn
- Device-map schema mới: mỗi connection khai báo `telemetry[]` và `commands[]` arrays riêng biệt, protocol chỉ quyết định transport
- Giữ Modbus polling cho telemetry — không phá vỡ flow hiện tại
- `WsServer` sẽ nhận generic `EventEmitter` interface thay vì `TelemetryPoller[]` cụ thể — hỗ trợ cả Modbus poller và OPC UA subscriber
- Tạo `OpcuaTelemetrySubscriber` mới (EventEmitter) — emit cùng `telemetry` event format như `TelemetryPoller`

### Key Technical Constraints

1. `WsServer` constructor nhận `TelemetryPoller[]` trực tiếp — cần refactor thành interface/EventEmitter chung
2. `TelemetryPoller` hardcoded `ModbusClient` — giữ cho Modbus, tạo song song `OpcuaTelemetrySubscriber`
3. `OpcuaClient` chỉ có `writeValue()` — cần thêm `createSubscription()` + `monitorItem()` dùng node-opcua APIs
4. OPC UA mock chỉ có Boolean command nodes — cần thêm Float/Double sensor nodes với giá trị simulate thay đổi theo thời gian
5. `CommandHandler` hardcoded kiểm tra `protocol === 'modbus'` để reject — cần refactor logic routing

## Implementation Plan

### Tasks

#### Task 1: Thiết kế lại Device-Map Schema

- [x] Task 1.1: Định nghĩa types mới trong `device-map.schema.ts`
  - File: `src/config/device-map.schema.ts`
  - Action: Thêm interfaces mới cho schema linh hoạt:
    - `TelemetryDevice` — base interface với `deviceId`, `unit`, `description`
    - `ModbusTelemetryDevice extends TelemetryDevice` — thêm `register`, `length`, `dataType`, `wordOrder`
    - `OpcuaTelemetryDevice extends TelemetryDevice` — thêm `nodeId`, `dataType`
    - `CommandDevice` — base interface với `deviceId`, `description`
    - `ModbusCommandDevice extends CommandDevice` — thêm `register`, `length`, `dataType`, `wordOrder`
    - `OpcuaCommandDevice extends CommandDevice` — thêm `nodeId`, `dataType`
    - Cập nhật `ModbusConnection`: thay `devices[]` bằng `telemetry?: ModbusTelemetryDevice[]`, `commands?: ModbusCommandDevice[]`, giữ `pollIntervalMs`
    - Cập nhật `OpcuaConnection`: thay `devices[]` bằng `telemetry?: OpcuaTelemetryDevice[]`, `commands?: OpcuaCommandDevice[]`
  - Notes: Cả `telemetry` và `commands` đều optional — một connection có thể chỉ đọc hoặc chỉ ghi

- [x] Task 1.2: Cập nhật validation functions
  - File: `src/config/device-map.schema.ts`
  - Action:
    - Thêm `validateModbusTelemetryDevice()`, `validateOpcuaTelemetryDevice()`, `validateModbusCommandDevice()`, `validateOpcuaCommandDevice()`
    - Cập nhật `validateDeviceMap()`: validate `telemetry[]` và `commands[]` thay vì `devices[]`
    - Validate ít nhất 1 trong 2 (telemetry hoặc commands) phải có devices
    - `buildDeviceIndex()`: trả về thêm field `role: 'telemetry' | 'command'` trong index entry
  - Notes: DeviceId vẫn phải unique across ALL connections và ALL roles

- [x] Task 1.3: Cập nhật device-map.json theo schema mới
  - File: `src/config/device-map.json`
  - Action: Chuyển đổi cấu hình hiện tại sang schema mới. Ví dụ cấu hình OPC UA unified (1 connection cho cả telemetry + command):
    ```json
    {
      "connectionId": "STATION_A",
      "protocol": "opcua",
      "description": "Trạm bơm A — OPC UA unified",
      "endpoint": "opc.tcp://opcua-mock-a:4840",
      "telemetry": [
        {
          "deviceId": "SENSOR_P_01",
          "nodeId": "ns=2;s=SENSOR_P_01.Value",
          "dataType": "Double",
          "unit": "bar",
          "description": "Inlet pressure"
        }
      ],
      "commands": [
        {
          "deviceId": "PUMP_01",
          "nodeId": "ns=2;s=PUMP_01.Command",
          "dataType": "Boolean",
          "description": "Main pump start/stop"
        }
      ]
    }
    ```
  - Notes: Chuyển tất cả sensors hiện tại từ Modbus sang OPC UA telemetry nodes. Gộp `STATION_A` + `STATION_A_CMD` thành 1 connection. Tương tự cho Station B.

#### Task 2: Thêm OPC UA Subscription vào OpcuaClient

- [x] Task 2.1: Thêm subscription capability
  - File: `src/command/opcua-client.ts`
  - Action:
    - Import thêm `ClientSubscription`, `ClientMonitoredItem`, `TimestampsToReturn`, `MonitoringParametersOptions` từ `node-opcua`
    - Thêm method `createSubscription(publishingInterval?: number): Promise<ClientSubscription>` — tạo subscription trên session hiện tại, default publishingInterval = 1000ms
    - Thêm method `monitorItem(subscription: ClientSubscription, nodeId: string, samplingInterval?: number): Promise<ClientMonitoredItem>` — tạo monitored item, default samplingInterval = 500ms
    - Lưu reference tới subscription để cleanup khi disconnect
  - Notes: Dùng `subscription.on('terminated')` để handle subscription mất. Cleanup subscription trong `disconnect()`.

#### Task 3: Tạo OPC UA Telemetry Subscriber

- [x] Task 3.1: Tạo file mới `OpcuaTelemetrySubscriber`
  - File: `src/telemetry/opcua-telemetry-subscriber.ts` (MỚI)
  - Action: Tạo class `OpcuaTelemetrySubscriber extends EventEmitter`:
    - Constructor nhận: `connectionId`, `opcuaClient: OpcuaClient`, `devices: OpcuaTelemetryDevice[]`
    - Method `start(): Promise<void>`:
      1. Gọi `opcuaClient.createSubscription()`
      2. Loop qua `devices`, gọi `opcuaClient.monitorItem()` cho từng device
      3. Mỗi monitored item `.on('changed', callback)` → emit `telemetry` event với `TelemetryData` format
    - Method `stop(): Promise<void>`: terminate subscription
    - Emit cùng `TelemetryData` interface như `TelemetryPoller` để `WsServer` không cần thay đổi logic
  - Notes: `TelemetryData` interface cần được export từ file chung hoặc giữ ở `telemetry-poller.ts` và import

#### Task 4: Refactor WsServer — Protocol-Agnostic Telemetry Sources

- [x] Task 4.1: Đổi WsServer nhận EventEmitter chung
  - File: `src/transport/ws-server.ts`
  - Action:
    - Thay `TelemetryPoller[]` trong constructor bằng `EventEmitter[]` (hoặc define interface `TelemetrySource extends EventEmitter`)
    - Import `EventEmitter` từ `events` thay vì import `TelemetryPoller`
    - Vẫn subscribe `.on('telemetry', callback)` — không đổi logic broadcast
    - Import `TelemetryData` type từ location chung
  - Notes: Cả `TelemetryPoller` (Modbus) và `OpcuaTelemetrySubscriber` (OPC UA) đều emit cùng event name `telemetry` với cùng `TelemetryData` shape

#### Task 5: Refactor CommandHandler — Flexible Protocol Routing

- [x] Task 5.1: Hỗ trợ command routing đa protocol
  - File: `src/command/command-handler.ts`
  - Action:
    - Cập nhật `CommandRouteEntry` thêm field `protocol: 'opcua' | 'modbus'`
    - Thêm `ModbusClient` vào route entry khi protocol là modbus (future-proof, hiện tại chưa cần dùng)
    - Bỏ hardcoded check `protocol === 'modbus'` → reject. Thay bằng: nếu device không có trong commandRouteMap thì báo lỗi "device không hỗ trợ command"
    - Giữ nguyên `mapActionToValue()` logic
  - Notes: Hiện tại tất cả commands vẫn qua OPC UA, nhưng routing logic không hardcode protocol nữa

#### Task 6: Refactor Main Orchestration

- [x] Task 6.1: Cập nhật `index.ts` theo schema mới
  - File: `src/index.ts`
  - Action:
    - Import `OpcuaTelemetrySubscriber` và types mới
    - Thay đổi loop tạo clients: mỗi connection tạo client theo protocol, sau đó:
      - Nếu có `telemetry[]`: tạo `TelemetryPoller` (Modbus) hoặc `OpcuaTelemetrySubscriber` (OPC UA)
      - Nếu có `commands[]`: build command route entries
    - Gộp tất cả telemetry sources (pollers + subscribers) vào array `EventEmitter[]` truyền cho `WsServer`
    - OPC UA subscriber `.start()` sau khi client connected (dùng event `connected`)
    - Cập nhật `buildDeviceIndex` usage nếu API thay đổi
    - Cập nhật shutdown: terminate subscriptions + stop pollers
  - Notes: Một OPC UA connection có thể vừa có subscriber (telemetry) vừa có command routes — dùng cùng 1 client instance

#### Task 7: Cập nhật OPC UA Mock Server

- [x] Task 7.1: Thêm sensor nodes vào OPC UA mock
  - File: `mock-servers/opcua-mock/server.ts`
  - Action:
    - Thêm env var `SENSOR_NODES` — format: `SENSOR_P_01.Value:Double,SENSOR_F_01.Value:Double,...`
    - Tạo sensor nodes với dataType Double/Float, giá trị khởi tạo từ config
    - Thêm `setInterval` simulate giá trị thay đổi ngẫu nhiên (tương tự Modbus mock) — mỗi 2s update giá trị sensor nodes trong range hợp lý
    - Giữ nguyên logic command nodes hiện tại
  - Notes: Sensor nodes cần có giá trị thay đổi để subscription push notifications hoạt động. Dùng `variable.setValueFromSource()` để trigger value change events trong node-opcua server.

- [x] Task 7.2: Cập nhật Docker Compose
  - File: `docker-compose.yml`
  - Action:
    - Cập nhật `opcua-mock-a` env: thêm `SENSOR_NODES` cho Station A sensors (P_01, P_02, F_01, L_01, PUMP_01_STATUS, PUMP_02_STATUS)
    - Cập nhật `opcua-mock-b` env: thêm `SENSOR_NODES` cho Station B sensors (P_03, PUMP_03_STATUS)
  - Notes: Format env var cần parse được dataType và range cho simulation

#### Task 8: Cập nhật Tests

- [x] Task 8.1: Cập nhật unit tests cho schema validation
  - File: `tests/unit/device-map-validation.test.ts`
  - Action:
    - Cập nhật `makeValidConfig()` helper theo schema mới (telemetry/commands arrays)
    - Thêm test cases:
      - Connection chỉ có telemetry (không commands) → valid
      - Connection chỉ có commands (không telemetry) → valid
      - Connection không có cả 2 → invalid
      - OPC UA telemetry device validation (nodeId, dataType required)
      - Mixed protocol trong cùng device-map → valid
      - DeviceId unique across telemetry + commands

- [x] Task 8.2: Cập nhật device-map structure test
  - File: `tests/unit/device-map.test.ts`
  - Action: Cập nhật assertions theo device-map.json mới — kiểm tra telemetry/commands arrays thay vì devices

- [x] Task 8.3: Cập nhật command flow integration test
  - File: `tests/integration/command-flow.test.ts`
  - Action:
    - Cập nhật `buildTestHandler()` theo schema mới
    - Thêm test: device có trong telemetry nhưng không trong commands → reject command
    - Bỏ hardcoded "Modbus telemetry-only" check → thay bằng generic "device không hỗ trợ command"

- [x] Task 8.4: Thêm test cho OPC UA telemetry subscription
  - File: `tests/integration/telemetry-flow.test.ts`
  - Action:
    - Thêm describe block mới cho `OpcuaTelemetrySubscriber`
    - Mock `OpcuaClient` với `createSubscription()` và `monitorItem()` trả về mock monitored items
    - Test: khi monitored item emit `changed` → subscriber emit `telemetry` với đúng format
    - Test: subscriber stop → subscription terminated
    - Test: subscriber handles OPC UA disconnection gracefully

- [x] Task 8.5: Cập nhật REST health test
  - File: `tests/integration/rest-health.test.ts`
  - Action: Cập nhật mock connections theo schema mới (nếu cần)

### Acceptance Criteria

- [x] AC 1: Given device-map.json có 1 OPC UA connection với cả `telemetry[]` và `commands[]`, when gateway khởi động, then OPC UA client kết nối, tạo subscription cho telemetry devices, và sẵn sàng nhận commands
- [x] AC 2: Given OPC UA subscription đang active, when giá trị sensor thay đổi trên server, then `OpcuaTelemetrySubscriber` emit event `telemetry` với `TelemetryData` format đúng (connectionId, deviceId, value, unit, timestamp)
- [x] AC 3: Given WebSocket client đang kết nối, when OPC UA telemetry data thay đổi, then client nhận được message JSON qua WebSocket (cùng format như Modbus telemetry hiện tại)
- [x] AC 4: Given device-map.json có mixed protocols (Modbus + OPC UA), when gateway khởi động, then cả 2 protocol đều hoạt động song song — Modbus polling + OPC UA subscription
- [x] AC 5: Given một device chỉ nằm trong `telemetry[]` (không có trong `commands[]`), when gửi POST /api/command cho device đó, then trả về 400 với message rõ ràng "device không hỗ trợ command"
- [x] AC 6: Given OPC UA connection mất kết nối, when reconnect thành công, then subscription được tạo lại tự động và tiếp tục nhận telemetry
- [x] AC 7: Given device-map.json có connection chỉ có `telemetry[]` (không có `commands[]`), when validate, then pass validation thành công
- [x] AC 8: Given device-map.json có connection không có cả `telemetry[]` lẫn `commands[]` (hoặc cả 2 rỗng), when validate, then throw validation error
- [x] AC 9: Given OPC UA mock server có sensor nodes, when gateway kết nối, then nhận được giá trị sensor qua subscription và broadcast qua WebSocket
- [x] AC 10: Given gateway đang chạy, when nhận SIGTERM, then tất cả subscriptions được terminate, connections đóng sạch, process exit 0

## Additional Context

### Dependencies

- `node-opcua` (^2.164.2) — đã có trong package.json. Cần dùng thêm:
  - `ClientSubscription` — tạo subscription trên OPC UA session
  - `ClientMonitoredItem` — monitor từng node trong subscription
  - `TimestampsToReturn` — config cho monitored items
  - `Variant`, `DataType` (server-side) — dùng trong mock server để tạo sensor nodes
- `modbus-serial` (^8.0.23) — giữ nguyên, không thay đổi
- Không cần thêm dependency mới

### Testing Strategy

**Unit Tests:**
- Schema validation: test types mới, validation rules cho telemetry/commands arrays, edge cases (empty arrays, missing fields, duplicate deviceIds across roles)
- Device-map structure: verify JSON file mới parse đúng

**Integration Tests:**
- OPC UA telemetry subscription: mock OpcuaClient, verify `OpcuaTelemetrySubscriber` emit đúng events
- Command flow: verify routing logic mới, test reject devices không có trong commands
- REST health: verify response format với schema mới

**Manual/Docker Tests:**
- `docker compose up` — verify gateway kết nối tới OPC UA mock, nhận telemetry qua subscription
- WebSocket client test — verify nhận telemetry data realtime
- POST /api/command — verify command vẫn hoạt động

### Notes

**Rủi ro:**
- node-opcua `ClientSubscription` behavior khi server restart — cần test kỹ reconnect + re-subscribe flow
- OPC UA mock server cần `setValueFromSource()` để trigger monitored item notifications — nếu chỉ set biến thông thường, subscription có thể không push

**Giới hạn đã biết:**
- Subscription chưa hỗ trợ tuning (deadband, sampling interval) — dùng defaults
- Chưa hỗ trợ Modbus write commands (schema cho phép nhưng chưa implement handler)

**Cân nhắc tương lai (out of scope):**
- Modbus write support khi cần
- Subscription tuning per-device (deadband, sampling interval config trong device-map)
- OPC UA security (certificates, authentication)
- Browse OPC UA server tự động để discover nodes

## Review Notes

- Adversarial review completed
- Findings: 15 total, 13 fixed, 1 skipped (noise), 1 not applicable (F11 — validation already prevents)
- Resolution approach: auto-fix
