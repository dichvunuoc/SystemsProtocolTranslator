---
title: 'Protocol Translator Edge Gateway for Water Pump Station'
slug: 'protocol-translator-edge-gateway'
created: '2026-03-12'
status: 'completed'
stepsCompleted: [1, 2, 3, 4]
tech_stack: ['TypeScript', 'Node.js', 'node-opcua', 'modbus-serial', 'jsmodbus', 'Express', 'ws', 'pino', 'vitest', 'Docker']
files_to_modify:
  - 'src/index.ts'
  - 'src/config/device-map.json'
  - 'src/config/gateway.config.ts'
  - 'src/command/command-handler.ts'
  - 'src/command/opcua-client.ts'
  - 'src/telemetry/telemetry-poller.ts'
  - 'src/telemetry/modbus-client.ts'
  - 'src/telemetry/register-parser.ts'
  - 'src/transport/rest-server.ts'
  - 'src/transport/ws-server.ts'
  - 'src/utils/logger.ts'
  - 'mock-servers/opcua-mock/server.ts'
  - 'mock-servers/modbus-mock/server.ts'
  - 'docker-compose.yml'
  - 'Dockerfile'
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
  - 'Unit tests for device-map lookup'
  - 'Integration tests with mock servers'
---

# Tech-Spec: Protocol Translator Edge Gateway for Water Pump Station

**Created:** 2026-03-12

## Overview

### Problem Statement

Hệ thống giám sát và điều khiển trạm bơm nước cần một lớp middleware chuyển đổi hai chiều giữa giao thức Web (REST/WebSocket/JSON) và giao thức công nghiệp (OPC UA / Modbus TCP). Hiện chưa có bridge nào kết nối hai thế giới này — dẫn đến không thể điều khiển thiết bị từ ứng dụng web hoặc nhận dữ liệu sensor real-time trên dashboard.

### Solution

Xây dựng một Node.js/TypeScript Edge Gateway gồm 3 module chính:
1. **Command Handler** — REST API → OPC UA Write (điều khiển bơm)
2. **Telemetry Poller** — Modbus TCP Read → WebSocket Push (giám sát sensor)
3. **Device Mapping Dictionary** — Config-driven tag list (`device-map.json`), không hardcode địa chỉ vật lý

Kèm theo mock servers (OPC UA + Modbus TCP) chạy trong Docker Compose để demo/test tức thì.

### Scope

**In Scope:**
- OPC UA Client (`node-opcua`) — write commands tới server (`opc.tcp://127.0.0.1:4840`)
- Modbus TCP Client (`modbus-serial`) — polling Holding Registers từ simulator (`127.0.0.1:502`, Unit ID 1)
- Float32 parsing từ 2 thanh ghi 16-bit liên tiếp với hỗ trợ Word Swap / Endianness config (AB CD / CD AB / BA DC / DC BA)
- `device-map.json` — tag list chuẩn trạm bơm (Pump ON/OFF, Pressure, Flow Rate, Water Level)
- REST API nhận command (Express)
- WebSocket server đẩy telemetry real-time
- Reconnection logic cho cả OPC UA và Modbus
- I/O logging cho debug
- OPC UA Mock Server nội bộ để dev/test
- Modbus TCP Mock Server (`jsmodbus`) chạy song song trong docker-compose
- Docker Compose — `docker-compose up` khởi chạy đủ 3 services (Gateway + OPC UA Mock + Modbus Mock)

**Out of Scope:**
- Frontend/Dashboard UI
- Authentication/Authorization
- Database persistence
- MQTT / Message Broker integration
- Multi-site / multi-gateway orchestration
- Production hardening (TLS, certificate management)

## Context for Development

### Architecture — Data Flow

```
┌─────────────────────────────────────────────────────────────────┐
│                    Docker Network: iiot-net                      │
│                                                                 │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────────┐  │
│  │ opcua-mock   │    │ modbus-mock  │    │    gateway        │  │
│  │ :4840        │    │ :502         │    │ REST  :3000       │  │
│  │              │    │              │    │ WS    :3001       │  │
│  └──────┬───────┘    └──────┬───────┘    └──┬────┬──────────┘  │
│         │                   │               │    │              │
│         │   OPC UA TCP      │  Modbus TCP   │    │  WebSocket   │
│         └───────────────────┼───────────────┘    │              │
│                             │                    │              │
└─────────────────────────────┼────────────────────┼──────────────┘
                              │                    │
                    Polling (setInterval)     Push telemetry
                              │                    │
                              ▼                    ▼
                         Sensors/PLCs        Web Dashboard
```

