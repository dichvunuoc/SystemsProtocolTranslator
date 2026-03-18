---
title: 'Multi-PLC Support for Edge Gateway'
slug: 'multi-plc-edge-gateway'
created: '2026-03-16'
status: 'Completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'Node.js', 'node-opcua', 'modbus-serial', 'jsmodbus', 'Express', 'ws', 'pino', 'vitest', 'Docker']
files_to_modify:
  - 'src/config/device-map.json'
  - 'src/config/device-map.schema.ts'
  - 'src/config/gateway.config.ts'
  - 'src/index.ts'
  - 'src/telemetry/modbus-client.ts'
  - 'src/telemetry/telemetry-poller.ts'
  - 'src/command/opcua-client.ts'
  - 'src/command/command-handler.ts'
  - 'src/transport/rest-server.ts'
  - 'src/transport/ws-server.ts'
  - 'mock-servers/modbus-mock/server.ts'
  - 'mock-servers/opcua-mock/server.ts'
  - 'docker-compose.yml'
  - 'tests/unit/device-map.test.ts'
  - 'tests/unit/device-map-validation.test.ts'
code_patterns:
  - 'Modular architecture: each protocol handler is an independent module'
  - 'Config-driven: device mapping via JSON, no hardcoded addresses'
  - 'Event-driven: Telemetry uses EventEmitter internally, pushes to WebSocket'
  - 'Reconnection: Exponential backoff (1s→2s→4s→...max 30s)'
  - 'Structured logging: pino with JSON output'
  - 'All log messages and code comments MUST be written in Vietnamese'
test_patterns:
  - 'vitest for unit and integration tests'
  - 'Unit tests for register-parser (Float32 word order variants)'
  - 'Unit tests for device-map schema validation and deviceId uniqueness'
  - 'Integration tests with mock servers'
---

# Tech-Spec: Multi-PLC Support for Edge Gateway

**Created:** 2026-03-16

## Overview

### Problem Statement

Gateway hiện tại chỉ kết nối được 1 OPC UA server + 1 Modbus slave (flat config). Thực tế cần điều khiển nhiều cụm thiết bị, mỗi cụm có PLC riêng (có thể cùng hoặc khác giao thức — OPC UA, Modbus, hoặc mix). Cần mở rộng gateway để kết nối đồng thời nhiều PLC qua cấu hình duy nhất trong `device-map.json`.

### Solution

Chuyển `device-map.json` từ cấu trúc flat (1 opcua + 1 modbus) sang mảng `connections[]` — mỗi phần tử là 1 PLC connection với protocol, thông tin kết nối, và danh sách devices. Gateway tự tạo N client instances, N pollers, routing command tự động theo deviceId lookup across all connections.

### Scope

**In Scope:**
- Cấu trúc `device-map.json` mới hỗ trợ nhiều connections (OPC UA + Modbus mix)
- TypeScript interfaces + runtime validation cho device-map schema
- Mỗi connection có `connectionId` để phân biệt cụm
- Tạo nhiều ModbusClient/OpcuaClient instances từ config
- TelemetryPoller hỗ trợ nhiều Modbus connections
- CommandHandler auto-routing: lookup deviceId → tìm đúng PLC connection → gửi command
- WebSocket gộp chung 1 stream, tag thêm `connectionId` vào mỗi message
- REST API `/api/command` giữ nguyên interface `{ deviceId, action }` — gateway tự resolve PLC đích
- Health check hiển thị trạng thái từng connection
- Cập nhật mock servers / docker-compose cho demo multi-PLC

**Out of Scope:**
- File config tách riêng per station
- WebSocket tách channel/topic per cụm
- Dynamic add/remove PLC lúc runtime
- Load balancing giữa các PLC
- Modbus write commands (command routing chỉ hỗ trợ OPC UA)

## Context for Development

### Codebase Patterns

- **Modular architecture:** Mỗi protocol handler (ModbusClient, OpcuaClient) là module độc lập, extends EventEmitter
- **Config-driven:** Device mapping qua JSON (`device-map.json`), không hardcode addresses
- **Event-driven:** TelemetryPoller emit 'telemetry' events → WsServer broadcast
- **Reconnection:** Exponential backoff (1s→2s→4s→...max 30s) cho cả OPC UA và Modbus
- **Dependency coupling:** ModbusClient và OpcuaClient import `gatewayConfig` trực tiếp cho reconnect params → cần refactor sang constructor injection
- **Ngôn ngữ:** Tất cả log messages và code comments viết bằng tiếng Việt

### Files to Reference

| File | Vai trò | Thay đổi |
|---|---|---|
| `src/config/device-map.json` | Tag list flat (1 opcua + 1 modbus) | Chuyển sang `connections[]` array |
| `src/config/device-map.schema.ts` | **MỚI** — TypeScript interfaces + validation | Tạo mới |
| `src/config/gateway.config.ts` | Single connection env vars | Xóa single-connection params, giữ REST/WS/reconnect config |
| `src/index.ts` | Bootstrap 1 ModbusClient + 1 OpcuaClient | Loop connections[], tạo N instances |
| `src/telemetry/modbus-client.ts` | 1 Modbus TCP client, import gatewayConfig | Nhận reconnect config qua constructor |
| `src/telemetry/telemetry-poller.ts` | Poll 1 ModbusClient, emit 'telemetry' | Hỗ trợ nhiều sources, tag connectionId |
| `src/command/opcua-client.ts` | 1 OPC UA client, import gatewayConfig | Nhận reconnect config qua constructor |
| `src/command/command-handler.ts` | Lookup từ 1 device array, gọi 1 OpcuaClient | Auto-routing: Map<deviceId, {client, device}> |
| `src/transport/rest-server.ts` | Health check 1 opcua + 1 modbus | Health check N connections (breaking change) |
| `src/transport/ws-server.ts` | Subscribe 1 TelemetryPoller | Subscribe nhiều pollers |
| `mock-servers/` + `docker-compose.yml` | 1 opcua-mock + 1 modbus-mock | Thêm mock thứ 2 cho demo multi-PLC |
| `tests/unit/device-map.test.ts` | Assert flat structure | Update cho new schema |

