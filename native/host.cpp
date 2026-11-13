#define WIN32_LEAN_AND_MEAN
#ifndef _WIN32_WINNT
#define _WIN32_WINNT 0x0a00
#endif
#include <winsock2.h>
#include <ws2tcpip.h>
#include <windows.h>
#include <bcrypt.h>
#include <shellapi.h>
#include <cstring>
#include <stdexcept>
#include <utility>
#include <algorithm>
#define PICOJSON_ASSERT(e) do { if (!(e)) throw std::runtime_error("JSON 数据格式错误"); } while (0)
#include "vendor/picojson.h"
#include "version.h"

using J = picojson::value;
using Obj = picojson::object;
using Arr = picojson::array;
using S = std::string;
using W = std::wstring;
constexpr auto origin = L"chrome-extension://lfpancneciaghohokolpmdfmokmlkblp/";
constexpr DWORD maxInput = 10 * 1024 * 1024;
constexpr auto pipeError = "Chrome 初始化管道已断开；请先关闭该环境的全部窗口后重试";

struct Handle {
  HANDLE h = nullptr;
  Handle() = default;
  explicit Handle(HANDLE x) : h(x == INVALID_HANDLE_VALUE ? nullptr : x) {}
  Handle(Handle&& a) noexcept : h(std::exchange(a.h, nullptr)) {}
  Handle& operator=(Handle&& a) noexcept { if (this != &a) { close(); h = std::exchange(a.h, nullptr); } return *this; }
  ~Handle() { close(); }
  void close() { if (h) CloseHandle(std::exchange(h, nullptr)); }
};
void require(bool ok, const char* why) { if (!ok) throw std::runtime_error(why); }
W wide(const S& s) {
  if (s.empty()) return {};
  int n = MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), nullptr, 0);
  require(n > 0, "UTF-8 格式错误");
  W out(n, 0);
  MultiByteToWideChar(CP_UTF8, MB_ERR_INVALID_CHARS, s.data(), int(s.size()), &out[0], n);
  return out;
}
S utf8(const W& s) {
  if (s.empty()) return {};
  int n = WideCharToMultiByte(CP_UTF8, 0, s.data(), int(s.size()), nullptr, 0, nullptr, nullptr);
  S out(n, 0);
  WideCharToMultiByte(CP_UTF8, 0, s.data(), int(s.size()), &out[0], n, nullptr, nullptr);
  return out;
}
W env(const wchar_t* key) {
  DWORD n = GetEnvironmentVariableW(key, nullptr, 0);
  if (!n) return {};
  W s(n, 0);
  DWORD m = GetEnvironmentVariableW(key, &s[0], n);
  return m < n ? s.substr(0, m) : W();
}
bool file(const W& path) {
  DWORD a = GetFileAttributesW(path.c_str());
  return a != INVALID_FILE_ATTRIBUTES && !(a & FILE_ATTRIBUTE_DIRECTORY);
}
void directory(const W& path) {
  if (CreateDirectoryW(path.c_str(), nullptr) || GetLastError() == ERROR_ALREADY_EXISTS) return;
  auto i = path.find_last_of(L"\\/");
  require(i != W::npos && i > 2, "无法建立 Chrome 配置目录");
  directory(path.substr(0, i));
  require(CreateDirectoryW(path.c_str(), nullptr) || GetLastError() == ERROR_ALREADY_EXISTS, "无法建立 Chrome 配置目录");
}
W chrome() {
  for (auto key : {L"ProgramFiles", L"ProgramFiles(x86)", L"LOCALAPPDATA"}) {
    W base = env(key);
    if (base.empty()) continue;
    W path = base + L"\\Google\\Chrome\\Application\\chrome.exe";
    if (file(path)) return path;
  }
  throw std::runtime_error("未找到 Chrome，请先安装 Chrome");
}
S str(const J& j) { require(j.is<S>(), "数据格式错误"); return j.get<S>(); }
S opt(const J& j) { return j.is<S>() ? j.get<S>() : S(); }
bool yes(const J& j) { return j.evaluate_as_boolean(); }
bool starts(const S& a, const S& b) { return a.compare(0, b.size(), b) == 0; }
bool ends(const S& a, const S& b) { return a.size() >= b.size() && a.compare(a.size()-b.size(), b.size(), b) == 0; }
bool alnum(char c) { return (c >= 'a' && c <= 'z') || (c >= '0' && c <= '9'); }
bool hostname(const S& s) {
  if (s.empty() || s.size() > 253 || s.back()=='.') return false;
  size_t p = 0;
  bool letter = false;
  for (char c : s) {
    if (c == '.') { if (!p) return false; p = 0; continue; }
    if (!(alnum(c) || (p && c == '-')) || ++p > 63) return false;
    letter |= c >= 'a' && c <= 'z';
  }
  return letter && p && s.back() != '-' && s.find("-.") == S::npos;
}
void writeAll(HANDLE h, const void* src, size_t n) {
  auto p = static_cast<const char*>(src);
  while (n) {
    DWORD k = 0;
    require(WriteFile(h, p, DWORD(n), &k, nullptr) && k, "助手管道写入失败");
    n -= k; p += k;
  }
}
// 帧有长度上限；限制 JSON 深度，避免异常输入耗尽解析栈。
J decode(const S& text) {
  unsigned depth = 0;
  bool in = false, esc = false;
  for (char c : text) {
    if (in) { if (esc) esc = false; else if (c == '\\') esc = true; else if (c == '"') in = false; }
    else if (c == '"') in = true;
    else if (c == '{' || c == '[') require(++depth <= 32, "JSON 嵌套过深");
    else if (c == '}' || c == ']') { require(depth > 0, "JSON 格式错误"); --depth; }
  }
  J out; S error;
  auto end = picojson::parse(out, text.begin(), text.end(), &error);
  while (end != text.end() && (*end == ' ' || *end == '\t' || *end == '\r' || *end == '\n')) ++end;
  require(error.empty() && end == text.end() && out.is<Obj>(), "JSON 格式错误");
  return out;
}
struct Reader {
  HANDLE h;
  ULONGLONG deadline = 0;
  DWORD read(void* out, DWORD n) {
    if (deadline) {
      DWORD available = 0;
      do {
        require(GetTickCount64() < deadline, "登录初始化超时，请关闭该环境窗口后重试");
        require(PeekNamedPipe(h, nullptr, 0, nullptr, &available, nullptr), pipeError);
        if (!available) Sleep(8);
      } while (!available);
      if (available < n) n = available;
    }
    DWORD k = 0;
    require(ReadFile(h, out, n, &k, nullptr) && k, pipeError);
    return k;
  }
  void exact(char* p, DWORD n) { while (n) { auto k = read(p,n); p += k; n -= k; } }
  J frame() {
    DWORD n = 0;
    exact(reinterpret_cast<char*>(&n), 4);
    require(n && n <= maxInput, "助手消息过大或为空");
    S s(n, 0); exact(&s[0], n); return decode(s);
  }
};
void send(HANDLE h, const J& value, DWORD limit = 1024 * 1024 - 1) {
  S s = value.serialize();
  DWORD n = DWORD(s.size());
  require(n <= limit, "助手消息过大");
  writeAll(h, &n, 4); writeAll(h, s.data(), n);
}
S fingerprint(const Arr& rules) {
  auto s = J(rules).serialize();
  BCRYPT_ALG_HANDLE algorithm = nullptr;
  require(BCryptOpenAlgorithmProvider(&algorithm, BCRYPT_SHA256_ALGORITHM, nullptr, 0) == 0, "无法初始化 SHA256");
  UCHAR hash[32];
  auto status = BCryptHash(algorithm, nullptr, 0, reinterpret_cast<PUCHAR>(&s[0]), ULONG(s.size()), hash, sizeof hash);
  BCryptCloseAlgorithmProvider(algorithm, 0);
  require(status == 0, "无法计算配置标识");
  S out;
  for (int i = 0; i < 6; ++i) { out += "0123456789abcdef"[hash[i] >> 4]; out += "0123456789abcdef"[hash[i] & 15]; }
  return out;
}

