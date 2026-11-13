import { nativePlan } from './launch-plan.mjs';

export class NativeClient {
  async call(type, fields = {}) {
    // 一次性消息让 Chrome 在收到回复后释放助手和扩展后台的连接。
    const env = fields.environment;
    const payload = env ? { environment: { id: env.id, name: env.name },
      plan: nativePlan(env, fields.url), session: fields.session } : {};
    let reply;
    try {
      reply = await chrome.runtime.sendNativeMessage('cn.hostdeck.bridge', { ...payload, id: 'hostdeck', type });
    } catch (error) {
      throw new Error(`本机助手不可用：${error.message}。请在完整解压目录中运行「安装.cmd」。`);
    }
    if (reply.error) throw new Error(reply.error);
    return reply.result;
  }
}