**Command Flow (Write Path):**
```
HTTP POST /api/command ──► CommandHandler ──► device-map lookup
  {"deviceId":"PUMP_01",      │                    │
   "action":"START"}          │              nodeId: "ns=2;s=PUMP_01.Command"
                              │                    │
                              ▼                    ▼
                         OPC UA Client ──► OPC UA Server (Mock)
                         session.write(nodeId, value)
```

**Telemetry Flow (Read Path):**
```
Modbus Mock (Holding Registers)
       │
       ▼  setInterval polling
TelemetryPoller ──► modbus.readHoldingRegisters(addr, count)
       │
       ▼  Buffer parse with word order config
  Parse raw bytes → Float32 / UInt16
       │
       ▼  device-map lookup (register → deviceId + unit)
  {"deviceId":"SENSOR_P_01", "pressure": 2.5, "unit": "bar", "timestamp": "..."}
       │
       ▼  EventEmitter → WebSocket broadcast
  WS Server :3001 ──► All connected clients
```

### Project Structure

```
SystemsProtocolTranslator/
├── src/
│   ├── index.ts                    # Main entry — bootstrap all modules
│   ├── config/
│   │   ├── device-map.json         # Tag list — device mapping dictionary
│   │   └── gateway.config.ts       # Connection params, polling interval, ports
│   ├── command/
│   │   ├── command-handler.ts      # REST endpoint → OPC UA write
│   │   └── opcua-client.ts         # OPC UA client with reconnection logic
│   ├── telemetry/
│   │   ├── telemetry-poller.ts     # Modbus polling loop + data transform
│   │   ├── modbus-client.ts        # Modbus TCP client with reconnection
│   │   └── register-parser.ts      # Buffer → Float32 with word order support
│   ├── transport/
│   │   ├── rest-server.ts          # Express REST API
│   │   └── ws-server.ts            # WebSocket broadcast server
│   └── utils/
│       └── logger.ts               # Structured logging (pino)
├── mock-servers/
│   ├── opcua-mock/
│   │   ├── Dockerfile
│   │   └── server.ts               # OPC UA mock server (node-opcua)
│   └── modbus-mock/
│       ├── Dockerfile
│       └── server.ts               # Modbus TCP mock server (jsmodbus)
├── tests/
│   ├── unit/
│   │   ├── register-parser.test.ts
│   │   └── device-map.test.ts
│   └── integration/
│       ├── command-flow.test.ts
│       └── telemetry-flow.test.ts
├── docker-compose.yml              # 3 services: gateway, opcua-mock, modbus-mock
├── Dockerfile                      # Gateway container
├── package.json
├── tsconfig.json
├── vitest.config.ts
└── .env.example
```

### Codebase Patterns

- **Greenfield project** — Clean Slate confirmed, không có legacy constraints
- TypeScript strict mode
- Modular architecture: mỗi protocol handler là một module độc lập
- Config-driven: device mapping qua JSON, không hardcode
- Event-driven: Telemetry sử dụng EventEmitter pattern nội bộ, đẩy ra WebSocket
- Reconnection: Exponential backoff (1s → 2s → 4s → ... max 30s) cho cả OPC UA và Modbus
- **Ngôn ngữ code:** Tất cả log messages và code comments phải viết bằng **tiếng Việt**

### Device Map Schema (device-map.json)