struct Plan {
  S name, url, host, site;
  W profile;
  std::vector<W> args;
  Arr rules;
  bool sync;
  Plan(const J& m) {
    const auto& e = m.get("environment");
    S id = str(e.get("id"));
    name = str(e.get("name"));
    require(!id.empty() && id.size() <= 64 && !name.empty() && wide(name).size() <= 40, "环境名称或标识无效");
    for (char c : id) require(alnum(c) || (c >= 'A' && c <= 'Z') || c == '-' || c == '_', "环境标识无效");
    const auto& p = m.get("plan");
    require(p.get("rules").is<Arr>(), "缺少解析规则，请重新加载新版扩展");
    const auto& input = p.get("rules").get<Arr>();
    require(!input.empty() && input.size() <= 32, "每个环境需要 1–32 条解析规则");
    S mapping;
    for (auto& r : input) {
      S h = str(r.get("host")), ip = str(r.get("ip"));
      require(hostname(h) && ip.find('\0') == S::npos, "域名或 IP 无效");
      for (const auto& old : rules) require(opt(old.get("host")) != h, "域名不能重复");
      IN_ADDR ipv4; IN6_ADDR ipv6;
      bool v6 = ip.find(':') != S::npos;
      require(v6 ? InetPtonA(AF_INET6, ip.c_str(), &ipv6) == 1 : InetPtonA(AF_INET, ip.c_str(), &ipv4) == 1, "IP 无效");
      rules.emplace_back(Obj{{"host",J(h)},{"ip",J(ip)}});
      if (!mapping.empty()) mapping += ", ";
      mapping += "MAP " + h + " " + (v6 ? "["+ip+"]" : ip);
    }
    url = str(p.get("url"));
    require(starts(url,"https://") || starts(url,"http://"), "目标网址无效");
    for (unsigned char c : url) require(c > 32 && c != 127 && c != '\\' && c != '"', "目标网址无效");
    size_t start = url.find("://")+3, end = url.find_first_of("/?#",start);
    site = url.substr(0,end);
    auto authority = site.substr(start);
    auto colon = authority.find(':');
    host = authority.substr(0,colon);
    if (colon != S::npos) {
      auto port = authority.substr(colon+1);
      require(!port.empty() && port.size() <= 5 && port.find_first_not_of("0123456789") == S::npos && std::stoi(port) <= 65535, "端口无效");
    }
    bool mapped = false;
    for (const auto& r : rules) mapped |= opt(r.get("host")) == host;
    require(mapped, "目标网址不属于所选环境");
    sync = opt(m.get("type")) == "sync";
    const W local = env(L"LOCALAPPDATA");
    require(!local.empty(), "找不到当前 Windows 用户的资料目录");
    profile = local + L"\\HostDeck\\profiles\\" + wide(id + "-" + fingerprint(rules));
    args = {L"--user-data-dir="+profile, L"--no-first-run", L"--no-default-browser-check",
      L"--new-window", L"--no-proxy-server", L"--host-resolver-rules="+wide(mapping)};
  }
  void preferences() const {
    W dir = profile + L"\\Default", target = dir + L"\\Preferences";
    if (file(target)) return;
    directory(dir);
    Handle out(CreateFileW(target.c_str(), GENERIC_WRITE, FILE_SHARE_READ, nullptr, CREATE_NEW, FILE_ATTRIBUTE_NORMAL, nullptr));
    if (out.h) {
      auto s = J(Obj{{"profile", J(Obj{{"name",J("HostDeck · "+name)}})}}).serialize();
      writeAll(out.h, s.data(), s.size());
    } else require(GetLastError() == ERROR_FILE_EXISTS, "无法创建 Chrome 首选项");
  }
};