### Technical Decisions

- **Refactor DI:** ModbusClient/OpcuaClient nhận `{ reconnectBaseMs, reconnectMaxMs }` qua constructor thay vì import global config → cho phép mỗi connection có config riêng
- **TelemetryData mở rộng:** Thêm `connectionId` field vào interface — backward-compatible (additive change)
- **Command routing:** Build `Map<deviceId, { connectionId, client, device }>` lúc startup → O(1) lookup, không cần thêm field vào REST API. **Chỉ OPC UA devices** — Modbus devices là telemetry-only, command tới Modbus device trả lỗi phân biệt rõ ràng
- **deviceId uniqueness:** Validate lúc startup — throw error nếu trùng across connections
- **Health check:** Breaking change — trả về `{ connections: { [connectionId]: { protocol, status } }, uptime }` thay vì format cũ `{ opcua, modbus, uptime }`. Đây là thay đổi có chủ đích vì format cũ không scale cho N connections
- **Config scope:** `pollIntervalMs` là per-connection (từ device-map.json). `reconnectBaseMs`/`reconnectMaxMs` là global defaults (từ gatewayConfig)

### Technical Constraints & Preferences
- Giữ backward-compatible cho REST API command interface (`{ deviceId, action }` — không cần thêm field mới)
- Health check API **breaking change** — format mới cho multi-connection
- `connectionId` tag trong telemetry message giúp client biết data từ cụm nào
- Mỗi connection có reconnection logic độc lập
- deviceId phải unique across ALL connections (gateway validate lúc startup)

## Implementation Plan

### Tasks

Tasks được sắp xếp theo thứ tự dependency — layer thấp nhất trước.

**Dependency graph:**
```
Story 1 (Schema) → Story 2 (Client DI) → Story 3 (Multi-routing) → Story 4 (Bootstrap) → Story 5 (Transport)
                                                                                        → Story 6 (Mocks) → Story 7 (Tests)
```

**QUAN TRỌNG:** Task 4.2 (xóa fields từ gatewayConfig) phải thực hiện SAU Story 2 hoàn tất (clients không còn import gatewayConfig) VÀ SAU Task 4.1 (index.ts dùng config mới). Nếu làm trước sẽ compile error.

---

#### Story 1: Device Map Schema & Validation

- [x] **Task 1.1:** Tạo TypeScript interfaces cho device-map schema
  - File: `src/config/device-map.schema.ts` (TẠO MỚI)
  - Action: Tạo typed interfaces và runtime validation function:
    ```typescript
    // --- Interfaces ---
    interface ModbusDevice {
      deviceId: string;
      register: number;
      length: number;
      dataType: 'Float32' | 'UInt16';
      wordOrder: 'AB_CD' | 'CD_AB' | 'BA_DC' | 'DC_BA';
      unit: string;
      description: string;
    }

    interface OpcuaDevice {
      deviceId: string;
      nodeId: string;
      dataType: string;
      description: string;
    }

    interface ModbusConnection {
      connectionId: string;
      protocol: 'modbus';
      description: string;
      host: string;
      port: number;
      unitId: number;
      pollIntervalMs: number;
      devices: ModbusDevice[];
    }

    interface OpcuaConnection {
      connectionId: string;
      protocol: 'opcua';
      description: string;
      endpoint: string;
      devices: OpcuaDevice[];
    }

    type ConnectionConfig = ModbusConnection | OpcuaConnection;

    interface DeviceMap {
      connections: ConnectionConfig[];
    }

    // --- Validation ---
    function validateDeviceMap(raw: unknown): DeviceMap
    // Kiểm tra:
    // - connections là array, không rỗng
    // - Mỗi connection có connectionId, protocol, devices[]
    // - protocol === 'modbus' → phải có host, port, unitId, pollIntervalMs
    // - protocol === 'opcua' → phải có endpoint
    // - protocol không hợp lệ → throw error
    // - connectionId unique
    // - deviceId unique across ALL connections → nếu trùng, throw error chỉ rõ deviceId + 2 connectionIds

    function buildDeviceIndex(deviceMap: DeviceMap): Map<string, { connectionId: string, protocol: string }>
    // Build index để tra cứu nhanh deviceId → connectionId
    ```
  - Notes: Export tất cả interfaces để các module khác dùng. Validation chạy lúc startup trước khi tạo bất kỳ client nào.

