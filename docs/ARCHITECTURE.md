# 桌面宠物 · 桌面交互层 代码架构

配合 [PRODUCT_SPEC.md](./PRODUCT_SPEC.md)（做什么）阅读，本文档是"怎么做"：模块划分、数据/事件怎么流动、以后接动画渲染层/后端服务层时该改哪里。

## 在整体产品里的位置

```
桌面交互层(Tauri，本目录)  +  动画渲染层(未开始)  +  后端服务层(未开始)
```

本目录只负责"窗口 + 输入手势 + 系统集成"，不画真正的宠物贴图（现在用文字状态占位），也不联真实后端（`backendClient` 是本地 mock）。这两个预留口子在最下面单独说明。

## 窗口模型：4 个真实 OS 窗口，不是 4 个 div

```
main（宠物，120x120，无边框置顶）
panel-img / panel-text / panel-web（3 个内容面板，220x260，无边框置顶）
```

四个窗口全程只有"隐藏/显示"，从不销毁：
- 面板关闭时是 `hide()`，内容还在，下次打开面板不用重新粘贴
- 宠物窗口被关闭（Alt+F4 等）时也只是 `hide()`，靠托盘菜单"显示/隐藏宠物"找回；只有托盘"退出"才真正结束进程

这个"只隐藏不销毁"的规则统一写在 [lib.rs](../src-tauri/src/lib.rs) 的 `on_window_event` 里，靠窗口 `label` 前缀判断（`main` / `panel-*`），不用在每个窗口单独处理。

## 目录结构

```
src-tauri/src/
  lib.rs         应用入口：注册插件、托盘、启动时按持久化坐标建主窗口，全局的"只隐藏不销毁"规则
  state.rs        宠物位置的读写(app_config_dir/pet_position.json) + 面板开关的进程内状态(AppState)
  windows.rs       主窗口/面板窗口的构造参数(无边框/置顶/尺寸)，面板相对宠物的偏移量
  tray.rs          托盘图标 + 菜单(显示/隐藏宠物、退出)
  commands.rs       前端能调的两个命令：save_pet_position、toggle_panel
  clipboard.rs      Ctrl+V 触发后：读剪贴板→按 图片/网页/文本 分类→只推给对应那个面板窗口

src/
  holdStateMachine.ts  纯逻辑状态机：长按(350ms)/悬浮意图(500ms)/单击/拖动判定，不碰 DOM 和定时器
  store.ts              PetStatusStore：悬浮/拖动/面板开关三个信号 -> 计算出"等待/打开/移动"状态
  renderer.ts            渲染接口 PetRenderer + 参考实现 TextRenderer（纯文字，早期占位用，现在没在用）
  spriteRenderer.ts        实际在用的渲染器：按状态读 public/pet/*.gif，moving 状态按方向水平镜像
  backendClient.ts        后端桩接口，当前本地 mock（预留给后端服务层的口子）
  petView.ts               宠物窗口的胶水代码：把 DOM 指针事件接到状态机，状态机的回调接到 Tauri API，
                             同时按拖动的水平位移方向维护 moving 的左右朝向
  panelView.ts              面板窗口的胶水代码：监听 panel-content 事件，按自己的 kind 渲染图片/文本/链接
  main.ts / panelMain.ts     两个窗口各自的入口文件
index.html / panel.html      两个窗口各自的 HTML 外壳（panel.html 被 3 个面板窗口共用）
public/pet/                  三个状态的 gif 资源槽位，见该目录下的 README.md
tests/holdStateMachine.test.ts   状态机单测，覆盖悬浮意图/长按/单击/拖动的各种时序分支
```

## 前端内部的数据流

```
DOM 指针事件
   │  (petView.ts 起 350ms/500ms 计时器，到点调用对应方法)
   ▼
HoldStateMachine（纯状态机）
   │  onHoverChange / onDragStart / onDragMove / onDragEnd / onClick
   ▼
petView.ts 的回调实现
   ├─ store.setHovering/setDragging(...)  ──▶ PetStatusStore ──▶ renderer.render(status, direction) 换图
   ├─ appWindow.setPosition(...)           拖动时宠物窗口实时跟随光标；水平位移方向决定 direction
   └─ invoke("toggle_panel" / "save_pet_position")   调用 Rust 命令
```

`moving` 状态的左右方向不经过 `PetStatusStore`（它只管"等待/打开/移动"三态，不关心方向），
是 `petView.ts` 自己在 `onDragMove` 里对比连续两次的水平坐标直接算出来的，方向变化时直接调
`renderer.render()`，不等 store 广播。

`HoldStateMachine` 本身不 `setTimeout`，是为了单测能直接按顺序调方法模拟"计时器到点"或"到点前已取消"，不用伪造定时器或真的等待。这也是为什么长按和悬浮意图长得很像：两个计时器都是"外部起、到点告诉状态机"的同一套模式。

## IPC 契约

**命令（JS -> Rust，`invoke(...)`）**

| 命令 | 参数 | 作用 |
| --- | --- | --- |
| `toggle_panel` | 无，返回 `bool` | 切换面板开关；打开时按宠物当前坐标重新摆放 3 个面板并注册全局 Ctrl+V，关闭时隐藏面板并注销快捷键。返回切换后的开关状态，前端用它同步本地的"打开/等待"显示文字 |
| `save_pet_position` | `x, y`（逻辑像素） | 拖动结束后写入 `pet_position.json`，下次启动还原坐标 |

**事件（Rust -> JS，定向发送）**

| 事件 | 目标窗口 | payload |
| --- | --- | --- |
| `panel-content` | `panel-img` / `panel-text` / `panel-web` 之一 | `{ kind: "image"\|"text"\|"web", value: string }`（图片是 base64 data URL，文本/网页是原始字符串） |

