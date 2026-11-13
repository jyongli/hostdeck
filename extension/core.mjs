// 扩展与本机助手共用规则入口，避免两端对域名和 IP 的理解不一致。
export const DEFAULT_ENVIRONMENTS = [
  { id: 'environment-a', name: '环境 A', hosts: '192.0.2.10 oa.example.test', color: '#2563eb' },
  { id: 'environment-b', name: '环境 B', hosts: '192.0.2.20 oa.example.test', color: '#d97706' },
];

export function parseHosts(text) {
  if (typeof text !== 'string' || text.length > 16000) throw new Error('规则内容过长或格式错误');
  const rules = [];
  const seen = new Set();
  for (const [index, source] of text.split(/\r?\n/).entries()) {
    const line = source.split('#')[0].trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    if (fields.length !== 2) throw new Error(`第 ${index + 1} 行：请填写「IP 域名」`);
    let [ip, host] = fields;
    host = host.toLowerCase();
    // 仅接受精确域名；禁止通配符、端口、URL 和可注入启动参数的字符。
    if (host.length > 253 || !host.split('.').every((part) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(part))) {
      throw new Error(`第 ${index + 1} 行：域名无效（仅支持精确英文域名）`);
    }
    try {
      if (/^[0-9.]+$/.test(host) || new URL(`http://${host}/`).hostname !== host) throw new Error();
    } catch { throw new Error(`第 ${index + 1} 行：请填写域名，不要使用 IP 或缩写地址`); }
    if (seen.has(host)) throw new Error(`域名 ${host} 在一个环境中只能配置一次`);
    if (ip.includes(':')) {
      if (!/^[0-9a-f:]+$/i.test(ip)) throw new Error(`第 ${index + 1} 行：IPv6 无效`);
      try { ip = new URL(`http://[${ip}]/`).hostname.slice(1, -1); }
      catch { throw new Error(`第 ${index + 1} 行：IPv6 无效`); }
    } else if (!/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)
      || ip.split('.').some((part) => Number(part) > 255 || String(Number(part)) !== part)) {
      throw new Error(`第 ${index + 1} 行：IPv4 无效`);
    }
    seen.add(host);
    rules.push({ host, ip });
  }
  if (!rules.length || rules.length > 32) throw new Error('每个环境需要 1–32 条解析规则');
  return rules;
}

export function validateEnvironment(environment) {
  if (!environment || !/^[a-zA-Z0-9_-]{1,64}$/.test(environment.id)
    || typeof environment.name !== 'string' || !environment.name.trim() || environment.name.length > 40) {
    throw new Error('环境名称或标识无效');
  }
  parseHosts(environment.hosts);
  return { id: environment.id, name: environment.name.trim(), hosts: environment.hosts,
    color: /^#[0-9a-f]{6}$/i.test(environment.color) ? environment.color : '#2563eb' };
}

export function chooseUrl(rawUrl, rules) {
  try {
    const url = new URL(rawUrl);
    if (['http:', 'https:'].includes(url.protocol) && !url.username && !url.password
      && rules.some((r) => r.host === url.hostname)) return url.href;
  } catch { /* 非网页标签改用环境的首个域名。 */ }
  return `https://${rules[0].host}/`;
}
