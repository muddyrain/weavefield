// 可选隔离端口：本机验收预览运行时，回归测试不复用其服务或数据库。
export const e2eWebPort = Number(process.env.WEAVEFIELD_E2E_WEB_PORT ?? 15173);
export const e2eApiPort = Number(process.env.WEAVEFIELD_E2E_API_PORT ?? 13001);
export const e2eCollabPort = Number(process.env.WEAVEFIELD_E2E_COLLAB_PORT ?? 11234);
export const e2eOrigin = `http://127.0.0.1:${e2eWebPort}`;
export const e2eApi = `http://127.0.0.1:${e2eApiPort}`;
export const e2eCollabHttp = `http://127.0.0.1:${e2eCollabPort}`;
