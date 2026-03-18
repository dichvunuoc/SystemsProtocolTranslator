# Protocol Translator Gateway — Tài liệu kết nối API

## Server

| | URL |
|---|---|
| **REST API** | `http://103.200.24.110:3000` |
| **WebSocket** | `ws://103.200.24.110:3001` |

> Server đang chạy mock data với 2 trạm bơm (Station A + Station B), dữ liệu sensor cập nhật mỗi 2 giây.

---

## 1. Lấy trạng thái hệ thống

```
GET /api/health
```

**Response:**
```json
{
  "status": "healthy",
  "connections": {
    "STATION_A": { "protocol": "opcua", "status": "connected" },
    "STATION_B": { "protocol": "opcua", "status": "connected" }
  },
  "uptime": 120
}
```

| Field | Mô tả |
|-------|-------|
| `status` | `"healthy"` = tất cả connected, `"degraded"` = một số mất kết nối, `"unhealthy"` = tất cả mất (HTTP 503) |
| `connections` | Trạng thái từng trạm |
| `uptime` | Thời gian server chạy (giây) |

---

## 2. Lấy danh sách thiết bị

```
GET /api/devices
```

**Response:**
```json
{
  "connections": [
    {
      "connectionId": "STATION_A",
      "protocol": "opcua",
      "description": "Trạm bơm A — OPC UA unified (telemetry + command)",
      "telemetry": [
        { "deviceId": "SENSOR_P_01", "unit": "bar", "description": "Inlet pressure" },
        { "deviceId": "SENSOR_P_02", "unit": "bar", "description": "Outlet pressure" },
        { "deviceId": "SENSOR_F_01", "unit": "m3/h", "description": "Flow rate" },
        { "deviceId": "SENSOR_L_01", "unit": "m", "description": "Water level" },
        { "deviceId": "PUMP_01_STATUS", "unit": "", "description": "Pump 1 running status (0=OFF, 1=ON)" },
        { "deviceId": "PUMP_02_STATUS", "unit": "", "description": "Pump 2 running status (0=OFF, 1=ON)" }
      ],
      "commands": [
        { "deviceId": "PUMP_01", "description": "Main pump start/stop" },
        { "deviceId": "PUMP_02", "description": "Backup pump start/stop" }
      ]
    },
    {
      "connectionId": "STATION_B",
      "protocol": "opcua",
      "description": "Trạm bơm B — OPC UA unified (telemetry + command)",
      "telemetry": [
        { "deviceId": "SENSOR_P_03", "unit": "bar", "description": "Station B inlet pressure" },
        { "deviceId": "PUMP_03_STATUS", "unit": "", "description": "Pump 3 running status (0=OFF, 1=ON)" }
      ],
      "commands": [
        { "deviceId": "PUMP_03", "description": "Station B pump start/stop" }
      ]
    }
  ]
}
```

---

## 3. Gửi lệnh điều khiển bơm

```
POST /api/command
Content-Type: application/json
```

**Request body:**
```json
{
  "deviceId": "PUMP_01",
  "action": "START"
}
```

| Field | Giá trị | Mô tả |
|-------|---------|-------|
| `deviceId` | `"PUMP_01"`, `"PUMP_02"`, `"PUMP_03"` | ID của bơm (lấy từ `commands` trong `/api/devices`) |
| `action` | `"START"` hoặc `"STOP"` | Lệnh bật/tắt |

**Response thành công (200):**
```json
{
  "success": true,
  "message": "Command START cho PUMP_01 thành công (connection: STATION_A)"
}
```

**Response lỗi (400):**
```json
{
  "success": false,
  "message": "Device không tồn tại: UNKNOWN"
}
```

Các lỗi có thể gặp:
- `"Device không tồn tại: ..."` — deviceId không có trong hệ thống
- `"... là telemetry-only, không hỗ trợ command"` — deviceId là sensor, không phải bơm
- `"Action không hợp lệ: ..."` — action không phải START hoặc STOP

---

## 4. Nhận dữ liệu telemetry realtime qua WebSocket