- [x] **Task 1.2:** Chuyển đổi `device-map.json` sang cấu trúc multi-connection
  - File: `src/config/device-map.json`
  - Action: Thay thế cấu trúc flat bằng `{ "connections": [...] }`. Dữ liệu cụ thể:

    **Station A (migrate từ dữ liệu hiện tại):**
    ```json
    {
      "connectionId": "STATION_A",
      "protocol": "modbus",
      "description": "Trạm bơm A — cụm sensor",
      "host": "modbus-mock-a",
      "port": 502,
      "unitId": 1,
      "pollIntervalMs": 1000,
      "devices": [
        { "deviceId": "SENSOR_P_01", "register": 0, "length": 2, "dataType": "Float32", "wordOrder": "AB_CD", "unit": "bar", "description": "Inlet pressure" },
        { "deviceId": "SENSOR_P_02", "register": 2, "length": 2, "dataType": "Float32", "wordOrder": "CD_AB", "unit": "bar", "description": "Outlet pressure" },
        { "deviceId": "SENSOR_F_01", "register": 4, "length": 2, "dataType": "Float32", "wordOrder": "AB_CD", "unit": "m3/h", "description": "Flow rate" },
        { "deviceId": "SENSOR_L_01", "register": 6, "length": 2, "dataType": "Float32", "wordOrder": "AB_CD", "unit": "m", "description": "Water level" },
        { "deviceId": "PUMP_01_STATUS", "register": 8, "length": 1, "dataType": "UInt16", "wordOrder": "AB_CD", "unit": "", "description": "Pump 1 running status (0=OFF, 1=ON)" },
        { "deviceId": "PUMP_02_STATUS", "register": 9, "length": 1, "dataType": "UInt16", "wordOrder": "AB_CD", "unit": "", "description": "Pump 2 running status (0=OFF, 1=ON)" }
      ]
    },
    {
      "connectionId": "STATION_A_CMD",
      "protocol": "opcua",
      "description": "Trạm bơm A — điều khiển bơm",
      "endpoint": "opc.tcp://opcua-mock-a:4840",
      "devices": [
        { "deviceId": "PUMP_01", "nodeId": "ns=2;s=PUMP_01.Command", "dataType": "Boolean", "description": "Main pump start/stop" },
        { "deviceId": "PUMP_02", "nodeId": "ns=2;s=PUMP_02.Command", "dataType": "Boolean", "description": "Backup pump start/stop" }
      ]
    }
    ```

    **Station B (MỚI — 1 Modbus sensor + 1 pump status, 1 OPC UA pump):**
    ```json
    {
      "connectionId": "STATION_B",
      "protocol": "modbus",
      "description": "Trạm bơm B — cụm sensor",
      "host": "modbus-mock-b",
      "port": 502,
      "unitId": 1,
      "pollIntervalMs": 2000,
      "devices": [
        { "deviceId": "SENSOR_P_03", "register": 0, "length": 2, "dataType": "Float32", "wordOrder": "AB_CD", "unit": "bar", "description": "Station B inlet pressure" },
        { "deviceId": "PUMP_03_STATUS", "register": 2, "length": 1, "dataType": "UInt16", "wordOrder": "AB_CD", "unit": "", "description": "Pump 3 running status (0=OFF, 1=ON)" }
      ]
    },
    {
      "connectionId": "STATION_B_CMD",
      "protocol": "opcua",
      "description": "Trạm bơm B — điều khiển bơm",
      "endpoint": "opc.tcp://opcua-mock-b:4840",
      "devices": [
        { "deviceId": "PUMP_03", "nodeId": "ns=2;s=PUMP_03.Command", "dataType": "Boolean", "description": "Station B pump start/stop" }
      ]
    }
    ```
  - Notes: Station B có tổng 3 registers (2 cho Float32 + 1 cho UInt16 = register range [0..2]), pollIntervalMs = 2000 (khác Station A) để demo per-connection config.

- [x] **Task 1.3:** Cập nhật unit test device-map
  - File: `tests/unit/device-map.test.ts`
  - Action: Thay đổi assertions:
    - Verify `connections` là array, có 4 entries (2 Modbus + 2 OPC UA)
    - Mỗi connection có `connectionId`, `protocol`, `devices[]`
    - Modbus connections có `host`, `port`, `unitId`, `pollIntervalMs`
    - OPC UA connections có `endpoint`
    - Lookup `PUMP_01` tìm đúng connection `STATION_A_CMD`
    - Lookup `SENSOR_P_03` tìm đúng connection `STATION_B`
  - Notes: Xóa assertions cũ về `deviceMap.opcua` / `deviceMap.modbus`

- [x] **Task 1.4:** Unit test cho validation logic
  - File: `tests/unit/device-map-validation.test.ts` (TẠO MỚI)
  - Action: Import `validateDeviceMap` từ `device-map.schema.ts`, test:
    - Happy path: valid 4-connection config → trả về DeviceMap
    - Duplicate deviceId across connections → throw error chứa cả deviceId + 2 connectionIds
    - Missing `host` trên Modbus connection → throw error
    - Missing `endpoint` trên OPC UA connection → throw error
    - Unknown protocol → throw error
    - Empty connections array → throw error
    - Duplicate connectionId → throw error
  - Notes: Test validation function độc lập, không phụ thuộc vào device-map.json thật

---

#### Story 2: Refactor Protocol Clients — Dependency Injection

- [x] **Task 2.1:** Refactor ModbusClient — nhận reconnect config qua constructor
  - File: `src/telemetry/modbus-client.ts`
  - Action:
    - Thêm `connectionId` và `reconnectConfig` vào constructor:
      ```typescript
      constructor(
        connectionId: string,
        host: string,
        port: number,
        unitId: number,
        reconnectConfig: { baseMs: number, maxMs: number }
      )
      ```
    - Lưu `this.connectionId` và `this.reconnectConfig`
    - Xóa `import { gatewayConfig }` ở dòng 4
    - Trong `scheduleReconnect()`: thay `gatewayConfig.reconnectBaseMs` → `this.reconnectConfig.baseMs`, thay `gatewayConfig.reconnectMaxMs` → `this.reconnectConfig.maxMs`
    - Thay đổi logger: `logger.child({ module: 'modbus-client', connectionId })`
    - Thêm getter `getConnectionId(): string { return this.connectionId; }`
  - Notes: Breaking change cho constructor signature — caller (index.ts) sẽ update ở Task 4.1