```json
{
  "opcua": {
    "endpoint": "opc.tcp://opcua-mock:4840",
    "devices": [
      {
        "deviceId": "PUMP_01",
        "nodeId": "ns=2;s=PUMP_01.Command",
        "dataType": "Boolean",
        "description": "Main pump start/stop"
      },
      {
        "deviceId": "PUMP_02",
        "nodeId": "ns=2;s=PUMP_02.Command",
        "dataType": "Boolean",
        "description": "Backup pump start/stop"
      }
    ]
  },
  "modbus": {
    "host": "modbus-mock",
    "port": 502,
    "unitId": 1,
    "pollIntervalMs": 1000,
    "devices": [
      {
        "deviceId": "SENSOR_P_01",
        "register": 0,
        "length": 2,
        "dataType": "Float32",
        "wordOrder": "AB_CD",
        "unit": "bar",
        "description": "Inlet pressure"
      },
      {
        "deviceId": "SENSOR_P_02",
        "register": 2,
        "length": 2,
        "dataType": "Float32",
        "wordOrder": "CD_AB",
        "unit": "bar",
        "description": "Outlet pressure"
      },
      {
        "deviceId": "SENSOR_F_01",
        "register": 4,
        "length": 2,
        "dataType": "Float32",
        "wordOrder": "AB_CD",
        "unit": "m3/h",
        "description": "Flow rate"
      },
      {
        "deviceId": "SENSOR_L_01",
        "register": 6,
        "length": 2,
        "dataType": "Float32",
        "wordOrder": "AB_CD",
        "unit": "m",
        "description": "Water level"
      },
      {
        "deviceId": "PUMP_01_STATUS",
        "register": 8,
        "length": 1,
        "dataType": "UInt16",
        "wordOrder": "AB_CD",
        "unit": "",
        "description": "Pump 1 running status (0=OFF, 1=ON)"
      },
      {
        "deviceId": "PUMP_02_STATUS",
        "register": 9,
        "length": 1,
        "dataType": "UInt16",
        "wordOrder": "AB_CD",
        "unit": "",
        "description": "Pump 2 running status (0=OFF, 1=ON)"
      }
    ]
  }
}
```

**Word Order Options:**
- `AB_CD` — Big-Endian (default)
- `CD_AB` — Little-Endian Word Swap (phổ biến nhất với đồng hồ nước)
- `BA_DC` — Byte Swap
- `DC_BA` — Little-Endian

### Docker Compose Network

- Network `iiot-net` (bridge) kết nối 3 services
- Gateway truy cập mock servers qua Docker DNS hostname: `opcua-mock:4840`, `modbus-mock:502`
- Gateway expose ra host: `localhost:3000` (REST), `localhost:3001` (WebSocket)
- Mock servers chỉ visible trong Docker network — không expose ra host

### Technical Decisions

- **OPC UA Client:** `node-opcua` — thư viện OPC UA mature nhất cho Node.js
- **Modbus Client:** `modbus-serial` — hỗ trợ Modbus TCP, RTU, đơn giản, phổ biến
- **Modbus Mock Server:** `jsmodbus` — chạy Modbus TCP slave giả lập
- **REST Framework:** Express — lightweight, phổ biến, đủ cho Edge Gateway
- **WebSocket:** `ws` — native WebSocket server cho Node.js
- **Logging:** `pino` — nhanh hơn winston 5x, JSON native, phù hợp Docker logs
- **Testing:** `vitest` — TypeScript native, nhanh, không cần babel
- **Reconnection:** Exponential backoff cho cả OPC UA và Modbus connections
- **Float32 Endianness:** 4 word order variants cover mọi sensor/đồng hồ thực tế

## Implementation Plan

### Tasks

Tasks được sắp xếp theo thứ tự dependency — layer thấp nhất trước.

---

#### Story 1: Project Scaffolding & Configuration

- [x] **Task 1.1:** Khởi tạo project Node.js/TypeScript
  - File: `package.json`
  - Action: `npm init`, thêm dependencies (node-opcua, modbus-serial, jsmodbus, express, ws, pino), devDependencies (typescript, tsx, vitest, @types/express, @types/ws)
  - Notes: Engine node >= 18

- [x] **Task 1.2:** Cấu hình TypeScript
  - File: `tsconfig.json`
  - Action: Tạo tsconfig strict mode, target ES2022, module NodeNext, outDir ./dist
  - Notes: Bật strict, resolveJsonModules, esModuleInterop

- [x] **Task 1.3:** Tạo logger utility
  - File: `src/utils/logger.ts`
  - Action: Export pino instance với config: level từ env `LOG_LEVEL` (default: 'info'), transport pretty cho dev
  - Notes: Mỗi module sẽ tạo child logger với name riêng: `logger.child({ module: 'opcua-client' })`