Kết nối WebSocket tới `ws://103.200.24.110:3001`. Không cần gửi message — server tự push data khi có giá trị mới.

### Ví dụ kết nối (JavaScript)

```javascript
const ws = new WebSocket('ws://103.200.24.110:3001');

ws.onopen = () => {
  console.log('Đã kết nối WebSocket');
};

ws.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log(data);
  // {
  //   connectionId: "STATION_A",
  //   deviceId: "SENSOR_P_01",
  //   value: 2.45,
  //   unit: "bar",
  //   description: "Inlet pressure",
  //   timestamp: "2026-03-16T12:57:10.000Z"
  // }
};

ws.onclose = () => {
  console.log('Mất kết nối — cần reconnect');
};
```

### Format message nhận được

```json
{
  "connectionId": "STATION_A",
  "deviceId": "SENSOR_P_01",
  "value": 2.45,
  "unit": "bar",
  "description": "Inlet pressure",
  "timestamp": "2026-03-16T12:57:10.000Z"
}
```

| Field | Type | Mô tả |
|-------|------|-------|
| `connectionId` | string | ID trạm gửi data (`STATION_A`, `STATION_B`) |
| `deviceId` | string | ID thiết bị (`SENSOR_P_01`, `PUMP_01_STATUS`...) |
| `value` | number | Giá trị đo được |
| `unit` | string | Đơn vị (`"bar"`, `"m3/h"`, `"m"`, `""`) |
| `description` | string | Mô tả thiết bị |
| `timestamp` | string | Thời điểm đo (ISO 8601, UTC) |

### Danh sách deviceId sẽ nhận qua WebSocket

**Station A:**
| deviceId | Ý nghĩa | Đơn vị | Khoảng giá trị (mock) |
|----------|---------|--------|----------------------|
| `SENSOR_P_01` | Áp lực đầu vào | bar | 1.5 — 3.5 |
| `SENSOR_P_02` | Áp lực đầu ra | bar | 1.0 — 2.5 |
| `SENSOR_F_01` | Lưu lượng nước | m3/h | 10.0 — 50.0 |
| `SENSOR_L_01` | Mức nước | m | 0.5 — 5.0 |
| `PUMP_01_STATUS` | Trạng thái bơm 1 | — | 0 (OFF) / 1 (ON) |
| `PUMP_02_STATUS` | Trạng thái bơm 2 | — | 0 (OFF) / 1 (ON) |

**Station B:**
| deviceId | Ý nghĩa | Đơn vị | Khoảng giá trị (mock) |
|----------|---------|--------|----------------------|
| `SENSOR_P_03` | Áp lực đầu vào | bar | 1.0 — 4.0 |
| `PUMP_03_STATUS` | Trạng thái bơm 3 | — | 0 (OFF) / 1 (ON) |

---

## 5. Test nhanh bằng curl / wscat

```bash
# Health check
curl http://103.200.24.110:3000/api/health

# Danh sách devices
curl http://103.200.24.110:3000/api/devices

# Bật bơm 1
curl -X POST http://103.200.24.110:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"PUMP_01","action":"START"}'

# Tắt bơm 1
curl -X POST http://103.200.24.110:3000/api/command \
  -H "Content-Type: application/json" \
  -d '{"deviceId":"PUMP_01","action":"STOP"}'

# Xem telemetry realtime (cần cài: npm i -g wscat)
wscat -c ws://103.200.24.110:3001
```

---

## 6. Lưu ý khi tích hợp frontend

- **WebSocket tự động gửi data** — không cần subscribe hay gửi message, chỉ cần kết nối là nhận data
- **Nên implement reconnect** — nếu WebSocket bị ngắt, đợi 2-3 giây rồi kết nối lại
- **Tần suất data** — mock server cập nhật mỗi ~2 giây, khi dùng PLC thật tần suất có thể khác
- **Phân biệt station** — dùng `connectionId` để biết data từ trạm nào
- **Phân biệt loại device** — sensor (giá trị liên tục) vs pump status (0/1)
- **Timestamp** — UTC format, frontend nên convert sang timezone local khi hiển thị