- [x] **Task 2.2:** Refactor OpcuaClient — nhận reconnect config qua constructor
  - File: `src/command/opcua-client.ts`
  - Action:
    - Thêm `connectionId` và `reconnectConfig` vào constructor:
      ```typescript
      constructor(
        connectionId: string,
        endpoint: string,
        reconnectConfig: { baseMs: number, maxMs: number }
      )
      ```
    - Lưu `this.connectionId` và `this.reconnectConfig`
    - Xóa `import { gatewayConfig }` ở dòng 3
    - **QUAN TRỌNG — 2 chỗ cần thay thế:**
      1. **Constructor (dòng 27-35)** — `OPCUAClient.create()`:
         ```typescript
         this.client = OPCUAClient.create({
           applicationName: 'ProtocolTranslatorGateway',
           connectionStrategy: {
             initialDelay: this.reconnectConfig.baseMs,  // thay gatewayConfig.reconnectBaseMs
             maxDelay: this.reconnectConfig.maxMs,        // thay gatewayConfig.reconnectMaxMs
             maxRetry: 0,  // Giữ nguyên — tắt SDK reconnection, dùng logic custom
           },
           endpointMustExist: false,
         });
         ```
      2. **scheduleReconnect() (dòng 136-168)** — cả `OPCUAClient.create()` lặp lại VÀ delay calculation:
         ```typescript
         // dòng 139: thay gatewayConfig.reconnectBaseMs → this.reconnectConfig.baseMs
         // dòng 145-153: OPCUAClient.create() dùng this.reconnectConfig tương tự constructor
         // dòng 162: thay gatewayConfig.reconnectMaxMs → this.reconnectConfig.maxMs
         ```
    - Thay đổi logger: `logger.child({ module: 'opcua-client', connectionId })`
    - Thêm getter `getConnectionId(): string { return this.connectionId; }`
    - Ghi chú: `maxRetry: 0` nghĩa là tắt SDK built-in reconnection, gateway tự quản lý reconnection qua `scheduleReconnect()` với exponential backoff
  - Notes: Tương tự Task 2.1 nhưng có 2 chỗ dùng gatewayConfig (constructor + scheduleReconnect), không được bỏ sót

---

#### Story 3: Multi-Source Telemetry & Command Routing

- [x] **Task 3.1:** Mở rộng TelemetryPoller hỗ trợ connectionId
  - File: `src/telemetry/telemetry-poller.ts`
  - Action:
    - Thêm `connectionId` vào constructor:
      ```typescript
      constructor(
        connectionId: string,
        modbusClient: ModbusClient,
        devices: ModbusDevice[],
        pollIntervalMs: number,
      )
      ```
    - Thêm `connectionId` vào `TelemetryData` interface:
      ```typescript
      export interface TelemetryData {
        connectionId: string;  // MỚI
        deviceId: string;
        value: number;
        unit: string;
        description: string;
        timestamp: string;
      }
      ```
    - Trong `poll()`, khi tạo telemetry object, thêm `connectionId: this.connectionId`
    - Thêm `connectionId` vào log messages
  - Notes: Mỗi Modbus connection sẽ có 1 TelemetryPoller instance riêng. WsServer subscribe tất cả pollers.

- [x] **Task 3.2:** Refactor CommandHandler — multi-client auto-routing
  - File: `src/command/command-handler.ts`
  - Action:
    - Thay đổi constructor: nhận `routeMap` và `allDeviceIndex`:
      ```typescript
      constructor(
        routeMap: Map<string, { connectionId: string, client: OpcuaClient, device: OpcuaDevice }>,
        allDeviceIndex: Map<string, { connectionId: string, protocol: string }>,
      )
      ```
    - `handleCommand()` logic mới:
      1. Lookup `payload.deviceId` trong `routeMap` → nếu tìm thấy → gọi `entry.client.writeValue(entry.device.nodeId, value, entry.device.dataType)`
      2. Nếu KHÔNG tìm thấy trong `routeMap`, kiểm tra `allDeviceIndex`:
         - Nếu deviceId tồn tại trong `allDeviceIndex` nhưng protocol là `'modbus'` → throw error: `"Device ${deviceId} là Modbus telemetry-only (connection: ${connectionId}), không hỗ trợ command. Chỉ OPC UA devices mới nhận command."`
         - Nếu deviceId không tồn tại trong cả 2 maps → throw error: `"Device không tồn tại: ${deviceId}"`
    - Log thêm `connectionId` khi xử lý command
  - Notes: `routeMap` chỉ chứa OPC UA devices. `allDeviceIndex` chứa TẤT CẢ devices (Modbus + OPC UA) — dùng để phân biệt "device not found" vs "device exists but wrong protocol". Cả 2 maps được build trong index.ts.

---

#### Story 4: Gateway Bootstrap Multi-Connection

