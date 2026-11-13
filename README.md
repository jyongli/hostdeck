# HostDeck · 环境窗口

Windows Chrome 的固定 IP 环境工具。

**[下载 HostDeck v1.3.0 Windows x64 安装包](https://github.com/jyongli/hostdeck/releases/download/v1.3.0/HostDeck-1.3.0-win-x64.zip)**（Windows 10/11，无需编译）

## 首次安装

1. 下载 ZIP，完整解压到固定文件夹，双击 `安装.cmd` 注册本机助手。
2. 打开 Chrome 的 `chrome://extensions/`，开启「开发者模式」，点击「加载已解压的扩展程序」，选择包里的 `extension` 文件夹。
3. 打开 HostDeck →「管理」，将示例域名 `oa.example.test` 和示例 IP `192.0.2.10`、`192.0.2.20` 换成自己的域名和 IP，再保存。

安装后请保留解压目录。可以把 HostDeck 固定到工具栏；弹窗底部显示「本机助手已连接」即表示安装成功。

内置两条示例规则：

| 环境 | 固定 IP |
| --- | --- |
| 环境 A | 192.0.2.10 |
| 环境 B | 192.0.2.20 |

A/B 只用于区分 IP，没有假定哪个是测试或正式。点击「管理」可改名、改颜色、添加域名和 IP。

**1.2.0 已停用当前标签切换。** 同一 Chrome 配置中的同域名网页共享 Cookie 和 localStorage，切到另一台服务器后，失效登录被清理会使两边一起退出。此前能分别转发到两个 IP，不代表登录已经隔离。现在统一使用独立 Chrome 配置窗口，并拒绝旧的标签切换消息。

**1.3.0 轻量版**把本机助手换成单个 Windows 原生程序。普通启动、同步设置和连接检查只启动一次助手，回复后即退出。

## 已安装用户升级

1. 从 1.0/1.1 升级时，先停止旧标签接管。
2. 在更新后的目录重新运行「安装.cmd」，让 Chrome 找到新的助手程序。
3. 在 `chrome://extensions/` 重新加载扩展，确认弹窗底部显示 **1.3.0**。保持扩展安装位置、环境标识与域名/IP 规则时，会继续使用原来的配置和独立窗口登录目录。

## 安装说明与兼容性

若旧的 `%LOCALAPPDATA%\HostDeck\App\extension` 路径显示「位置不可用」，请使用上述解压目录。打包应用可能重定向 AppData；安装脚本已使用原地注册，避免向 Explorer 和 Chrome 发布这种路径别名。

扩展 ID 固定为 `lfpancneciaghohokolpmdfmokmlkblp`。权限包括标签信息、本机通信、本地设置及页面调试。调试只用于主动读取当前网站登录，结束后立即解除；没有持续 Fetch 拦截，也没有默认全站 host_permissions 或常驻内容脚本。

Windows 10/11 x64。助手使用 Windows 自带的通用 CRT，不需要安装 Node、.NET 或 VC++ 运行库。企业管理策略若禁止开发者扩展或调试接口，工具不能绕过。

## 独立窗口与登录

点击所需环境的「独立窗口」。原域名、当前路径与 HTTPS 域名校验保持不变，连接使用该环境的 IP 映射。每个环境使用自己的 `--user-data-dir`，因此 Cookie、localStorage 和网站登录不与另一个环境共用。两个窗口可同时使用；普通 Chrome 的网页和资料不会被改成另一环境。

当前网址的域名属于所选环境时保留原地址，否则打开规则中第一个域名的首页。前端和 API 域名都需切换时，在同一环境中各写一行 `IP 域名`。

工具使用 `--host-resolver-rules`，并为环境窗口设置 `--no-proxy-server`，不修改系统 hosts、DNS 或代理。依赖公司代理才能访问的网络可能无法直连。

**改 IP 后请重新打开环境窗口。** 规则版本不同会使用新的配置目录，避免正在运行的 Chrome 忽略新参数。旧窗口和旧登录数据保留，请关闭不再使用的窗口。可在环境窗口的 `chrome://version/` 查看配置路径和启动参数。

浏览器存储隔离不能改变服务器规则。若服务器本身限制同时登录、两套环境共享会话撤销机制或凭据不兼容，仍可能需要分别登录。

## 带入已有信息

- **带入网站登录**：先在原 Chrome 打开并登录相应网站，保持它为当前标签，关闭目标环境的全部窗口，再点此按钮。复制所配置域名中适用于当前网址及域名首页的 Cookie，以及当前页 localStorage / sessionStorage，然后在独立窗口打开同一地址。读取不会导航原网页或清理原登录；HttpOnly、Secure、主机专属 Cookie 的约束保留。
- **同步 Chrome 资料**：在对应环境打开 Chrome 自带同步设置。登录原 Google 账户，通过 [Chrome 同步](https://support.google.com/chrome/answer/185277?hl=zh-Hans)取回密码、书签和自动填充。需要能连接 Google 服务；工具不会复制 Chrome 密码库或代你登录 Google。

网站登录导入最多 8 MiB，可能替换目标中的同名 Cookie 和存储键。只导入一次，后续刷新不会覆盖环境内更新。服务器不接受原凭据、设备绑定登录、分区 Cookie 或 IndexedDB 登录存储等情况不能保证继承，需在新窗口登录。Chrome 资料同步与网站登录是两件事。

带入登录通过本机匿名管道传递，没有中间明文文件，也不开放调试 TCP 端口。导入完成会解除页面调试；轻量助手只保留 Chrome 需要的管道句柄并等待窗口退出，不轮询。

## 隐藏读取登录时的调试提示

日常打开独立窗口不需要附加页面调试器。「带入网站登录」会短暂附加调试器，Chrome 可能显示提示。

希望隐藏时，先保存工作并完全退出 Chrome（包括独立环境窗口和后台 Chrome），再双击 **隐藏调试提示启动Chrome.cmd**。它沿用原 Chrome 配置，添加 `--silent-debugger-extension-api`。这个参数影响本次 Chrome 内所有扩展的调试提示；脚本不会自动结束浏览器进程，也不修改原快捷方式。下次从原 Chrome 图标启动时恢复默认提示行为。

## 本地数据与卸载

没有遥测或网页内容日志，不安装证书、不关闭 HTTPS 校验，不监听本机网络端口。主动复制的站点登录只通过本机管道交给助手并写入所选环境的 Chrome；Chrome 本身会正常保存浏览数据。

扩展规则保存在 Chrome 本地存储，独立环境数据位于 `%LOCALAPPDATA%\HostDeck\profiles`。助手只允许上述固定扩展 ID 通过管道调用。

在 Chrome 中移除扩展，运行「卸载助手.cmd」移除当前用户 Native Messaging 注册。文件和环境资料保留，不会自动删除；其他插件注册不受影响。

## 源码构建与验证

源码包 `HostDeck-1.3.0-source.zip` 不包含构建产物、浏览器资料或依赖目录。构建需要 Windows、Node 22+（仅用于构建和测试）、Visual Studio C++ x64 Build Tools 和 Windows SDK。JSON 解析器为 [picojson 1.3.0](https://github.com/kazuho/picojson/releases/tag/v1.3.0)，许可证随安装包提供。

```powershell
npm ci
npm run build
npm test
npm run package
```

浏览器验证需 Playwright 库和可加载扩展的 Chromium，独立环境验证使用本机 Google Chrome。全部使用虚构账号、本地服务和测试配置：

```powershell
$env:PLAYWRIGHT_MODULE = '你的 playwright 包目录'
$env:CHROMIUM_EXECUTABLE = '你的 Chromium chrome.exe 路径'
powershell.exe -NoProfile -ExecutionPolicy Bypass -File tests/release-browser.ps1
```

验证范围、回归证据及未执行项见 `docs/verification.md`。测试配置、私钥、原始输出不进入发行包。
