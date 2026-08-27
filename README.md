# DesktopPet · 桌面交互层

桌面宠物 + 剪贴板管理器。整体产品分三层：**桌面交互层（本目录，Tauri）+ 动画渲染层 + 后端服务层**。本目录只负责窗口、输入手势、系统集成与剪贴板；动画渲染层和后端服务层预留了替换点，尚未接入。

- 构建 / 打包步骤见 [BUILD.md](./BUILD.md)
- 宠物动画资源约定见 [public/pet/README.md](./public/pet/README.md)

## 功能一览

**宠物本体**
- 无边框、置顶、透明背景的小窗口，桌面上直接显示 Chester 的 gif（不带底色/边框）。
- 四种状态各一张 gif：等待 / 打开 / 移动 / 休眠（资源见 `public/pet/`）。
- 悬浮满 500ms → “打开”；长按 ≥ 350ms → 进入“移动”，宠物滑向光标；移动时按水平方向左右镜像。
- 待机时每隔 12~30s 自己走一小段短距离（漫步，走的是正常移动动画）；长时间无操作进入“休眠”。
- 点击宠物是三段循环：**等待 → 打开（三个面板） → 存储区（剪贴板历史） → 等待**。

**剪贴板 / 存储**
- 托盘「监控模式」开启后，后台每 450ms 同步一次系统剪贴板最新内容到历史；关闭后停止持续收集，但不影响素材区查看已有历史。
- 存储：图片写成 `.png` 文件放 `app_data_dir/images/`；放入的文件和记事本附件复制到工作目录；SQLite 保存历史记录、记事本正文，以及图片/文件的路径、名称、大小、类型等元数据。
- 三个内容面板（图片 / 文本 / 网页输入）用木牌背景（`board.png`）贴在宠物旁边；第三个面板带输入框，手动输入的内容作为「记事本」类别存入历史。
- 存储区（preview 窗口）按三类区分：**文本**（剪贴板文本/链接）、**图片**、**记事本**（第三面板手动输入）；支持分类筛选、置顶、删除、复制回剪贴板、点图看原图。
- 历史上限 100 条，超出时删最旧的**未置顶**项（置顶内容不会被挤掉）。
- 时间戳分档显示：当天只显示 时:分；当年其它日期显示 月-日 时:分；往年显示 年-月-日 时:分。

**系统集成 / 商业化基础**
- 系统托盘菜单：显示/隐藏宠物、**召回宠物**、监控模式、打开控制面板、退出。
- 全局快捷键 **Ctrl+Shift+V** 打开存储区。
- **开机自启**（控制面板「设置」页开关，默认关）。
- **单实例保护**：第二次启动唤醒已有宠物，不再开新进程。
- 宠物位置持久化，重启还原（并自动钳制进可见屏幕）。

## 窗口模型

全部是真实 OS 窗口，只隐藏不销毁（关闭按钮/失焦只隐藏，托盘「退出」才结束进程）：

| label | 用途 |
| --- | --- |
| `main` | 宠物本体 |
| `panel-img` / `panel-text` / `panel-web` | 三个内容面板（图片/文本/网页输入） |
| `preview` | 存储区（剪贴板历史） |
| `image-viewer` | 看原图（缩放/拖动） |
| `control-panel` | 控制面板（个人/宠物/设置） |

## 代码结构

```
src-tauri/src/
  lib.rs         入口：注册插件(单实例/剪贴板/自启/全局快捷键)、托盘、启动还原、全局失焦/关闭规则、注册全局快捷键
  commands.rs     前端可调命令 + open_storage/recall_pet 等实现
  clipboard.rs    监控线程 + 剪贴板分流；图片写 .png，历史和资源元数据写 SQLite
  windows.rs      各窗口构造；跨屏定位(全物理坐标)、显示器钳制、面板边界翻转布局
  state.rs        持久化(位置/历史/设置)、images_dir/texts_dir、AppState
  settings.rs     监控模式的读写 + 托盘刷新
  tray.rs         托盘图标与菜单
src/
  petView.ts        宠物窗口：手势状态机接线、物理坐标拖动/漫步、三段点击循环、休眠计时
  holdStateMachine.ts  纯逻辑手势状态机(长按/悬浮/单击/拖动)，可单测
  spriteRenderer.ts    按状态读 public/pet/*.gif，移动按方向镜像
  store.ts / renderer.ts / backendClient.ts  状态、渲染接口、后端桩(预留)
  panelView.ts / previewView.ts / controlPanelView.ts / imageViewer.ts  各窗口视图
  media.ts          resolveImageSrc：把历史里的图片文件路径按需读回 data URL 用于显示
public/pet/         宠物 gif 资源 + board.png 面板背景
tests/              holdStateMachine 单测(vitest)
```

## 关键设计点

- **跨屏定位全程用物理坐标**：拖动跟随 `cursorPosition()`（全局物理光标），窗口用 `setPosition(PhysicalPosition)`，子窗口偏移用**宠物所在屏的缩放**换算——避免多屏 + 非 100% 缩放下逻辑/物理坐标混用导致窗口跑到别的屏或屏幕外。所有 `setPosition` 最后都钳制进“显示器并集”。
- **面板边界翻转**：三个面板按可用空间选侧（放不下就翻到另一侧），各占一侧，不盖宠物、不互相重叠、始终整块可见。
- **图片文件化存储**：图片历史条目的 `value` 是 `.png` 文件路径，显示时按需经 `read_image_data_url` 读回；文本/记事本内联存储。手动输入的内容用独立的 `note` 类别，在存储区与剪贴板文本/图片区分。

## 预留给另外两层的接口

- **动画渲染层**：`renderer.ts` 的 `PetRenderer` 接口；现在是读 gif 的 `SpriteRenderer`，以后可替换为骨骼动画实现，交互层不用改。
- **后端服务层**：`backendClient.ts` 的桩接口，现在本地 mock；以后接 HTTP/WebSocket 时只替换这个模块。AI 相关能力应放在后端层（API key 不能进分发的客户端）。

## 运行时数据位置（Windows）

`%APPDATA%/com.hbb.desktop-pet/`：`pet_position.json`、`settings.json`、`content.sqlite3`、`images/*.png`。默认工作目录为当前用户主目录下的 `user/chesterbot/workspace/`，可在设置中修改。