- [x] **Task 4.1:** Refactor index.ts — bootstrap N connections
  - File: `src/index.ts`
  - Action:
    - Import `validateDeviceMap`, `buildDeviceIndex` từ `device-map.schema.ts`
    - Load `device-map.json` → gọi `validateDeviceMap(raw)` (sẽ throw nếu invalid/duplicate deviceId)
    - Build `allDeviceIndex = buildDeviceIndex(deviceMap)`
    - Khai báo collections:
      ```typescript
      const modbusClients: Map<string, ModbusClient> = new Map();
      const opcuaClients: Map<string, OpcuaClient> = new Map();
      const telemetryPollers: TelemetryPoller[] = [];
      const connectionStatuses: ConnectionStatus[] = [];
      ```
    - **Loop qua `deviceMap.connections`:**
      - Nếu `protocol === 'modbus'`:
        ```typescript
        const client = new ModbusClient(conn.connectionId, conn.host, conn.port, conn.unitId, { baseMs: gatewayConfig.reconnectBaseMs, maxMs: gatewayConfig.reconnectMaxMs });
        const poller = new TelemetryPoller(conn.connectionId, client, conn.devices, conn.pollIntervalMs);
        modbusClients.set(conn.connectionId, client);
        telemetryPollers.push(poller);
        connectionStatuses.push({ connectionId: conn.connectionId, protocol: 'modbus', isConnected: () => client.isConnected() });
        ```
      - Nếu `protocol === 'opcua'`:
        ```typescript
        const client = new OpcuaClient(conn.connectionId, conn.endpoint, { baseMs: gatewayConfig.reconnectBaseMs, maxMs: gatewayConfig.reconnectMaxMs });
        opcuaClients.set(conn.connectionId, client);
        connectionStatuses.push({ connectionId: conn.connectionId, protocol: 'opcua', isConnected: () => client.isConnected() });
        ```
    - **Build command route map** từ tất cả OPC UA connections:
      ```typescript
      const commandRouteMap = new Map<string, { connectionId: string, client: OpcuaClient, device: OpcuaDevice }>();
      for (const conn of deviceMap.connections.filter(c => c.protocol === 'opcua')) {
        for (const device of conn.devices) {
          commandRouteMap.set(device.deviceId, { connectionId: conn.connectionId, client: opcuaClients.get(conn.connectionId)!, device });
        }
      }
      ```
    - **Kết nối events:** Mỗi ModbusClient:
      ```typescript
      client.on('connected', () => { poller.start(); });
      client.on('disconnected', () => { poller.stop(); });
      ```
    - **Connect tất cả clients** (non-blocking): loop modbusClients + opcuaClients, `.connect().catch(() => {})`
    - Tạo `CommandHandler(commandRouteMap, allDeviceIndex)`
    - Tạo `WsServer(gatewayConfig.wsPort, telemetryPollers)` — truyền array
    - Tạo `RestServer({ commandHandler, connections: connectionStatuses, deviceMap, startTime: Date.now() })`
    - **Graceful shutdown:** Loop stop tất cả pollers → disconnect tất cả modbusClients + opcuaClients → close wsServer + restServer
  - Notes: `gatewayConfig` chỉ còn giữ `restPort`, `wsPort`, `reconnectBaseMs`, `reconnectMaxMs`. `pollIntervalMs` lấy từ per-connection trong device-map.json.

- [x] **Task 4.2:** Cập nhật gateway.config.ts
  - File: `src/config/gateway.config.ts`
  - Action:
    - Xóa: `opcuaEndpoint`, `modbusHost`, `modbusPort`, `pollIntervalMs`
    - Giữ lại: `restPort`, `wsPort`, `reconnectBaseMs`, `reconnectMaxMs`
  - Notes: Env vars `OPCUA_ENDPOINT`, `MODBUS_HOST`, `MODBUS_PORT`, `POLL_INTERVAL_MS` không còn dùng
  - **DEPENDENCY:** Chỉ thực hiện task này SAU KHI Story 2 (Task 2.1, 2.2) và Task 4.1 hoàn tất. Nếu xóa trước → compile error vì clients vẫn import gatewayConfig.

---

#### Story 5: Transport Layer — Multi-Connection Support

- [x] **Task 5.1:** Cập nhật WsServer — subscribe nhiều pollers
  - File: `src/transport/ws-server.ts`
  - Action:
    - Thay đổi constructor parameter: `telemetryPollers: TelemetryPoller[]` thay vì `telemetryPoller: TelemetryPoller`
    - Loop subscribe 'telemetry' event từ tất cả pollers:
      ```typescript
      for (const poller of telemetryPollers) {
        poller.on('telemetry', (data: TelemetryData) => {
          const message = JSON.stringify(data);
          this.wss.clients.forEach((client) => {
            if (client.readyState === WebSocket.OPEN) {
              client.send(message);
            }
          });
        });
      }
      ```
  - Notes: Message format giống cũ nhưng có thêm field `connectionId` (từ Task 3.1). Client WebSocket không cần thay đổi.

- [x] **Task 5.2:** Cập nhật RestServer — health check multi-connection
  - File: `src/transport/rest-server.ts`
  - Action:
    - Thay đổi `RestServerDeps`:
      ```typescript
      export interface ConnectionStatus {
        connectionId: string;
        protocol: 'opcua' | 'modbus';
        isConnected: () => boolean;
      }
      export interface RestServerDeps {
        commandHandler: CommandHandler;
        connections: ConnectionStatus[];
        deviceMap: any;
        startTime?: number;
      }
      ```
    - Xóa `opcuaClient` và `modbusClient` khỏi deps
    - `GET /api/health` trả về:
      ```json
      {
        "connections": {
          "STATION_A": { "protocol": "modbus", "status": "connected" },
          "STATION_A_CMD": { "protocol": "opcua", "status": "connected" },
          "STATION_B": { "protocol": "modbus", "status": "disconnected" },
          "STATION_B_CMD": { "protocol": "opcua", "status": "connected" }
        },
        "uptime": 120
      }
      ```
    - `GET /api/devices` giữ nguyên — trả về toàn bộ device-map
    - `POST /api/command` logic giữ nguyên — `commandHandler.handleCommand()` đã xử lý error messages phân biệt rõ ràng (Task 3.2)
  - Notes: **BREAKING CHANGE** cho health check response format. Format cũ `{ opcua: "connected", modbus: "disconnected", uptime }` không còn. Client monitoring cần update.

---

#### Story 6: Mock Servers & Docker Compose (ATOMIC — thực hiện cùng lúc)

**QUAN TRỌNG:** Tasks 6.1-6.4 có dependency vòng (device-map.json hostnames ↔ docker-compose service names). Phải thực hiện và commit tất cả cùng lúc.

