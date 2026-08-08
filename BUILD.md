# 构建说明

本机（写代码时）没有安装 Rust，所以下面这些步骤都还没跑过，仅在这里写清楚命令，等装好 Rust 后请按顺序执行并核对结果。

## 1. 安装 Rust 工具链（一次性）

Windows 上装 MSVC 版 stable 工具链：

```bash
winget install Rustlang.Rustup
```

或访问 https://www.rust-lang.org/tools/install 下载 `rustup-init.exe` 手动安装。装完重开一个终端，确认：

```bash
rustc --version
cargo --version
```

Tauri 官方前置依赖（WebView2、VS Build Tools 的 C++ 组件等）参考 https://tauri.app/start/prerequisites/ ，Windows 10/11 一般已自带 WebView2 Runtime，可以跳过。

## 2. 先跑一次 cargo check

在装好 Rust 后，第一步不是直接 `tauri dev`，而是先单独检查 Rust 代码能不能编译通过：

```bash
cd client_pc/desktop-shell/src-tauri
cargo check
```

**重点核对 `src/clipboard.rs`**——这是本轮唯一没有把握 100% 匹配官方插件当前版本 API 的文件，用到了：
- `tauri_plugin_clipboard_manager::ClipboardExt`（`.clipboard().read_image() / .read_text()`，`Image` 的 `.width()/.height()/.rgba()`）
- `tauri_plugin_global_shortcut`（`Builder::new().with_handler(...)`，`GlobalShortcutExt` 的 `.global_shortcut().register()/.unregister()`）

如果 `cargo check` 报这两个插件相关的方法名/类型不对，去 https://docs.rs/tauri-plugin-clipboard-manager 和 https://docs.rs/tauri-plugin-global-shortcut 查当前版本的实际签名，照着改 `clipboard.rs` 和 `commands.rs`/`lib.rs` 里对应的调用点即可，不影响其它模块。

## 3. 联调

```bash
cd client_pc/desktop-shell
npm run tauri dev
```

预期效果对照 `docs/PRODUCT_SPEC.md`：悬浮/点击开关面板/长按 350ms 拖动/面板打开时 Ctrl+V 分流图片-文本-网页。

## 4. 打包安装器

```bash
npm run tauri build
```

产物在 `src-tauri/target/release/bundle/nsis/*.exe`（`tauri.conf.json` 里 `bundle.targets` 已设为只出 `nsis`，即 Windows 安装包）。

`src-tauri/icons/` 目前是脚手架自带的默认图标（占位），正式商用前需要替换成真实产品图标，替换后图片本身会被打进对应尺寸，不用改 `tauri.conf.json` 里的路径。

## 已跑过 / 还没跑过

| 步骤 | 状态 |
| --- | --- |
| `npm install` | ✅ 已跑通 |
| `npm run test`（vitest，7 个用例） | ✅ 已跑通 |
| `npm run build`（纯前端 Vite/tsc，不涉及 Rust） | ✅ 已跑通 |
| `cargo check` | ✅ 已跑通（0 warning，clipboard-manager / global-shortcut 插件 API 一次通过） |
| `npm run tauri dev` | ⬜ 待执行（需要打开真实窗口，无头环境下没跑） |
| `npm run tauri build` | ⬜ 待执行 |
