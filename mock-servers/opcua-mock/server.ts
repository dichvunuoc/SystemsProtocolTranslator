import {
  OPCUAServer,
  Variant,
  DataType,
  StatusCodes,
  type UAVariable,
} from 'node-opcua';

const PORT = 4840;

async function main() {
  console.log('[OPC UA Mock] Đang khởi tạo server...');

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
  // (ns=0 là OPC UA standard, ns=1 là server own namespace)
  const namespace = addressSpace.registerNamespace('urn:WaterPumpStation');

  // Tạo folder cho trạm bơm
  const pumpStation = namespace.addFolder(addressSpace.rootFolder.objects, {
    browseName: 'WaterPumpStation',
  });

  // PUMP_01.Command — Boolean, writable
  const pump01Cmd = namespace.addVariable({
    componentOf: pumpStation,
    browseName: 'PUMP_01.Command',
    nodeId: 's=PUMP_01.Command',
    dataType: 'Boolean',
    value: new Variant({ dataType: DataType.Boolean, value: false }),
  });

  // PUMP_02.Command — Boolean, writable
  const pump02Cmd = namespace.addVariable({
    componentOf: pumpStation,
    browseName: 'PUMP_02.Command',
    nodeId: 's=PUMP_02.Command',
    dataType: 'Boolean',
    value: new Variant({ dataType: DataType.Boolean, value: false }),
  });

  // Log khi nhận write operations
  const logWrite = (name: string, variable: UAVariable) => {
    variable.on('value_changed' as any, (dataValue: any) => {
      console.log(
        `[OPC UA Mock] Nhận write - ${name}: ${dataValue.value.value} (${new Date().toISOString()})`,
      );
    });
  };

  logWrite('PUMP_01.Command', pump01Cmd);
  logWrite('PUMP_02.Command', pump02Cmd);

  await server.start();
  console.log(
    `[OPC UA Mock] Server đã khởi động tại opc.tcp://0.0.0.0:${PORT}/UA/MockServer`,
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