- [x] **Task 1.4:** Tạo gateway config
  - File: `src/config/gateway.config.ts`
  - Action: Export typed config object đọc từ env vars với defaults:
    - `OPCUA_ENDPOINT` → default `opc.tcp://localhost:4840`
    - `MODBUS_HOST` → default `localhost`
    - `MODBUS_PORT` → default `502`
    - `REST_PORT` → default `3000`
    - `WS_PORT` → default `3001`
    - `POLL_INTERVAL_MS` → default `1000`
    - `RECONNECT_BASE_MS` → default `1000`
    - `RECONNECT_MAX_MS` → default `30000`
  - Notes: Config override env vars > device-map.json defaults

- [x] **Task 1.5:** Tạo device map
  - File: `src/config/device-map.json`
  - Action: Tạo file JSON với full tag list trạm bơm (2 pumps OPC UA + 6 Modbus devices) như schema ở trên
  - Notes: Đây là single source of truth cho tất cả device addresses

- [x] **Task 1.6:** Tạo .env.example
  - File: `.env.example`
  - Action: Liệt kê tất cả env vars với giá trị mẫu

---

#### Story 2: Register Parser (Core Logic — No External Dependencies)

- [x] **Task 2.1:** Implement register parser
  - File: `src/telemetry/register-parser.ts`
  - Action: Tạo function `parseRegisters(registers: number[], dataType: string, wordOrder: string): number`
    - Input: Mảng raw register values (UInt16[]), dataType ('Float32' | 'UInt16'), wordOrder ('AB_CD' | 'CD_AB' | 'BA_DC' | 'DC_BA')
    - Xử lý Float32: Allocate Buffer 4 bytes, ghi 2 registers vào buffer theo wordOrder, readFloatBE()
    - Xử lý UInt16: Trả về registers[0] trực tiếp
    - Log raw bytes và parsed value ở debug level
  - Notes: Đây là core logic quan trọng nhất — phải test kỹ 4 word orders

- [x] **Task 2.2:** Unit test register parser
  - File: `tests/unit/register-parser.test.ts`
  - Action: Test cases:
    - Float32 AB_CD: registers [0x40A0, 0x0000] → 5.0
    - Float32 CD_AB: registers [0x0000, 0x40A0] → 5.0
    - Float32 BA_DC: registers [0xA040, 0x0000] → 5.0
    - Float32 DC_BA: registers [0x0000, 0xA040] → 5.0
    - UInt16: registers [1] → 1
    - UInt16: registers [0] → 0
    - Edge case: registers rỗng → throw error
  - Notes: Tính toán byte values chính xác cho IEEE 754 float 5.0 = 0x40A00000

---

#### Story 3: Modbus Client & Telemetry Poller

- [x] **Task 3.1:** Implement Modbus TCP client wrapper
  - File: `src/telemetry/modbus-client.ts`
  - Action: Class `ModbusClient` với:
    - `connect()`: Kết nối TCP tới host:port, set unitId
    - `readHoldingRegisters(addr, length)`: Đọc registers, return number[]
    - `disconnect()`: Đóng connection
    - Reconnection logic: exponential backoff, emit 'connected' / 'disconnected' events
    - Log mọi connect/disconnect/error/read operations
  - Notes: Extends EventEmitter. Khi connection lost, tự động reconnect trong background

- [x] **Task 3.2:** Implement Telemetry Poller
  - File: `src/telemetry/telemetry-poller.ts`
  - Action: Class `TelemetryPoller` extends EventEmitter:
    - Constructor: nhận ModbusClient instance + device map (Modbus devices array)
    - `start()`: setInterval polling tất cả devices theo pollIntervalMs
    - Mỗi poll cycle: Đọc tất cả registers cần thiết trong 1 batch read (tính min/max register range)
    - Parse từng device dùng `register-parser.ts`
    - Emit event `'telemetry'` với payload: `{ deviceId, value, unit, description, timestamp }`
    - `stop()`: clearInterval
    - Error handling: Nếu read fail, log error, skip cycle, không crash
  - Notes: Batch read tối ưu — đọc 1 lần range [0..9] thay vì đọc từng device riêng lẻ

- [x] **Task 3.3:** Vitest config
  - File: `vitest.config.ts`
  - Action: Tạo vitest config cơ bản, include tests/**/*.test.ts

---

#### Story 4: OPC UA Client & Command Handler