- [x] **Task 6.1:** Refactor Modbus Mock Server — data-driven simulation
  - File: `mock-servers/modbus-mock/server.ts`
  - Action:
    - Thêm env var `MODBUS_PORT` (default 502): `const PORT = parseInt(process.env.MODBUS_PORT || '502', 10);`
    - Thêm env var `STATION_PROFILE` (default `'full'`):
      - `'full'` (Station A): giữ nguyên 10 registers, 6 devices — logic `updateRegisters()` hiện tại
      - `'minimal'` (Station B): 3 registers — 1 pressure sensor (registers 0-1, Float32) + 1 pump status (register 2, UInt16)
    - Refactor `updateRegisters()` thành data-driven:
      ```typescript
      interface RegisterSimulation {
        offset: number;       // byte offset trong holding buffer
        type: 'float32';
        min: number;
        max: number;
      } | {
        offset: number;
        type: 'uint16';
        values: number[];     // random pick từ danh sách
      }

      const PROFILES: Record<string, { registerCount: number, simulations: RegisterSimulation[] }> = {
        full: {
          registerCount: 10,
          simulations: [
            { offset: 0, type: 'float32', min: 1.5, max: 3.5 },   // Pressure 1
            { offset: 4, type: 'float32', min: 1.0, max: 2.5 },   // Pressure 2 (CD_AB)
            { offset: 8, type: 'float32', min: 10.0, max: 50.0 },  // Flow
            { offset: 12, type: 'float32', min: 0.5, max: 5.0 },   // Level
            { offset: 16, type: 'uint16', values: [0, 1] },         // Pump 1
            { offset: 18, type: 'uint16', values: [0, 1] },         // Pump 2
          ],
        },
        minimal: {
          registerCount: 3,
          simulations: [
            { offset: 0, type: 'float32', min: 1.0, max: 4.0 },   // Pressure 3
            { offset: 4, type: 'uint16', values: [0, 1] },          // Pump 3
          ],
        },
      };
      ```
    - `updateRegisters()` loop qua `profile.simulations` thay vì hardcode offsets
    - Holding buffer size: `registerCount * 2` bytes
  - Notes: Cùng image Docker, khác behavior qua env var. Station A full profile dùng buffer giống hiện tại (20 bytes). Station B minimal profile dùng buffer 6 bytes (3 registers × 2). **Lưu ý:** Station A pressure 2 vẫn cần ghi theo CD_AB word order (low word trước) — giữ logic đảo word trong profile `full`.

- [x] **Task 6.2:** Refactor OPC UA Mock Server — dynamic node creation
  - File: `mock-servers/opcua-mock/server.ts`
  - Action:
    - Thêm env var `OPCUA_PORT` (default 4840): `const PORT = parseInt(process.env.OPCUA_PORT || '4840', 10);`
    - Thêm env var `PUMP_NODES` (default `'PUMP_01.Command,PUMP_02.Command'`): comma-separated list
    - Thay thế hardcoded node creation bằng dynamic loop:
      ```typescript
      const pumpNodes = (process.env.PUMP_NODES || 'PUMP_01.Command,PUMP_02.Command').split(',');

      for (const nodeName of pumpNodes) {
        const trimmed = nodeName.trim();
        // nodeId format: 's={nodeName}' — ví dụ: PUMP_03.Command → nodeId 's=PUMP_03.Command'
        // Trong namespace index 2 (WaterPumpStation), full nodeId: 'ns=2;s=PUMP_03.Command'
        const variable = namespace.addVariable({
          componentOf: pumpStation,
          browseName: trimmed,
          nodeId: `s=${trimmed}`,      // <-- format chuẩn
          dataType: 'Boolean',
          value: new Variant({ dataType: DataType.Boolean, value: false }),
        });
        logWrite(trimmed, variable);
      }
      ```
    - Namespace URI giữ nguyên `'urn:WaterPumpStation'` cho tất cả instances
    - `resourcePath` giữ nguyên `/UA/MockServer`
  - Notes: **nodeId format convention:** env var `PUMP_NODES=PUMP_03.Command` → `nodeId: 's=PUMP_03.Command'` trong ns=2. Gateway device-map phải dùng `"nodeId": "ns=2;s=PUMP_03.Command"` để khớp.

- [x] **Task 6.3:** Cập nhật Docker Compose & device-map.json cho multi-PLC demo
  - File: `docker-compose.yml` + `src/config/device-map.json`
  - Action:
    Docker Compose — 5 services:
    ```yaml
    services:
      opcua-mock-a:
        build:
          context: .
          dockerfile: mock-servers/opcua-mock/Dockerfile
        environment:
          - OPCUA_PORT=4840
          - PUMP_NODES=PUMP_01.Command,PUMP_02.Command
        networks:
          - iiot-net

      opcua-mock-b:
        build:
          context: .
          dockerfile: mock-servers/opcua-mock/Dockerfile
        environment:
          - OPCUA_PORT=4840
          - PUMP_NODES=PUMP_03.Command
        networks:
          - iiot-net

      modbus-mock-a:
        build:
          context: .
          dockerfile: mock-servers/modbus-mock/Dockerfile
        environment:
          - MODBUS_PORT=502
          - STATION_PROFILE=full
        networks:
          - iiot-net

      modbus-mock-b:
        build:
          context: .
          dockerfile: mock-servers/modbus-mock/Dockerfile
        environment:
          - MODBUS_PORT=502
          - STATION_PROFILE=minimal
        networks:
          - iiot-net

      gateway:
        build:
          context: .
          dockerfile: Dockerfile
        ports:
          - "3000:3000"
          - "3001:3001"
        environment:
          - REST_PORT=3000
          - WS_PORT=3001
          - LOG_LEVEL=info
        depends_on:
          - opcua-mock-a
          - opcua-mock-b
          - modbus-mock-a
          - modbus-mock-b
        networks:
          - iiot-net

    networks:
      iiot-net:
        driver: bridge
    ```
    device-map.json hostnames phải khớp Docker service names:
    - `STATION_A` modbus: `host: "modbus-mock-a"`, port 502
    - `STATION_A_CMD` opcua: `endpoint: "opc.tcp://opcua-mock-a:4840"`
    - `STATION_B` modbus: `host: "modbus-mock-b"`, port 502
    - `STATION_B_CMD` opcua: `endpoint: "opc.tcp://opcua-mock-b:4840"`
  - Notes: **BREAKING CHANGE** — service names đổi từ `opcua-mock` → `opcua-mock-a`, `modbus-mock` → `modbus-mock-a`. Mỗi mock service expose port nội bộ (502, 4840) — Docker network cho phép truy cập qua DNS hostname. Gateway không cần env vars connection — đọc từ device-map.json.