// 使用 Windows 参数转义，不经过 CMD；仅继承本次操作需要的句柄。
W quote(const W& s) {
  W q = L"\""; size_t slashes = 0;
  for (auto c : s) {
    if (c == L'\\') { ++slashes; continue; }
    q.append(slashes * (c == L'"' ? 2 : 1), L'\\'); slashes = 0;
    if (c == L'"') q += L'\\';
    q += c;
  }
  q.append(slashes * 2,L'\\'); return q + L'"';
}
struct Pair {
  Handle read, write;
  Pair(bool inheritRead) {
    SECURITY_ATTRIBUTES a{sizeof a,nullptr,TRUE};
    HANDLE r, w;
    require(CreatePipe(&r,&w,&a,0), "无法建立本机匿名管道");
    read = Handle(r); write = Handle(w);
    require(SetHandleInformation(inheritRead ? w : r,HANDLE_FLAG_INHERIT,0), "无法配置本机管道");
  }
};
Handle spawn(const W& exe, const std::vector<W>& args, std::vector<HANDLE> fds = {}) {
  W cmd = quote(exe);
  for (const auto& arg : args) cmd += L" " + quote(arg);
  STARTUPINFOEXW info{};
  PROCESS_INFORMATION process{};
  info.StartupInfo.cb = sizeof(STARTUPINFOW);
  DWORD flags = CREATE_NO_WINDOW;
  if (!fds.empty()) {
    info.StartupInfo.cb = sizeof(info);
    info.StartupInfo.dwFlags = STARTF_USESTDHANDLES;
    info.StartupInfo.hStdInput = fds[0]; info.StartupInfo.hStdOutput = fds[1]; info.StartupInfo.hStdError = fds[2];
    // Chrome 用 C 运行库的 fd 3/4 读取 CDP；前 3 个标准句柄也显式传入。
    unsigned char crt[sizeof(int) + 5 * (1 + sizeof(HANDLE))]{};
    if (fds.size() == 5) {
      int count = 5; memcpy(crt,&count,4);
      for (int i=0;i<5;i++) { crt[4+i] = i<3 ? 0x41 : 0x09; memcpy(crt+9+i*sizeof(HANDLE),&fds[i],sizeof(HANDLE)); }
      info.StartupInfo.cbReserved2 = sizeof(crt); info.StartupInfo.lpReserved2 = crt;
    }
    SIZE_T bytes = 0;
    InitializeProcThreadAttributeList(nullptr,1,0,&bytes);
    std::vector<unsigned char> storage(bytes);
    info.lpAttributeList = reinterpret_cast<LPPROC_THREAD_ATTRIBUTE_LIST>(storage.data());
    require(InitializeProcThreadAttributeList(info.lpAttributeList,1,0,&bytes), "无法建立进程句柄列表");
    std::vector<HANDLE> allowed;
    for (auto h : fds) if (std::find(allowed.begin(),allowed.end(),h)==allowed.end()) allowed.push_back(h);
    bool ok = UpdateProcThreadAttribute(info.lpAttributeList,0,PROC_THREAD_ATTRIBUTE_HANDLE_LIST,
      allowed.data(),allowed.size()*sizeof(HANDLE),nullptr,nullptr)
      && CreateProcessW(exe.c_str(),&cmd[0],nullptr,nullptr,TRUE,flags|EXTENDED_STARTUPINFO_PRESENT,nullptr,nullptr,&info.StartupInfo,&process);
    DeleteProcThreadAttributeList(info.lpAttributeList);
    require(ok, "无法启动本机进程");
  } else {
    require(CreateProcessW(exe.c_str(),&cmd[0],nullptr,nullptr,FALSE,flags,nullptr,nullptr,&info.StartupInfo,&process), "无法启动 Chrome");
  }
  CloseHandle(process.hThread);
  return Handle(process.hProcess);
}
Handle nul() {
  SECURITY_ATTRIBUTES a{sizeof a,nullptr,TRUE};
  Handle h(CreateFileW(L"NUL",GENERIC_READ|GENERIC_WRITE,FILE_SHARE_READ|FILE_SHARE_WRITE,&a,OPEN_EXISTING,0,nullptr));
  require(h.h != nullptr, "无法打开 NUL"); return h;
}