- [x] **Task 4.1:** Implement OPC UA client wrapper
  - File: `src/command/opcua-client.ts`
  - Action: Class `OpcuaClient` với:
    - `connect()`: Tạo OPCUAClient, connect tới endpoint, tạo session
    - `writeValue(nodeId: string, value: any, dataType: string)`: session.write() tới nodeId
    - `disconnect()`: Đóng session + client
    - Reconnection logic: exponential backoff khi session lost
    - Log mọi connect/disconnect/write/error operations
  - Notes: node-opcua có built-in reconnection nhưng cần wrap thêm logic cho session recovery

- [x] **Task 4.2:** Implement Command Handler
  - File: `src/command/command-handler.ts`
  - Action: Class `CommandHandler`:
    - Constructor: nhận OpcuaClient instance + device map (OPC UA devices array)
    - `handleCommand(payload: { deviceId: string, action: string })`:
      - Lookup deviceId trong device map → lấy nodeId + dataType
      - Map action → value: 'START' → true, 'STOP' → false (cho Boolean)
      - Gọi opcuaClient.writeValue(nodeId, value, dataType)
      - Return { success: boolean, message: string }
    - Validation: deviceId không tồn tại → throw error, action không hợp lệ → throw error
    - Log command request + response
  - Notes: Hiện tại chỉ hỗ trợ Boolean commands. Mở rộng dataType sau nếu cần

---

#### Story 5: Transport Layer (REST + WebSocket)

- [x] **Task 5.1:** Implement REST server
  - File: `src/transport/rest-server.ts`
  - Action: Express app với:
    - `POST /api/command` — body: `{ deviceId, action }` → CommandHandler.handleCommand()
      - 200: `{ success: true, message: "..." }`
      - 400: validation error (missing fields, unknown deviceId)
      - 500: OPC UA write error (connection lost, timeout)
    - `GET /api/health` — return gateway status (OPC UA connected?, Modbus connected?, uptime)
    - `GET /api/devices` — return device map (danh sách tất cả devices)
    - JSON body parser, error handling middleware
    - Log mọi request/response
  - Notes: Không cần CORS vì chưa có frontend (out of scope)

- [x] **Task 5.2:** Implement WebSocket server
  - File: `src/transport/ws-server.ts`
  - Action: Class `WsServer`:
    - Tạo ws.Server trên WS_PORT
    - Subscribe vào TelemetryPoller 'telemetry' event
    - Broadcast JSON message tới tất cả connected clients
    - Handle client connect/disconnect, log connection count
    - Heartbeat ping/pong mỗi 30s để detect dead connections
  - Notes: Client chỉ cần connect WebSocket và listen — không cần gửi gì

---

#### Story 6: Mock Servers

- [x] **Task 6.1:** Implement OPC UA Mock Server
  - File: `mock-servers/opcua-mock/server.ts`
  - Action: Tạo OPC UA Server bằng node-opcua:
    - Port 4840, endpoint `/UA/MockServer`
    - Address space: Namespace "WaterPumpStation" (ns=2)
    - Nodes matching device-map.json OPC UA devices:
      - `ns=2;s=PUMP_01.Command` (Boolean, writable)
      - `ns=2;s=PUMP_02.Command` (Boolean, writable)
    - Log mọi write operations nhận được (để verify command flow)
  - Notes: Chạy standalone, không import từ gateway code

- [x] **Task 6.2:** Implement Modbus TCP Mock Server
  - File: `mock-servers/modbus-mock/server.ts`
  - Action: Tạo Modbus TCP Server bằng jsmodbus:
    - Listen port 502, Unit ID 1
    - Holding registers [0..9] — matching device-map.json
    - setInterval mỗi 2s: update register values với simulated data
      - Registers 0-1 (Pressure 1): random Float32 1.5–3.5 bar
      - Registers 2-3 (Pressure 2): random Float32 1.0–2.5 bar
      - Registers 4-5 (Flow rate): random Float32 10.0–50.0 m3/h
      - Registers 6-7 (Water level): random Float32 0.5–5.0 m
      - Register 8 (Pump 1 status): 0 or 1
      - Register 9 (Pump 2 status): 0 or 1
    - Helper function: Float32 → 2 registers (AB_CD word order)
    - Log register updates
  - Notes: Simulated values vary mỗi cycle để telemetry có dữ liệu thay đổi