---

#### Story 7: Update Tests

- [x] **Task 7.1:** Cập nhật command flow integration test
  - File: `tests/integration/command-flow.test.ts`
  - Action:
    - Update setup: tạo `commandRouteMap` (Map) và `allDeviceIndex` (Map) thay vì single client + device array
    - Ví dụ setup mới:
      ```typescript
      const opcuaClient = new OpcuaClient('TEST_CMD', endpoint, { baseMs: 1000, maxMs: 5000 });
      const device = { deviceId: 'PUMP_01', nodeId: 'ns=2;s=PUMP_01.Command', dataType: 'Boolean', description: 'Test pump' };
      const routeMap = new Map([['PUMP_01', { connectionId: 'TEST_CMD', client: opcuaClient, device }]]);
      const deviceIndex = new Map([['PUMP_01', { connectionId: 'TEST_CMD', protocol: 'opcua' }]]);
      const handler = new CommandHandler(routeMap, deviceIndex);
      ```
    - Update WsServer instantiation: `new WsServer(wsPort, [poller])` — wrap single poller trong array
    - Update RestServer deps: `connections: [{ connectionId: 'TEST_CMD', protocol: 'opcua', isConnected: () => opcuaClient.isConnected() }]`
    - Test flow giữ nguyên — POST /api/command vẫn gửi `{ deviceId, action }`
  - Notes: Constructor signatures đã thay đổi ở Stories 2-5, test phải reflect.

- [x] **Task 7.2:** Cập nhật telemetry integration test
  - File: `tests/integration/telemetry-flow.test.ts`
  - Action:
    - Update setup: tạo ModbusClient và TelemetryPoller với constructor mới:
      ```typescript
      const modbusClient = new ModbusClient('TEST_STATION', host, port, unitId, { baseMs: 1000, maxMs: 5000 });
      const poller = new TelemetryPoller('TEST_STATION', modbusClient, devices, 1000);
      const wsServer = new WsServer(wsPort, [poller]);  // array!
      ```
    - Verify telemetry message có thêm `connectionId` field: `expect(data.connectionId).toBe('TEST_STATION')`
    - Update RestServer deps tương tự Task 7.1
  - Notes: WsServer nhận `TelemetryPoller[]` — phải wrap trong array ngay cả khi chỉ có 1 poller.

---

### Acceptance Criteria

#### AC 1: Multi-Connection Config — Happy Path
- [ ] Given `device-map.json` có 4 connections (2 OPC UA + 2 Modbus), when gateway khởi động, then gateway validate schema thành công, tạo đúng 4 client instances, và log danh sách connections

#### AC 2: deviceId Uniqueness Validation
- [ ] Given `device-map.json` có 2 connections chứa device cùng `deviceId: "PUMP_01"`, when gateway khởi động, then `validateDeviceMap()` throw error chỉ rõ deviceId trùng VÀ 2 connectionIds chứa nó

#### AC 3: Config Schema Validation
- [ ] Given `device-map.json` có Modbus connection thiếu `host`, when gateway khởi động, then `validateDeviceMap()` throw error rõ ràng chỉ ra field thiếu

#### AC 4: Command Auto-Routing — Cross-Connection
- [ ] Given gateway đã kết nối 2 OPC UA servers (Station A + B), when POST `/api/command` với `{"deviceId":"PUMP_03","action":"START"}`, then gateway tự route command tới đúng OPC UA server Station B (không phải Station A)

#### AC 5: Command Auto-Routing — API Backward Compatible
- [ ] Given gateway multi-PLC, when POST `/api/command` với `{"deviceId":"PUMP_01","action":"START"}` (giống API cũ, không thêm field), then command thành công — REST API interface không đổi

#### AC 6: Command Routing — Modbus Device Error
- [ ] Given gateway multi-PLC, when POST `/api/command` với `{"deviceId":"SENSOR_P_01","action":"START"}` (Modbus telemetry device), then response 400 với message phân biệt rõ: device tồn tại nhưng là Modbus telemetry-only, không hỗ trợ command

#### AC 7: Telemetry Multi-Source — connectionId Tag
- [ ] Given 2 Modbus pollers đang chạy (Station A + B), when WebSocket client connected, then mỗi telemetry message có `connectionId` field (ví dụ: `"connectionId": "STATION_A"` hoặc `"STATION_B"`)

#### AC 8: Telemetry Multi-Source — All Connections Stream
- [ ] Given 2 Modbus connections với tổng 8 devices, when poll cycle hoàn tất, then WS client nhận telemetry messages từ CẢ 2 connections trong cùng 1 stream

#### AC 9: Independent Reconnection
- [ ] Given Station A Modbus bị ngắt nhưng Station B vẫn connected, when poll cycle chạy, then Station A poller dừng (log error), Station B poller vẫn tiếp tục bình thường, và Station A tự reconnect độc lập

#### AC 10: Health Check Multi-Connection
- [ ] Given gateway đang chạy với 4 connections, when GET `/api/health`, then response JSON hiển thị trạng thái từng connection riêng biệt: `{ "connections": { "STATION_A": {...}, ... }, "uptime": N }`

#### AC 11: Docker Compose Multi-PLC Demo
- [ ] Given Docker installed, when chạy `docker-compose up`, then 5 services khởi động (gateway + 2 opcua-mocks + 2 modbus-mocks), gateway kết nối được tới tất cả 4 mock servers