命令和事件都刻意保持最小——面板的定位、显隐、内容分类都在 Rust 侧决定，前端只负责"转达用户操作"和"把收到的内容画出来"，不做业务判断。

## 状态持久化

`state.rs` 把宠物坐标存成 `{ x, y }` JSON，路径是 `app_config_dir()/pet_position.json`（Windows 上大概是 `%APPDATA%/com.hbb.desktop-pet/pet_position.json`）。坐标全程用**逻辑像素**：`petView.ts` 存的时候会把 `outerPosition()` 拿到的物理像素按 `scaleFactor()` 换算成逻辑像素，`windows.rs` 建窗口时用的 `WebviewWindowBuilder::position()` 本身吃的也是逻辑像素——两头统一单位，非 100% 缩放屏幕上位置才不会跑偏（这也是这次修的拖动 bug 的根因，见下面"已知问题与修复记录"）。

面板开关状态（`AppState.panel_open`）只在进程内存里，不持久化——重启后面板默认关闭，这是有意的，不算 bug。

## 预留给另外两层的接口

- **动画渲染层**：`renderer.ts` 的 `PetRenderer` 接口只有一个方法 `render(status)`。现在 `TextRenderer` 只是把状态文字塞进 DOM；以后接真的贴图/骨骼动画，写一个实现同样接口的 `SpriteRenderer` 换掉 `petView.ts` 里 `new TextRenderer(root)` 这一行就行，状态机和事件绑定完全不用动。初始资源已经放在 `public/pet/{waiting,open,moving}.gif`（取自 `chester_states_all/`，见该目录下 [README.md](../public/pet/README.md)），文件名和路径是定死的约定，`SpriteRenderer` 直接读这三个固定路径即可。
- **后端服务层**：`backendClient.ts` 的 `BackendClient` 接口有 `reportStatus()` / `fetchPetConfig()`，现在都是本地 mock（`console.debug` / 返回空对象）。以后要上报状态或拉配置，换成真的 HTTP/WebSocket 实现即可，调用方（`petView.ts`）不感知具体传输方式。

## 已知问题与修复记录

- **拖动跑偏（已修复）**：最初拖动时把 DOM 的 `screenX/screenY`（CSS/逻辑像素）直接当成 `PhysicalPosition`（物理像素）喂给 `setPosition`，在非 100% 缩放的屏幕上宠物会跟不上或跳动。改成 `LogicalPosition` 后单位一致，问题解决；相应地持久化坐标也统一成逻辑像素（见上面"状态持久化"）。
- **悬浮意图延迟**：最初鼠标一进宠物窗口就立刻变"打开"，容易划过就误触发；现在要求停留满 500ms 才生效，移出则立刻取消（不需要等 500ms）。
- **面板"打开了但看不见"（已修复）**：这个查了好几轮，根因是**没有把窗口位置限制在可见屏幕内**。这台机器是 150% DPI + 双显示器，且两块屏没有拼成完整矩形（DISPLAY1 到 x=2560 结束，DISPLAY2 从 x=3840 才开始，中间 1280px 是任何屏幕都覆盖不到的空隙）。宠物被拖到屏幕右下角后，三个面板按偏移量摆出去分别落在"屏幕底部以下""DISPLAY1 右边界以外""双屏空隙里"——窗口确实创建了、`show()` 也返回成功、日志一切正常，但用户什么都看不到，表现得和"面板压根没打开"一模一样。现在 `windows.rs` 里加了 `clamp_to_visible_area()`：挑一块和目标矩形重叠面积最大的显示器（完全不重叠时退回主显示器），把矩形夹进这块显示器范围内；面板定位和宠物启动还原位置都走这个函数。夹取必须在**物理像素**空间做，因为显示器边界本身就是物理像素给的。
- **排查方法备忘**：这轮真正定位到问题靠的是两个手段，以后再遇到类似"看起来什么都没发生"可以直接复用。其一，`npm run tauri dev` 的输出经 PowerShell `Out-String` 会被缓冲到进程结束才吐出来，看着像"没有日志"；直接跑 `target/debug/desktop-shell.exe` 并重定向 stdout 就能实时看到。其二，前端逻辑可以脱离 Tauri 单独验证——用浏览器打开 vite 的 `localhost:5173`，注入一个假的 `window.__TAURI_INTERNALS__`（记录 `invoke` 调用而不真的发出去），再用 `dispatchEvent` 派发合成的 pointer 事件，就能确认点击链路到底有没有走到 `invoke("toggle_panel")`，把"前端没触发"和"后端没生效"彻底分开。
- **点击不显示面板 / 前端排查手段不足**：之前 `invoke("toggle_panel")`、`invoke("save_pet_position")`、`setPosition()` 的返回结果都被 `void` 掉了，一旦运行时报错（比如权限、窗口找不到）前端和终端都看不到任何提示，只会表现成"看起来什么都没发生"。现在这三处都加了 `.catch(console.error)`，Rust 侧 `toggle_panel` 里每个提前 `return` 分支也加了 `eprintln!`；同时发现 `store.setPanelOpen()` 之前压根没被调用过，点击后本地状态文字不会跟着面板开关走——`toggle_panel` 改成返回 `bool`，前端拿到返回值后调用 `store.setPanelOpen(open)` 补上了这条链路。**如果这轮之后面板还是不出现，下次麻烦把 `tauri dev` 终端和浏览器 devtools 控制台里的报错发过来**，现在应该能看到具体是哪一步失败了。

## 参考

- 产品行为定义：[PRODUCT_SPEC.md](./PRODUCT_SPEC.md)
- 装 Rust / 编译 / 联调 / 打包步骤：[BUILD.md](../BUILD.md)