- [x] **Task 6.3:** Mock server Dockerfiles
  - File: `mock-servers/opcua-mock/Dockerfile`
  - File: `mock-servers/modbus-mock/Dockerfile`
  - Action: Multi-stage build: install deps → compile TS → run with node
  - Notes: Base image `node:20-alpine`

---

#### Story 7: Main Entry & Docker Compose

- [x] **Task 7.1:** Implement main entry point
  - File: `src/index.ts`
  - Action: Bootstrap sequence:
    1. Load config (gateway.config.ts + device-map.json)
    2. Init logger
    3. Init ModbusClient → connect
    4. Init OpcuaClient → connect
    5. Init TelemetryPoller(modbusClient, deviceMap) → start
    6. Init CommandHandler(opcuaClient, deviceMap)
    7. Init WsServer → subscribe telemetry events
    8. Init RestServer(commandHandler) → listen
    9. Log "Gateway started" với all connection statuses
    10. Graceful shutdown handler: SIGINT/SIGTERM → stop poller, disconnect clients, close servers
  - Notes: Startup phải tolerant — nếu Modbus/OPC UA chưa ready, gateway vẫn start và reconnect trong background

- [x] **Task 7.2:** Gateway Dockerfile
  - File: `Dockerfile`
  - Action: Multi-stage build: install → compile → run. Expose ports 3000, 3001

- [x] **Task 7.3:** Docker Compose
  - File: `docker-compose.yml`
  - Action: 3 services trên network `iiot-net`:
    - `opcua-mock`: build mock-servers/opcua-mock, expose internal 4840
    - `modbus-mock`: build mock-servers/modbus-mock, expose internal 502
    - `gateway`: build ., ports 3000:3000 + 3001:3001, depends_on [opcua-mock, modbus-mock], env vars pointing to mock hostnames
  - Notes: `docker-compose up` phải work ngay lập tức

- [x] **Task 7.4:** Tạo npm scripts
  - File: `package.json` (update)
  - Action: Thêm scripts:
    - `dev`: `tsx src/index.ts` (chạy local không Docker)
    - `build`: `tsc`
    - `start`: `node dist/index.js`
    - `test`: `vitest run`
    - `test:watch`: `vitest`
    - `mock:opcua`: `tsx mock-servers/opcua-mock/server.ts`
    - `mock:modbus`: `tsx mock-servers/modbus-mock/server.ts`

---

#### Story 8: Integration Testing

- [x] **Task 8.1:** Integration test — Command flow
  - File: `tests/integration/command-flow.test.ts`
  - Action: Test end-to-end: POST /api/command → OPC UA mock nhận write
    - Given: OPC UA mock server đang chạy, gateway connected
    - When: POST `{ deviceId: "PUMP_01", action: "START" }`
    - Then: Response 200, mock server log nhận được write(ns=2;s=PUMP_01.Command, true)

- [x] **Task 8.2:** Integration test — Telemetry flow
  - File: `tests/integration/telemetry-flow.test.ts`
  - Action: Test end-to-end: Modbus mock → Gateway → WebSocket client
    - Given: Modbus mock đang chạy, gateway polling, WS client connected
    - When: Poll cycle hoàn tất
    - Then: WS client nhận JSON message với deviceId, value, unit, timestamp

### Acceptance Criteria

#### AC 1: Command Flow — Happy Path
- [ ] Given gateway đã kết nối OPC UA server, when POST `/api/command` với `{"deviceId":"PUMP_01","action":"START"}`, then response 200 và OPC UA server nhận write value `true` tại nodeId `ns=2;s=PUMP_01.Command`

#### AC 2: Command Flow — Unknown Device
- [ ] Given gateway đang hoạt động, when POST `/api/command` với `{"deviceId":"UNKNOWN","action":"START"}`, then response 400 với message chỉ rõ device không tồn tại

#### AC 3: Command Flow — Connection Lost
- [ ] Given OPC UA server bị ngắt kết nối, when POST `/api/command`, then response 500 với error message rõ ràng, và gateway tự động reconnect trong background

#### AC 4: Telemetry Flow — Happy Path
- [ ] Given gateway đã kết nối Modbus server và WebSocket client đã connect, when poll cycle hoàn tất, then WS client nhận JSON message format `{"deviceId":"SENSOR_P_01","value":2.5,"unit":"bar","timestamp":"..."}` cho tất cả 6 Modbus devices