// 只向目标环境传递匹配域名的 Cookie 和同源存储。
Arr cookies(const Plan& p, const J& session) {
  const auto& input = session.get("cookies");
  require(input.is<Arr>() && input.get<Arr>().size() <= 500, "网站登录数据无效");
  Arr result;
  for (const auto& c : input.get<Arr>()) {
    auto d = str(c.get("domain")), name = str(c.get("name")), value = str(c.get("value")), path = str(c.get("path"));
    bool domain = starts(d,"."), allowed = false;
    for (const auto& r : p.rules) {
      auto h = opt(r.get("host"));
      allowed |= domain ? h == d.substr(1) || ends(h,d) : h == d;
    }
    require(allowed, "登录数据包含所选环境以外的 Cookie");
    require(c.get("partitionKey").is<picojson::null>() && !yes(c.get("partitionKeyOpaque")), "该网站使用分区 Cookie，请在独立窗口重新登录");
    require(!name.empty() && starts(path,"/") && value.find_first_of("\r\n") == S::npos && value.find('\0') == S::npos, "Cookie 格式无效");
    for (unsigned char ch : name) require(ch > 32 && ch != ';' && ch != '=', "Cookie 格式无效");
    bool secure = yes(c.get("secure"));
    Obj o{{"name",J(name)},{"value",J(value)},{"path",J(path)},{"secure",J(secure)},{"httpOnly",J(yes(c.get("httpOnly")))}};
    if (domain) o.emplace("domain",J(d));
    else o.emplace("url",J(S(secure || starts(p.url,"https:") ? "https://" : "http://")+d+path));
    auto ss = opt(c.get("sameSite")), pr = opt(c.get("priority"));
    if (ss == "Strict" || ss == "Lax" || ss == "None") o.emplace("sameSite",J(ss));
    if (pr == "Low" || pr == "Medium" || pr == "High") o.emplace("priority",J(pr));
    auto& exp = c.get("expires");
    if (exp.is<double>() && exp.get<double>() > 0) o.emplace("expires",exp);
    result.emplace_back(std::move(o));
  }
  return result;
}
size_t entries(const J& s, const char* key) {
  const auto& list = s.get(key);
  require(list.is<Arr>() && list.get<Arr>().size() <= 10000, "网站存储格式无效");
  for (const auto& v : list.get<Arr>()) require(v.is<Arr>() && v.get<Arr>().size()==2
    && v.get<Arr>()[0].is<S>() && v.get<Arr>()[1].is<S>(), "网站存储格式无效");
  return list.get<Arr>().size();
}

