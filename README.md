# LeafSeamer GUI

施工中。已提供可构建的简中／英文、浅色／深色工作台，经 SDK 接入 Controller 的人员登录、显式续期、退出、持久设备目录和控制状态读取。尚未提供设备写入、实时订阅、Seamer 自动化编辑及运行、完整管理和部署安装；不能用于实际直播控制。

## 构建与装配

使用 Node 24.22.0、npm 11.19.1。相邻 `leafseamer-sdk` 必须先构建为 [sdk-runtime.json](sdk-runtime.json) 固定的输入，安装采用锁文件。

```sh
npm ci --ignore-scripts
npm test
npm run build
```

无配置构建只生成未配置站点，不允许登录。实际装配先取得目标 Controller 业务库的持久 `service_id` 与 `database_instance_id`，在本地准备只含以下三个字段的 JSON 文件；两个标识填写该业务库的真实 UUID，不生成替代值。

```json
{
  "site_label": "本机 Controller",
  "service_id": "目标服务 UUID",
  "database_instance_id": "目标业务库 UUID"
}
```

运行 `npm run build -- --config <配置文件>` 生成 `dist`。该配置没有密码、令牌或服务 URL。Controller 的可信本地装配调用 `startController`，提供现有 TLS／认证提供者及 `guiDirectory` 指向此 `dist` 的绝对目录。服务启动时校验合同、SDK 清单摘要、站点持久身份与全部静态文件摘要，之后仅交付已固定的内存字节。GUI 必须与 Controller 共用 HTTPS 根入口；不通过查询参数选择服务，不依赖跨域代理，也不允许明文入口登录。生产认证提供者、TLS 安装和组合启动仍由 Controller／Suite 的相应实现与验收负责。

## 会话与读取行为

浏览器管理 `/auth` 路径的 Secure、HttpOnly、SameSite=Strict Cookie；CSRF 和定向 token 仅由 SDK 保存在内存。页面只持久保存语言、主题两项偏好，密码提交后立即清空表单。刷新页面清空内存会话，不自动续期、重试或重发写入。

目录读取按同一修订分页，完整读取后才显示，最多64页／4096设备；修订变化、重复设备或游标停止本次读取。控制记录必须属于配置的服务及数据库，未读取与已知零值分别显示。所有数字版本保持十进制原文，读取时间是浏览器本地记录，不是权威认证时钟。页面展示最近读取结果，没有自动同步或设备完成保证。

会话续期为显式操作，成功后清空设备视图；退出202只表示本地会话撤销已确认，远端传播仍待确认。网络异常时清空本页凭据，保留服务端结果未知的提示。无读取权限的账户不显示合成设备或假控制值。

## 验证范围

类型检查和六项状态管理测试覆盖分页一致性、精确服务归属、大整数、权限不足、迟到响应、并发抑制和失败退出。Controller 侧另测静态资源摘要／路径／身份校验、HTTPS限制、HEAD及CSP。

`test/browser-check.mjs` 使用相邻 Controller 的隔离夹具启动真实 HTTPS、SQLite 和原生采样器，再通过独立 Edge 运行十项浏览器检查：登录成功和失败、Cookie限制、设备读取、键盘焦点、显式续期、语言主题、窄屏、退出及权限／资格失效。显式传入已安装 Playwright 的模块入口和 Edge 可执行文件路径；测试仅信任夹具临时证书公钥，不修改系统证书库或用户浏览器资料。产物位于忽略的 `logs/gui-session`。

上述浏览器成功使用合成环境批准、账户和设备，不代表平台批准、真实设备、正式部署或完整 UIT01—UIT40 验收。当前 SDK 完整静态校验器使脚本约7.9 MB，窄带首次加载尚待优化和验收。完整范围与退出条件见 Suite 的整体完成清单。

许可见 [LICENSE](LICENSE) 和 [第三方许可](THIRD_PARTY_NOTICES.md)。
