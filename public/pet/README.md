# 宠物资源槽位

固定文件名，对应 [store.ts](../../src/store.ts) 里的 `PetStatus`，由 [spriteRenderer.ts](../../src/spriteRenderer.ts) 读取。
以后动画渲染层要接真正的骨骼动画时，直接写一个新的 `PetRenderer` 实现替换 `petView.ts` 里
`new SpriteRenderer(root)` 这一行即可，文件名/路径约定不用变。

| 文件 | 对应状态 | 当前初始内容（来自 `chester_states_all/`） |
| --- | --- | --- |
| `waiting.gif` | 等待 (`waiting`) | `idle_loop_down.gif` |
| `open.gif` | 打开 (`open`)，悬浮或面板打开时都用这张 | `open.gif`（原名就是 open，直接对应） |
| `moving.gif` | 移动 (`moving`)，左右共用一张 | `walk_loop_side.gif`（侧面视角） |

**移动没有存两份"向左/向右"的文件**：`moving.gif` 是侧面视角的行走图，左右两个方向靠
`spriteRenderer.ts` 在渲染时用 CSS `transform: scaleX(-1)` 水平镜像同一张图来区分，不用为
两个方向各存一份接近重复的动图。默认没镜像时按"向右"处理——如果实际看起来是反的（`walk_loop_side.gif`
本身朝向不确定），把 `spriteRenderer.ts` 里 `direction === "left"` 那一处判断反过来就行，不用换图。

`chester_states_all/` 里还有别的候选（比如 `idle_loop_side.gif`、`idle_loop_open.gif`），如果这几个初始选择
不满意，直接换一张同名覆盖即可，不用改代码或问我。

这几个文件放在 Vite 的 `public/` 目录下，构建后原样输出到产物根目录，运行时用绝对路径 `/pet/waiting.gif`
等即可引用，不会被 Vite 加 hash（方便直接覆盖替换）。