struct Pipe {
  Reader from;
  HANDLE to;
  int id = 0;
  S buffer, binding, attached, ready;
  size_t pos = 0;
  J next() {
    while (true) {
      auto n = buffer.find('\0',pos);
      if (n != S::npos) {
        auto message = decode(buffer.substr(pos,n-pos));
        pos = n+1;
        if (pos == buffer.size()) { buffer.clear(); pos=0; }
        const auto& a = message.get("params");
        if (!binding.empty() && opt(message.get("method")) == "Runtime.bindingCalled"
          && opt(message.get("sessionId")) == attached && opt(a.get("name")) == binding) ready = opt(a.get("payload"));
        return message;
      }
      buffer.erase(0,pos); pos=0;
      char b[8192]; buffer.append(b,from.read(b,sizeof b));
      require(buffer.size() <= 16*1024*1024, "Chrome 回复过大");
    }
  }
  J call(const char* method, Obj params = {}, bool page = false) {
    double expected = ++id;
    Obj m{{"id",J(expected)},{"method",J(method)},{"params",J(std::move(params))}};
    if (page) m.emplace("sessionId",J(attached));
    auto out = J(std::move(m)).serialize(); out += '\0';
    writeAll(to,out.data(),out.size());
    for (;;) {
      auto r = next();
      if (!r.get("id").is<double>() || r.get("id").get<double>() != expected) continue;
      require(r.get("error").is<picojson::null>(), "Chrome 登录初始化失败");
      return r.get("result");
    }
  }
};

struct Seed {
  Pair to{true}, from{false};
  Handle process;
  J run(const J& m) {
    Plan p(m);
    const auto& snapshot = m.get("session");
    auto c = cookies(p,snapshot);
    const auto& s = snapshot.get("storage");
    require(str(s.get("origin")) == p.site, "网站存储来源与目标网址不一致");
    auto l = entries(s,"local"), t = entries(s,"session");
    p.preferences();
    auto sink = nul();
    p.args.emplace_back(L"--remote-debugging-pipe"); p.args.emplace_back(L"about:blank");
    process = spawn(chrome(),p.args,{sink.h,sink.h,sink.h,to.read.h,from.write.h});
    to.read.close(); from.write.close();
    Pipe pipe{{from.read.h,GetTickCount64()+28000},to.write.h};
    pipe.call("Browser.getVersion");
    S target;
    auto list = pipe.call("Target.getTargets").get("targetInfos");
    if (list.is<Arr>()) for (const auto& a : list.get<Arr>()) {
      if (opt(a.get("type"))=="page" && opt(a.get("url"))=="about:blank") { target=opt(a.get("targetId")); break; }
    }
    if (target.empty()) target = str(pipe.call("Target.createTarget",{{"url",J("about:blank")}}).get("targetId"));
    pipe.attached = str(pipe.call("Target.attachToTarget",{{"targetId",J(target)},{"flatten",J(true)}}).get("sessionId"));
    pipe.call("Page.enable",{},true); pipe.call("Runtime.enable",{},true);
    auto count = c.size();
    if (count) pipe.call("Network.setCookies",{{"cookies",J(std::move(c))}},true);
    UCHAR random[16];
    require(BCryptGenRandom(nullptr,random,sizeof random,BCRYPT_USE_SYSTEM_PREFERRED_RNG)==0,"无法初始化登录导入");
    pipe.binding = "__hostdeck_";
    for (auto b : random) { pipe.binding += "0123456789abcdef"[b>>4]; pipe.binding += "0123456789abcdef"[b&15]; }
    pipe.call("Runtime.addBinding",{{"name",J(pipe.binding)}},true);
    // 等页面确认写入后立即移除脚本和附加会话，刷新不会再次覆盖登录。
    S script = "(()=>{if(top!==globalThis||location.origin!=="+J(p.site).serialize()+")return;try{const d="+s.serialize()
      +";for(const[k,v]of d.local)localStorage.setItem(k,v);for(const[k,v]of d.session)sessionStorage.setItem(k,v);"
      +pipe.binding+"('ok')}catch{"+pipe.binding+"('failed')}})()";
    auto scriptId = str(pipe.call("Page.addScriptToEvaluateOnNewDocument",{{"source",J(std::move(script))}},true).get("identifier"));
    auto nav = pipe.call("Page.navigate",{{"url",J(p.url)}},true);
    require(opt(nav.get("errorText")).empty(), "目标网站访问失败");
    while (pipe.ready.empty()) pipe.next();
    require(pipe.ready=="ok","目标网站阻止写入登录存储，请在该窗口重新登录");
    pipe.call("Page.removeScriptToEvaluateOnNewDocument",{{"identifier",J(scriptId)}},true);
    pipe.call("Runtime.removeBinding",{{"name",J(pipe.binding)}},true);
    pipe.call("Target.detachFromTarget",{{"sessionId",J(pipe.attached)}});
    return J(Obj{{"profile",J(utf8(p.profile))},{"imported",J(Obj{{"cookies",J(double(count))},{"local",J(double(l))},{"session",J(double(t))}})},
      {"message",J("已为 "+p.name+" 带入当前网站登录数据；若目标服务器不接受该登录，请在新窗口重新登录。")}});
  }
};

