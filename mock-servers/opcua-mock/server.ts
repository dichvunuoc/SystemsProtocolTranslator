import {
  OPCUAServer,
  Variant,
  DataType,
  type UAVariable,
} from 'node-opcua';

const PORT = parseInt(process.env.OPCUA_PORT || '4840', 10);
const UPDATE_INTERVAL_MS = parseInt(process.env.UPDATE_INTERVAL_MS || '2000', 10);

// Command nodes — Boolean, writable (giữ nguyên logic cũ)
const PUMP_NODES = (process.env.PUMP_NODES || 'PUMP_01.Command,PUMP_02.Command')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

// Sensor nodes — format: "NAME:DataType:min:max" (ví dụ: "SENSOR_P_01.Value:Double:1.5:3.5")
const SENSOR_NODES_RAW = (process.env.SENSOR_NODES || '')
  .split(',')
  .map((s) => s.trim())
  .filter((s) => s.length > 0);

interface SensorConfig {
  name: string;
  dataType: 'Double' | 'Float';
  min: number;
  max: number;
}

function parseSensorNodes(raw: string[]): SensorConfig[] {
  return raw.map((entry) => {
    const parts = entry.split(':');
    if (parts.length < 4) {
      console.error(`[OPC UA Mock] Sensor node format không hợp lệ: "${entry}". Expected "NAME:DataType:min:max"`);
      process.exit(1);
    }
    const dataType = parts[1];
    if (dataType !== 'Double' && dataType !== 'Float') {
      console.error(`[OPC UA Mock] DataType không hợp lệ: "${dataType}" trong "${entry}". Chỉ hỗ trợ Double hoặc Float`);
      process.exit(1);
    }
    return {
      name: parts[0],
      dataType,
      min: parseFloat(parts[2]),
      max: parseFloat(parts[3]),
    };
  });
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}

async function main() {
  const sensorConfigs = parseSensorNodes(SENSOR_NODES_RAW);

  console.log(`[OPC UA Mock] Đang khởi tạo server — port: ${PORT}`);
  console.log(`[OPC UA Mock] Command nodes: ${PUMP_NODES.join(', ') || '(none)'}`);
  console.log(`[OPC UA Mock] Sensor nodes: ${sensorConfigs.map((s) => s.name).join(', ') || '(none)'}`);

  const server = new OPCUAServer({
    port: PORT,
    resourcePath: '/UA/MockServer',
    buildInfo: {
      productName: 'WaterPumpStation-MockServer',
      buildNumber: '1',
      buildDate: new Date(),
    },
  });

  await server.initialize();

  const addressSpace = server.engine.addressSpace!;
  // Đăng ký namespace "WaterPumpStation" tại ns=2
  const namespace = addressSpace.registerNamespace('urn:WaterPumpStation');

  // Tạo folder cho trạm bơm
  const pumpStation = namespace.addFolder(addressSpace.rootFolder.objects, {
    browseName: 'WaterPumpStation',
  });

  // --- Command nodes (Boolean, writable) ---
  const logWrite = (name: string, variable: UAVariable) => {
    variable.on('value_changed' as any, (dataValue: any) => {
      console.log(
        `[OPC UA Mock] Nhận write - ${name}: ${dataValue.value.value} (${new Date().toISOString()})`,
      );
    });
  };

  for (const nodeName of PUMP_NODES) {
    const variable = namespace.addVariable({
      componentOf: pumpStation,
      browseName: nodeName,
      nodeId: `s=${nodeName}`,
      dataType: 'Boolean',
      value: new Variant({ dataType: DataType.Boolean, value: false }),
    });
    logWrite(nodeName, variable);
    console.log(`[OPC UA Mock] Đã tạo command node: ns=2;s=${nodeName} (Boolean, writable)`);
  }

  // --- Sensor nodes (Double/Float, simulated values) ---
  const sensorVariables: { config: SensorConfig; variable: UAVariable }[] = [];

  for (const config of sensorConfigs) {
    const opcuaDataType = config.dataType === 'Float' ? DataType.Float : DataType.Double;
    const initialValue = randomRange(config.min, config.max);

    const variable = namespace.addVariable({
      componentOf: pumpStation,
      browseName: config.name,
      nodeId: `s=${config.name}`,
      dataType: config.dataType,
      value: new Variant({ dataType: opcuaDataType, value: initialValue }),
    });

    sensorVariables.push({ config, variable });
    console.log(
      `[OPC UA Mock] Đã tạo sensor node: ns=2;s=${config.name} (${config.dataType}, range: ${config.min}-${config.max})`,
    );
  }

  // Simulate giá trị thay đổi
  if (sensorVariables.length > 0) {
    setInterval(() => {
      const values: string[] = [];
      for (const { config, variable } of sensorVariables) {
        const opcuaDataType = config.dataType === 'Float' ? DataType.Float : DataType.Double;
        const newValue = randomRange(config.min, config.max);
        variable.setValueFromSource(new Variant({ dataType: opcuaDataType, value: newValue }));
        values.push(`${config.name}=${newValue.toFixed(2)}`);
      }
      console.log(`[OPC UA Mock] Cập nhật sensors — ${values.join(', ')}`);
    }, UPDATE_INTERVAL_MS);
  }

  await server.start();
  console.log(
    `[OPC UA Mock] Server đã khởi động tại opc.tcp://0.0.0.0:${PORT}/UA/MockServer (${PUMP_NODES.length} command nodes, ${sensorVariables.length} sensor nodes)`,
  );

  // Graceful shutdown
  process.on('SIGINT', async () => {
    console.log('[OPC UA Mock] Đang tắt server...');
    await server.shutdown();
    process.exit(0);
  });
  process.on('SIGTERM', async () => {
    await server.shutdown();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('[OPC UA Mock] Lỗi khởi tạo:', err);
  process.exit(1);
});
