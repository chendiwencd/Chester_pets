import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";

type SectionKey = "personal" | "pet" | "settings";

// 开关行：左侧标题+说明，右侧一个可点击的开关。initial 决定初始状态，
// onChange 返回“落地后的真实状态”（命令可能失败），据此回写 UI，避免 UI 和系统实际状态不一致。
function createToggleRow(
  title: string,
  description: string,
  initial: boolean,
  onChange: (next: boolean) => Promise<boolean>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "control-panel-setting-row";

  const textWrap = document.createElement("div");
  textWrap.className = "control-panel-setting-copy";
  const heading = document.createElement("div");
  heading.className = "control-panel-setting-title";
  heading.textContent = title;
  const desc = document.createElement("div");
  desc.className = "control-panel-setting-desc";
  desc.textContent = description;
  textWrap.append(heading, desc);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.className = "control-panel-toggle";
  let state = initial;
  const sync = () => {
    toggle.classList.toggle("is-on", state);
    toggle.setAttribute("role", "switch");
    toggle.setAttribute("aria-checked", String(state));
    toggle.textContent = state ? "开" : "关";
  };
  sync();
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    const desired = !state;
    try {
      state = await onChange(desired);
    } catch (err) {
      console.error("[controlPanelView] toggle onChange failed", err);
    } finally {
      sync();
      toggle.disabled = false;
    }
  });

  row.append(textWrap, toggle);
  return row;
}

function createNavButton(label: string, active: boolean, onClick: () => void): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = `control-panel-nav-button${active ? " is-active" : ""}`;
  button.textContent = label;
  button.addEventListener("click", onClick);
  return button;
}

function createPlaceholderRow(title: string, description: string, extra?: string): HTMLElement {
  const row = document.createElement("div");
  row.className = "control-panel-setting-row";

  const textWrap = document.createElement("div");
  textWrap.className = "control-panel-setting-copy";

  const heading = document.createElement("div");
  heading.className = "control-panel-setting-title";
  heading.textContent = title;

  const desc = document.createElement("div");
  desc.className = "control-panel-setting-desc";
  desc.textContent = description;

  textWrap.append(heading, desc);

  const badge = document.createElement("span");
  badge.className = "control-panel-badge";
  badge.textContent = extra ?? "保留";

  row.append(textWrap, badge);
  return row;
}

function renderPersonalSection(content: HTMLElement): void {
  content.innerHTML = "";

  const title = document.createElement("h1");
  title.className = "control-panel-title";
  title.textContent = "个人";

  const grid = document.createElement("div");
  grid.className = "control-panel-card-grid";

  const loginCard = document.createElement("section");
  loginCard.className = "control-panel-card";
  loginCard.innerHTML = `
    <h2 class="control-panel-card-title">登录页</h2>
    <div class="control-panel-form">
      <label class="control-panel-field">
        <span>账号</span>
        <input type="text" placeholder="预留" disabled />
      </label>
      <label class="control-panel-field">
        <span>密码</span>
        <input type="password" placeholder="预留" disabled />
      </label>
      <button type="button" class="control-panel-primary-button" disabled>登录</button>
    </div>
  `;

  const profileCard = document.createElement("section");
  profileCard.className = "control-panel-card";
  profileCard.innerHTML = `
    <h2 class="control-panel-card-title">个人信息</h2>
    <div class="control-panel-profile">
      <div class="control-panel-avatar">ME</div>
      <div class="control-panel-profile-list">
        <div><span>昵称</span><strong>预留</strong></div>
        <div><span>邮箱</span><strong>预留</strong></div>
        <div><span>状态</span><strong>未登录</strong></div>
      </div>
    </div>
  `;

  grid.append(loginCard, profileCard);
  content.append(title, grid);
}

function renderPetSection(content: HTMLElement): void {
  content.innerHTML = "";

  const title = document.createElement("h1");
  title.className = "control-panel-title";
  title.textContent = "宠物信息";

  const card = document.createElement("section");
  card.className = "control-panel-card";
  card.innerHTML = `
    <h2 class="control-panel-card-title">保留位置</h2>
    <p class="control-panel-muted">
      这里预留给宠物档案、状态说明、成长信息等内容，当前仅保留结构。
    </p>
  `;

  content.append(title, card);
}

async function renderSettingsSection(content: HTMLElement): Promise<void> {
  content.innerHTML = "";

  const title = document.createElement("h1");
  title.className = "control-panel-title";
  title.textContent = "设置";

  const card = document.createElement("section");
  card.className = "control-panel-card control-panel-settings-card";

  // 开机自启：默认关。初始状态从后端(系统注册表实际状态)读，切换后回写真实结果。
  let autostartInitial = false;
  try {
    autostartInitial = await invoke<boolean>("get_autostart");
  } catch (err) {
    console.error("[controlPanelView] get_autostart failed", err);
  }
  card.append(
    createToggleRow(
      "开机自启",
      "登录 Windows 后自动启动桌面宠物。",
      autostartInitial,
      (next) => invoke<boolean>("set_autostart", { enabled: next }),
    ),
  );

  card.append(
    createPlaceholderRow("清空记忆", "保留项，后续用于清理历史与记忆数据。"),
    createPlaceholderRow("记忆导出", "保留项，后续用于导出本地记忆内容。"),
    createPlaceholderRow("形成记忆", "保留项，后续用于整理与生成结构化记忆。"),
    createPlaceholderRow("导入记忆", "保留项，后续用于导入外部记忆数据。"),
  );

  content.append(title, card);
}

export async function initControlPanelView(root: HTMLElement): Promise<void> {
  const appWindow = getCurrentWindow();
  let activeSection: SectionKey = "personal";

  const render = () => {
    root.innerHTML = "";

    const dragBar = document.createElement("div");
    dragBar.className = "control-panel-dragbar";
    dragBar.addEventListener("pointerdown", (event) => {
      if ((event.target as HTMLElement).closest(".control-panel-close")) return;
      appWindow.startDragging().catch((error) => {
        console.error("[controlPanelView] startDragging failed", error);
      });
    });

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "control-panel-close";
    closeButton.setAttribute("aria-label", "关闭");
    closeButton.textContent = "×";
    closeButton.addEventListener("click", () => {
      appWindow.hide().catch((error) => {
        console.error("[controlPanelView] hide failed", error);
      });
    });

    const layout = document.createElement("div");
    layout.className = "control-panel-layout";

    const sidebar = document.createElement("aside");
    sidebar.className = "control-panel-sidebar";

    const navTop = document.createElement("div");
    navTop.className = "control-panel-nav-top";
    navTop.append(
      createNavButton("个人", activeSection === "personal", () => {
        activeSection = "personal";
        render();
      }),
      createNavButton("宠物信息", activeSection === "pet", () => {
        activeSection = "pet";
        render();
      }),
    );

    const navBottom = document.createElement("div");
    navBottom.className = "control-panel-nav-bottom";
    navBottom.append(
      createNavButton("设置", activeSection === "settings", () => {
        activeSection = "settings";
        render();
      }),
    );

    sidebar.append(navTop, navBottom);

    const content = document.createElement("section");
    content.className = "control-panel-content";

    if (activeSection === "personal") {
      renderPersonalSection(content);
    } else if (activeSection === "pet") {
      renderPetSection(content);
    } else {
      void renderSettingsSection(content);
    }

    layout.append(sidebar, content);
    root.append(dragBar, closeButton, layout);
  };

  render();
}
