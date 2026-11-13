import { chooseUrl, parseHosts } from './core.mjs';

export function nativePlan(environment, url) {
  const rules = parseHosts(environment.hosts);
  // 保留旧版的排序与序列化，避免升级后换掉既有的 Chrome 登录目录。
  return { url: chooseUrl(url, rules), rules: rules.sort((a, b) => a.host.localeCompare(b.host, 'en-US')) };
}