J launch(const J& m) {
  if (!m.get("session").is<picojson::null>()) {
    require(opt(m.get("type"))=="launch","未知助手命令");
    // 只有导入模式需要维持 Chrome 的匿名管道，交给同一个 EXE 的轻量子进程。
    W exe(32768,0); auto n = GetModuleFileNameW(nullptr,&exe[0],DWORD(exe.size()));
    require(n && n<exe.size(),"无法定位助手程序"); exe.resize(n);
    Pair in(true), out(false); auto sink=nul();
    auto child=spawn(exe,{L"--seed"},{in.read.h,out.write.h,sink.h});
    in.read.close(); out.write.close();
    send(in.write.h,m,maxInput); in.write.close();
    auto r=Reader{out.read.h,GetTickCount64()+35000}.frame();
    require(r.get("error").is<picojson::null>(),opt(r.get("error")).c_str());
    return r.get("result");
  }
  Plan p(m);
  auto exe=chrome(); p.preferences();
  p.args.push_back(p.sync ? L"chrome://settings/syncSetup" : wide(p.url));
  spawn(exe,p.args);
  return J(Obj{{"profile",J(utf8(p.profile))},{"message",J(p.sync
    ? "已打开 "+p.name+" 的 Chrome 同步设置，请在该窗口登录原 Google 账户。"
    : "已启动 "+p.name+" 独立环境。")}});
}

int WINAPI wWinMain(HINSTANCE,HINSTANCE,PWSTR,int) {
  int argc = 0;
  auto argv = CommandLineToArgvW(GetCommandLineW(),&argc);
  if (!argv) return 2;
  bool seed = argc==2 && W(argv[1])==L"--seed";
  bool valid = seed || (argc>=2 && W(argv[1])==origin);
  LocalFree(argv);
  if (!valid) return 2;
  HANDLE in = GetStdHandle(STD_INPUT_HANDLE), out = GetStdHandle(STD_OUTPUT_HANDLE);
  try {
    if (seed) {
      Seed worker;
      send(out,J(Obj{{"result",worker.run(Reader{in}.frame())}}));
      // 已解除页面附加；空闲只等待进程退出，不运行事件循环。
      CloseHandle(out);
      WaitForSingleObject(worker.process.h,INFINITE);
      return 0;
    }
    auto m = Reader{in}.frame();
    auto id = str(m.get("id"));
    require(!id.empty() && id.size()<=128,"消息标识无效");
    Obj response{{"id",J(id)},{"done",J(true)}};
    try {
      auto type=str(m.get("type"));
      if (type=="ping") response.emplace("result",J(Obj{{"version",J(HOSTDECK_VERSION)},{"engine",J("win32")}}));
      else if (type=="launch" || type=="sync") response.emplace("result",launch(m));
      else throw std::runtime_error("未知助手命令");
    } catch (const std::exception& e) { response.emplace("error",J(e.what())); }
    send(out,J(std::move(response)));
    return 0;
  } catch (const std::exception& e) {
    if (seed) { try { send(out,J(Obj{{"error",J(e.what())}})); return 0; } catch (...) {} }
    return 3;
  }
}
