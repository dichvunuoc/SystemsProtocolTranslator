# Protocol Translator Gateway — Hướng dẫn chạy & cấu hình

## 1. Chạy Unit Tests

```bash
# Chạy tất cả tests (51 tests, 6 files)
npm test

# Chạy tests ở chế độ watch (tự chạy lại khi file thay đổi)
npm run test:watch

# Chạy 1 file test cụ thể
npx vitest run tests/unit/device-map.test.ts
npx vitest run tests/integration/telemetry-flow.test.ts
```

| File | Loại | Mô tả |
|------|------|-------|
| `tests/unit/register-parser.test.ts` | Unit | Parse Float32 word order (AB_CD, CD_AB, BA_DC, DC_BA) |
| `tests/unit/device-map.test.ts` | Unit | Validate cấu trúc device-map.json (2 OPC UA connections) |
| `tests/unit/device-map-validation.test.ts` | Unit | `validateDeviceMap()` — schema, duplicate, negative cases |
| `tests/integration/command-flow.test.ts` | Integration | Command routing: START/STOP, cross-connection, error cases |
| `tests/integration/telemetry-flow.test.ts` | Integration | Modbus polling + OPC UA subscription telemetry |
| `tests/integration/rest-health.test.ts` | Integration | REST `/api/health` + `/api/devices` |

---

## 2. Chạy Local với Mock Server

Chỉ cần **2 terminal** (OPC UA mock + gateway).

### Terminal 1 — Khởi động OPC UA Mock Server

```bash
# Mock server Station A (port 4840) — 2 sensors + 2 pumps
PUMP_NODES=PUMP_01.Command,PUMP_02.Command \
SENSOR_NODES="SENSOR_P_01.Value:Double:1.5:3.5,SENSOR_P_02.Value:Double:1.0:2.5" \
OPCUA_PORT=4840 \
npx tsx mock-servers/opcua-mock/server.ts
```

Mock server tự tạo sensor nodes và cập nhật giá trị ngẫu nhiên mỗi 2 giây.

**Tuỳ chỉnh SENSOR_NODES:** Format mỗi sensor là `TEN_NODE:DataType:min:max`, cách nhau bằng dấu phẩy.

### Terminal 2 — Khởi động Gateway

```bash
npm run dev:local
```

Hoặc chạy thủ công:
```bash
DEVICE_MAP_PATH=src/config/device-map.local.json LOG_LEVEL=info npx tsx src/index.ts
```

Gateway sẽ:
- Kết nối OPC UA tới `localhost:4840`
- Tạo subscription theo dõi sensor nodes (monitored items)
- Mở REST server tại `http://localhost:3000`
- Mở WebSocket server tại `ws://localhost:3001`

### Kiểm tra hoạt động

```bash
# Health check — expected: status "healthy"
curl http://localhost:3000/api/health | jq

# Danh sách devices (không lộ nodeId, register)
curl http://localhost:3000/api/devices | jq

# Gửi command START cho PUMP_01
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"PUMP_01","action":"START"}' | jq

# Gửi command STOP
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"PUMP_01","action":"STOP"}' | jq

# Xem telemetry realtime qua WebSocket
npx wscat -c ws://localhost:3001
```

### Test error cases

```bash
# Device không tồn tại → 400
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"UNKNOWN","action":"START"}' | jq

# Telemetry-only device → 400
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"SENSOR_P_01","action":"START"}' | jq

# Action không hợp lệ → 400
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"PUMP_01","action":"INVALID"}' | jq
```

---

## 3. Chạy trên Docker

### Khởi động toàn bộ stack (2 OPC UA mocks + gateway)

```bash
# Build và chạy
docker compose up --build

# Chạy ở background
docker compose up --build -d

# Xem logs
docker compose logs -f gateway
docker compose logs -f opcua-mock-a

# Dừng
docker compose down
```

Docker Compose tạo 3 services:

| Service | Mô tả |
|---------|-------|
| `opcua-mock-a` | OPC UA mock Station A (6 sensors + 2 pumps) |
| `opcua-mock-b` | OPC UA mock Station B (2 sensors + 1 pump) |
| `gateway` | Protocol Translator kết nối cả 2 stations |

Ports expose ra host:
- `http://localhost:3000` — REST API
- `ws://localhost:3001` — WebSocket telemetry stream

### Kiểm tra sau khi chạy Docker

```bash
# Chờ ~5s cho gateway kết nối, rồi kiểm tra
curl http://localhost:3000/api/health | jq
# Expected: status "healthy", cả STATION_A và STATION_B đều "connected"

curl http://localhost:3000/api/devices | jq
# Hiển thị 2 stations với telemetry + commands

npx wscat -c ws://localhost:3001
# Nhận telemetry JSON data mỗi ~2 giây từ cả 2 stations
```

### Test Reconnection trên Docker

```bash
# Tắt 1 mock server
docker compose stop opcua-mock-a

# Health check → STATION_A "disconnected", STATION_B vẫn "connected"
curl http://localhost:3000/api/health | jq

# Khởi động lại → gateway tự reconnect (exponential backoff 1s→2s→4s→...max 30s)
docker compose start opcua-mock-a
```

