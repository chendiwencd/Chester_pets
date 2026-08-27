# 构建说明

前置：Node.js（已用 v24）+ Rust stable-MSVC 工具链（已安装，本机 `cargo` 可用）。产品功能总览见 [README.md](./README.md)。

## 1. Rust 工具链（一次性，已装可跳过）

Windows 上装 MSVC 版 stable：

```bash
winget install Rustlang.Rustup
```

或访问 https://www.rust-lang.org/tools/install 下载 `rustup-init.exe`。装完新开终端确认 `cargo --version`。Tauri 前置依赖（WebView2、VS C++ 生成工具）见 https://tauri.app/start/prerequisites/ ，Win10/11 一般自带 WebView2。

> 注意：`cargo` 装好后 PATH 只对**新开的**终端生效，旧终端里 `npm run tauri dev` 可能仍报 `program not found`，重开终端即可。

## 2. 安装依赖 + 校验

```bash
cd client_pc/desktop-shell
npm install
```

```bash
npm run test
```

```bash
npm run build
```

```bash
cd src-tauri
cargo check
```

`cargo check` 首次会下载并编译全部依赖（含 single-instance / autostart / global-shortcut / clipboard-manager 等插件），耗时约 1~2 分钟，之后增量很快。

## 3. 联调

```bash
cd client_pc/desktop-shell
npm run tauri dev
```

- Vite dev 端口用的是 **5173**（默认 1420 在本机落进 Windows 保留端口区间会 `EACCES`，已改）。
- 改 **前端**（`src/`）热更新即时生效；改 **Rust**（`src-tauri/`）会自动重编重启。
- 终端会打印大量 `[windows] ... `/`[panel visibility] ...`/`[open_storage] ...` 诊断日志，排查窗口定位/面板显示时看这些。
- 对照 [README.md](./README.md) 的功能一览逐项验证：悬浮/长按拖动/三段点击循环/跨屏/边界翻转/监控模式下剪贴板同步。

## 4. 打包安装器

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/nsis/*.exe`（`tauri.conf.json` 的 `bundle.targets` 只出 `nsis`，即 Windows 安装包）。

`src-tauri/icons/` 目前是脚手架默认图标（占位），正式发布前替换成真实产品图标即可（同名覆盖，不用改配置路径）。

## 状态

| 步骤 | 状态 |
| --- | --- |
| `npm install` / `npm run test`（vitest，10 用例）/ `npm run build` | ✅ 已跑通 |
| `cargo check` | ✅ 已跑通（0 warning） |
| `npm run tauri dev` | ✅ 已跑通（真机联调，跨屏/面板/剪贴板已验证并修复） |
| `npm run tauri build` | ⬜ 待执行（出正式安装包时再跑） |

## 注意事项

- **开机自启**在 `tauri dev` 下会把“开发时的 exe 路径”写进注册表，正式行为要以打包安装后的版本为准。
- 全局快捷键 **Ctrl+Shift+V** 常驻注册；若和别的软件冲突，在 `lib.rs` 的 `STORAGE_SHORTCUT` 改。
- 运行时数据在 `%APPDATA%/com.hbb.desktop-pet/`（位置、SQLite 历史、设置、images/、工作目录配置），清空它相当于重置。