#### AC 12: Graceful Shutdown Multi-Connection
- [ ] Given gateway đang chạy với nhiều connections, when SIGINT, then gateway dừng TẤT CẢ pollers, đóng TẤT CẢ connections, đóng servers, exit clean (exit code 0)

## Additional Context

### Dependencies

| Package | Version | Purpose |
|---|---|---|
| `node-opcua` | ^2.x | OPC UA Client + Mock Server |
| `modbus-serial` | ^8.x | Modbus TCP Client |
| `jsmodbus` | ^4.x | Modbus TCP Mock Server |
| `express` | ^4.x | REST API framework |
| `ws` | ^8.x | WebSocket server |
| `pino` | ^9.x | Structured logging |
| `vitest` | ^2.x | Testing framework |

Không cần thêm dependency mới — tất cả thay đổi dùng libraries hiện có.

### Testing Strategy

- **Unit tests:**
  - `device-map.test.ts` — validate schema mới, connection lookup
  - `device-map-validation.test.ts` — validateDeviceMap() happy path + 6 negative cases (duplicate deviceId, missing fields, unknown protocol, etc.)
- **Integration tests:**
  - `command-flow.test.ts` — cross-connection routing, Modbus device error message
  - `telemetry-flow.test.ts` — multi-source stream, connectionId verification
- **Manual smoke test:** `docker-compose up` → curl commands tới PUMP_01 (Station A) và PUMP_03 (Station B) → verify WS telemetry từ cả 2 stations

### Notes

**High-risk items:**
- Constructor signature changes cho ModbusClient/OpcuaClient — breaking change, cần update tất cả callers cùng lúc
- `index.ts` refactor lớn — nhiều logic mới (connection loop, route map build, multi-subscription)
- deviceId collision detection — phải validate TRƯỚC khi bắt đầu connect, không phải sau
- OpcuaClient có 2 chỗ dùng gatewayConfig (constructor + scheduleReconnect) — dễ bỏ sót 1 chỗ
- Task 4.2 phải thực hiện CUỐI CÙNG trong Story 2-4 chain, nếu không sẽ compile error

**Breaking changes:**
- Health check API response format: `{ opcua, modbus, uptime }` → `{ connections: {...}, uptime }`
- Docker Compose service names: `opcua-mock` → `opcua-mock-a`, `modbus-mock` → `modbus-mock-a`

**Known limitations:**
- `reconnectBaseMs`/`reconnectMaxMs` là global defaults — chưa support per-connection override (có thể thêm sau)
- `pollIntervalMs` là per-connection (từ device-map.json)
- Command routing chỉ hỗ trợ OPC UA devices — Modbus devices là telemetry-only
- Modbus polling vẫn sequential per connection — chưa support multiple unitIds trên cùng 1 TCP connection
- Không có metrics/monitoring per connection (Prometheus, etc.)

**Future considerations (out of scope):**
- Per-connection reconnect config override
- WebSocket topics/channels per connectionId
- Dynamic connection management (add/remove via API)
- Connection groups / station hierarchy
- Modbus write command support

## Review Notes

### Spec Adversarial Review
- Adversarial review hoàn tất: 13 findings
- Đã fix: 13/13 (F1–F13)
- Resolution: Auto-fix
- F1 (Critical): Modbus mock refactor — thay REGISTER_COUNT bằng STATION_PROFILE data-driven approach
- F2 (High): OPC UA mock — explicit nodeId format convention (`s={nodeName}` trong ns=2)
- F3 (High): Clarify pollIntervalMs per-connection vs reconnect global
- F4 (High): Thêm TypeScript interfaces + validateDeviceMap() + Task 1.1/1.4
- F5 (Medium): WsServer — explicit array wrapping trong test guidance
- F6 (Medium): Command routing — phân biệt "not found" vs "Modbus telemetry-only" + AC 6
- F7 (Medium): Merge Tasks 6.3/6.4 thành atomic task
- F8 (Medium): Thêm Task 1.4 — unit test validation logic với negative cases
- F9 (Medium): Explicit dependency ordering + warning cho Task 4.2
- F10 (Medium): Health check breaking change acknowledged trong notes + Task 5.2
- F11 (Low): Integration test Tasks 7.1/7.2 — thêm setup code examples
- F12 (High): OpcuaClient — explicit replacement pattern cho cả constructor + scheduleReconnect
- F13 (Medium): Station B — concrete device entries, reconcile thành 1 sensor + 1 pump status + 1 OPC UA pump

### Code Adversarial Review
- Adversarial review completed
- Findings: 13 total, 12 fixed, 1 skipped (acknowledged as future work)
- Resolution approach: auto-fix
- F1 (Critical): `__dirname` → `import.meta.dirname` for ESM compatibility
- F2 (High): Hardcoded `registerCount` in mock → auto-derived via `calcRegisterCount()`
- F3 (High): No device-level field validation → added `validateModbusDevice()` and `validateOpcuaDevice()`
- F4 (High): Unsafe `as string` cast → added proper `typeof` checks
- F5 (High): Sequential shutdown could hang → `Promise.allSettled` + 10s force-exit timeout
- F6 (Medium): Fragile substring error matching → `CommandValidationError` class with `instanceof`
- F7 (Medium): `deviceMap: any` → `DeviceMap` typed, pass validated object
- F8 (Medium): Silent `.catch(() => {})` on connect → added warning logs
- F9 (Medium): No env var override for connection endpoints → SKIPPED (acknowledged as known limitation/future work)
- F10 (Medium): Logger side-effect in validation → removed logger import from schema module
- F11 (Medium): `raw as DeviceMap` type assertion → constructs new validated objects
- F12 (Low): Duplicate `ReconnectConfig` interface → extracted to shared `device-map.schema.ts`
- F13 (Low): Missing health endpoint tests → created `rest-health.test.ts`