---

## 4. Cấu hình Device Map cho PLC thật

Tạo file JSON (ví dụ `device-map.real.json`) theo schema dưới đây, rồi chạy gateway với `DEVICE_MAP_PATH`.

### Schema tổng quan

```jsonc
{
  "connections": [
    {
      "connectionId": "TÊN_UNIQUE",       // ID duy nhất cho connection
      "protocol": "opcua",                 // "opcua" hoặc "modbus"
      "description": "Mô tả trạm",
      "endpoint": "opc.tcp://IP:PORT",     // Chỉ cho OPC UA
      "telemetry": [ ... ],                // Devices đọc giá trị
      "commands": [ ... ]                  // Devices ghi lệnh điều khiển
    }
  ]
}
```

### 4.1. Connection OPC UA

OPC UA telemetry sử dụng **subscription** (monitored items) — server tự push khi giá trị thay đổi, không polling.

```json
{
  "connectionId": "TRAM_BOM_1",
  "protocol": "opcua",
  "description": "Trạm bơm 1 — Siemens S7-1500",
  "endpoint": "opc.tcp://192.168.1.100:4840",
  "telemetry": [
    {
      "deviceId": "SENSOR_APLUC_01",
      "nodeId": "ns=2;s=Channel1.Device1.PressureIn",
      "dataType": "Double",
      "unit": "bar",
      "description": "Áp lực đầu vào"
    },
    {
      "deviceId": "SENSOR_LUU_LUONG_01",
      "nodeId": "ns=2;s=Channel1.Device1.FlowRate",
      "dataType": "Float",
      "unit": "m3/h",
      "description": "Lưu lượng nước"
    },
    {
      "deviceId": "SENSOR_MUC_NUOC_01",
      "nodeId": "ns=2;s=Channel1.Device1.WaterLevel",
      "dataType": "Double",
      "unit": "m",
      "description": "Mức nước bể chứa"
    },
    {
      "deviceId": "BOM_01_TRANG_THAI",
      "nodeId": "ns=2;s=Channel1.Device1.Pump1Status",
      "dataType": "Int16",
      "unit": "",
      "description": "Trạng thái bơm 1 (0=OFF, 1=ON, 2=FAULT)"
    }
  ],
  "commands": [
    {
      "deviceId": "BOM_01",
      "nodeId": "ns=2;s=Channel1.Device1.Pump1Command",
      "dataType": "Boolean",
      "description": "Điều khiển bơm 1 (START/STOP)"
    },
    {
      "deviceId": "VAN_01",
      "nodeId": "ns=2;s=Channel1.Device1.Valve1Command",
      "dataType": "Boolean",
      "description": "Điều khiển van 1 (OPEN/CLOSE)"
    }
  ]
}
```

**Lưu ý OPC UA:**
- `nodeId`: Lấy từ OPC UA server của PLC. Dùng tool như **UaExpert**, **Prosys OPC UA Browser**, hoặc CLI `npx opcua-commander -e opc.tcp://IP:PORT` để duyệt cây node.
- `dataType`: Phải khớp với kiểu dữ liệu trên PLC (`Boolean`, `Double`, `Float`, `Int16`, `Int32`, `UInt16`, `String`...).
- OPC UA server trên PLC phải hỗ trợ **subscription** (hầu hết PLC hiện đại đều hỗ trợ).

### 4.2. Connection Modbus TCP

Modbus telemetry sử dụng **polling** — gateway chủ động đọc register theo chu kỳ.

```json
{
  "connectionId": "TRAM_BOM_2",
  "protocol": "modbus",
  "description": "Trạm bơm 2 — Schneider M340 qua Modbus TCP",
  "host": "192.168.1.101",
  "port": 502,
  "unitId": 1,
  "pollIntervalMs": 1000,
  "telemetry": [
    {
      "deviceId": "SENSOR_APLUC_02",
      "register": 100,
      "length": 2,
      "dataType": "Float32",
      "wordOrder": "AB_CD",
      "unit": "bar",
      "description": "Áp lực đầu vào"
    },
    {
      "deviceId": "BOM_03_TRANG_THAI",
      "register": 200,
      "length": 1,
      "dataType": "UInt16",
      "wordOrder": "AB_CD",
      "unit": "",
      "description": "Trạng thái bơm 3"
    }
  ],
  "commands": []
}
```

**Lưu ý Modbus:**

| Field | Mô tả |
|-------|-------|
| `register` | Holding Register address (0-based). Tra từ tài liệu PLC. |
| `length` | Số registers: `1` cho UInt16, `2` cho Float32. |
| `dataType` | `"Float32"` hoặc `"UInt16"`. |
| `pollIntervalMs` | Chu kỳ đọc (ms). `1000` = 1 giây. **Bắt buộc** khi có telemetry. |
| `unitId` | Modbus Unit/Slave ID (thường là `1`). |

**Word Order cho Float32:**

| Giá trị | Byte order | PLC phổ biến |
|---------|-----------|-------------|
| `AB_CD` | Big-endian | Siemens, ABB |
| `CD_AB` | Little-endian word swap | Schneider, Mitsubishi |
| `BA_DC` | Byte swap | Hiếm gặp |
| `DC_BA` | Full swap | Hiếm gặp |