#### AC 5: Telemetry Flow — Float32 Word Order
- [ ] Given Modbus device cấu hình `wordOrder: "CD_AB"`, when gateway đọc 2 registers, then giá trị Float32 được parse đúng với word swap (không bị sai giá trị do ngược byte)

#### AC 6: Telemetry Flow — Modbus Disconnect
- [ ] Given Modbus server bị ngắt, when poll cycle chạy, then gateway log error, skip cycle, không crash, và tự động reconnect khi server available trở lại

#### AC 7: Device Map — Config-Driven
- [ ] Given device-map.json có 2 OPC UA devices và 6 Modbus devices, when gateway start, then tất cả devices được load đúng, không có hardcoded address trong source code

#### AC 8: Docker Compose — One Command Start
- [ ] Given Docker installed, when chạy `docker-compose up`, then 3 services (gateway, opcua-mock, modbus-mock) khởi động thành công, gateway kết nối được tới cả 2 mock servers

#### AC 9: Health Check
- [ ] Given gateway đang chạy, when GET `/api/health`, then response JSON có trạng thái OPC UA (connected/disconnected), Modbus (connected/disconnected), và uptime

#### AC 10: Graceful Shutdown
- [ ] Given gateway đang chạy với tất cả connections, when SIGINT/SIGTERM, then gateway dừng polling, đóng connections, đóng servers, và exit clean (exit code 0)

## Additional Context

### Dependencies

| Package | Version | Purpose |
| ------- | ------- | ------- |
| `node-opcua` | ^2.x | OPC UA Client + Mock Server |
| `modbus-serial` | ^8.x | Modbus TCP Client |
| `jsmodbus` | ^4.x | Modbus TCP Mock Server |
| `express` | ^4.x | REST API framework |
| `ws` | ^8.x | WebSocket server |
| `pino` | ^9.x | Structured logging |
| `pino-pretty` | ^11.x | Dev log formatting |
| `typescript` | ^5.x | Language |
| `tsx` | ^4.x | TypeScript execution (dev) |
| `vitest` | ^2.x | Testing framework |
| `@types/express` | ^4.x | Express type definitions |
| `@types/ws` | ^8.x | WebSocket type definitions |

### Testing Strategy

- **Unit tests (Task 2.2):** `register-parser.ts` — test tất cả 4 word order variants + UInt16 + edge cases
- **Integration tests (Task 8.1-8.2):** Command flow end-to-end, Telemetry flow end-to-end
- **Manual smoke test:** `docker-compose up` → curl POST command → xem WS telemetry bằng wscat
- **Test execution:** `npm test` chạy unit tests, integration tests cần mock servers running

### Notes

**High-risk items:**
- Float32 word order parsing — sai 1 byte là giá trị sai hoàn toàn → unit test là critical
- node-opcua session recovery — thư viện có reconnection nhưng session state có thể mất → cần test kỹ
- Modbus batch read range calculation — phải tính đúng start address + count từ device map

**Known limitations:**
- Chỉ hỗ trợ Holding Registers (4xxxx) — không đọc Input Registers, Coils, Discrete Inputs
- OPC UA chỉ hỗ trợ Write — chưa có Read/Subscribe
- Modbus polling là sequential (1 connection) — chưa support multiple slaves
- Không có message queue buffer khi WebSocket clients disconnect

**Future considerations (out of scope):**
- MQTT bridge cho cloud integration
- Time-series database (InfluxDB/TimescaleDB)
- OPC UA Subscriptions thay vì polling
- Alarm & Event handling
- Multi-protocol routing engine

## Review Notes

- Adversarial review hoàn tất: 14 findings
- Đã fix: 13/14 (F1–F7, F9–F14)
- Bỏ qua: F8 (WS auth — Out of Scope theo tech-spec)
- Resolution: Auto-fix
- Critical fix: Float32 word order parsing (F1) — logic sai cho BA_DC/DC_BA, thêm test với giá trị không đối xứng
- High fixes: OPC UA reconnection listener (F3), input validation (F4), Modbus connect-aware polling (F2)
- Medium fixes: Body size limit (F5), Modbus stale flag (F6), graceful shutdown (F7), namespace mismatch (F9), Dockerfile build (F10)
- Low fixes: startTime lifecycle (F11), test coverage CD_AB (F12), .dockerignore (F13), pino-pretty devDep (F14)