> Nếu giá trị đọc ra vô nghĩa, thử đổi wordOrder.

### 4.3. Kết hợp nhiều trạm, nhiều protocol

```json
{
  "connections": [
    {
      "connectionId": "TRAM_A",
      "protocol": "opcua",
      "description": "Trạm A — OPC UA (đọc subscription + ghi command)",
      "endpoint": "opc.tcp://192.168.1.100:4840",
      "telemetry": [ ... ],
      "commands": [ ... ]
    },
    {
      "connectionId": "TRAM_B",
      "protocol": "modbus",
      "description": "Trạm B — Modbus TCP (chỉ đọc polling)",
      "host": "192.168.1.101",
      "port": 502,
      "unitId": 1,
      "pollIntervalMs": 2000,
      "telemetry": [ ... ],
      "commands": []
    },
    {
      "connectionId": "TRAM_C",
      "protocol": "opcua",
      "description": "Trạm C — OPC UA (chỉ giám sát, telemetry-only)",
      "endpoint": "opc.tcp://192.168.1.102:4840",
      "telemetry": [ ... ],
      "commands": []
    }
  ]
}
```

### 4.4. Chạy gateway với config PLC thật

```bash
# Chạy trực tiếp (output đẹp với pino-pretty)
npm run dev:real

# Hoặc chạy thủ công với file config tuỳ chọn
DEVICE_MAP_PATH=path/to/your-config.json LOG_LEVEL=info npx tsx src/index.ts

# Trong Docker — mount file config vào container
docker run -p 3000:3000 -p 3001:3001 \
  -v $(pwd)/your-config.json:/app/src/config/device-map.json \
  gateway
```

### 4.5. Quy tắc quan trọng

| Quy tắc | Chi tiết |
|---------|----------|
| `connectionId` unique | Không được trùng giữa các connections |
| `deviceId` unique toàn cục | Không trùng kể cả giữa telemetry/commands, giữa các connections |
| Mỗi connection >= 1 device | Phải có ít nhất 1 telemetry hoặc 1 command |
| Modbus `pollIntervalMs` | Bắt buộc khi connection có telemetry devices |
| `nodeId` format | `ns=NAMESPACE;s=STRING_ID` hoặc `ns=NAMESPACE;i=NUMERIC_ID` |

---

## 5. Xác định nodeId trên PLC thật

```bash
# CLI browser — duyệt cây node OPC UA
npx opcua-commander -e opc.tcp://192.168.1.100:4840
```

Hoặc dùng GUI tool:
- **UaExpert** (Unified Automation) — phổ biến nhất
- **Prosys OPC UA Browser** — miễn phí

Duyệt cây node, tìm biến cần đọc/ghi, copy nodeId vào file device-map.

---

## 6. Environment Variables

| Biến | Mặc định | Mô tả |
|------|----------|-------|
| `DEVICE_MAP_PATH` | `src/config/device-map.json` | Đường dẫn file cấu hình |
| `REST_PORT` | `3000` | Port REST API |
| `WS_PORT` | `3001` | Port WebSocket telemetry |
| `LOG_LEVEL` | `info` | `debug`, `info`, `warn`, `error` |
| `RECONNECT_BASE_MS` | `1000` | Reconnect delay ban đầu (ms) |
| `RECONNECT_MAX_MS` | `30000` | Reconnect delay tối đa (ms) |

---

## 7. API Reference

| Method | Path | Mô tả |
|--------|------|-------|
| GET | `/api/health` | Trạng thái gateway + từng connection |
| GET | `/api/devices` | Danh sách devices (ẩn nodeId, register) |
| POST | `/api/command` | Gửi lệnh điều khiển |
| WS | `ws://host:3001` | Stream telemetry realtime |

### Health response

```json
{
  "status": "healthy",
  "connections": {
    "STATION_A": { "protocol": "opcua", "status": "connected" }
  },
  "uptime": 120
}
```

Status: `healthy` (tất cả connected), `degraded` (một số disconnected), `unhealthy` (tất cả disconnected). HTTP 503 khi `unhealthy`.

### Command request/response

```bash
curl -X POST http://localhost:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"PUMP_01","action":"START"}'
```

Actions: `START`, `STOP`.

### WebSocket telemetry message

```json
{
  "connectionId": "STATION_A",
  "deviceId": "SENSOR_P_01",
  "value": 2.45,
  "unit": "bar",
  "description": "Inlet pressure",
  "timestamp": "2026-03-16T11:43:26.233Z"
}
```

---

## 8. npm Scripts

| Script | Mô tả |
|--------|-------|
| `npm test` | Chạy 51 unit + integration tests |
| `npm run test:watch` | Test ở chế độ watch |
| `npm run mock:opcua:a` | OPC UA mock Station A (port 4840) |
| `npm run mock:opcua:b` | OPC UA mock Station B (port 4841) |
| `npm run dev:local` | Gateway với config local (localhost mock) |
| `npm run dev:real` | Gateway với config PLC thật |
| `npm run dev` | Gateway với config Docker |
