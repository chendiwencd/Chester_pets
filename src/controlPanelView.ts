import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { authStore } from "./authStore";

type SectionKey = "personal" | "pet" | "settings" | "shortcuts";
type AuthMode = "login" | "register";
type ShortcutAction = "storage" | "screenshot";

interface ShortcutSettings {
  storage: string;
  screenshot: string;
}

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

function createWorkspaceRow(
  initial: string,
  onSave: (directory: string) => Promise<string>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "control-panel-workspace-row";

  const copy = document.createElement("div");
  copy.className = "control-panel-setting-copy";

  const heading = document.createElement("div");
  heading.className = "control-panel-setting-title";
  heading.textContent = "工作目录";

  const desc = document.createElement("div");
  desc.className = "control-panel-setting-desc";
  desc.textContent = "放入的文件和图片附件会复制到这个目录。";
  copy.append(heading, desc);

  const controls = document.createElement("div");
  controls.className = "control-panel-workspace-controls";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "control-panel-workspace-input";
  input.value = initial;
  input.setAttribute("aria-label", "工作目录");

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "control-panel-secondary-button";
  saveButton.textContent = "保存";

  const status = document.createElement("span");
  status.className = "control-panel-workspace-status";
  status.setAttribute("role", "status");

  let current = initial;
  const sync = () => {
    saveButton.disabled = input.value.trim().length === 0 || input.value.trim() === current;
  };
  sync();

  input.addEventListener("input", () => {
    status.textContent = "";
    sync();
  });

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    input.disabled = true;
    try {
      current = await onSave(input.value);
      input.value = current;
      status.textContent = "已保存";
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
    } finally {
      input.disabled = false;
      sync();
    }
  });

  controls.append(input, saveButton, status);
  row.append(copy, controls);
  return row;
}

function formatShortcut(value: string): string {
  const labels: Record<string, string> = {
    control: "Ctrl",
    ctrl: "Ctrl",
    cmdorctrl: "Ctrl",
    super: "Win",
    command: "Cmd",
    cmd: "Cmd",
    shift: "Shift",
    alt: "Alt",
    option: "Alt",
    space: "Space",
    escape: "Esc",
    enter: "Enter",
    backspace: "Backspace",
    delete: "Delete",
    arrowup: "Up",
    arrowdown: "Down",
    arrowleft: "Left",
    arrowright: "Right",
  };
  return value
    .split("+")
    .map((part) => {
      const trimmed = part.trim();
      const lower = trimmed.toLowerCase();
      if (labels[lower]) return labels[lower];
      if (/^key[a-z]$/i.test(trimmed)) return trimmed.slice(3).toUpperCase();
      if (/^digit\d$/i.test(trimmed)) return trimmed.slice(5);
      if (/^f\d{1,2}$/i.test(trimmed)) return trimmed.toUpperCase();
      return trimmed;
    })
    .join(" + ");
}

function shortcutFromKeyboardEvent(event: KeyboardEvent): string | null {
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) {
    return null;
  }
  if (!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) {
    return null;
  }

  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("CmdOrCtrl");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.altKey) modifiers.push("Alt");

  const key = event.code || event.key;
  if (!key || ["Unidentified", "ControlLeft", "ControlRight", "ShiftLeft", "ShiftRight", "AltLeft", "AltRight", "MetaLeft", "MetaRight"].includes(key)) {
    return null;
  }
  return [...modifiers, key].join("+");
}

function createShortcutRow(
  action: ShortcutAction,
  title: string,
  description: string,
  initial: string,
  onSave: (shortcut: string) => Promise<ShortcutSettings>,
): HTMLElement {
  const row = document.createElement("div");
  row.className = "control-panel-shortcut-row";

  const copy = document.createElement("div");
  copy.className = "control-panel-setting-copy";
  const heading = document.createElement("div");
  heading.className = "control-panel-setting-title";
  heading.textContent = title;
  const desc = document.createElement("div");
  desc.className = "control-panel-setting-desc";
  desc.textContent = description;
  copy.append(heading, desc);

  const controls = document.createElement("div");
  controls.className = "control-panel-shortcut-controls";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "control-panel-shortcut-input";
  input.readOnly = true;
  input.value = formatShortcut(initial);
  input.setAttribute("aria-label", `${title}快捷键`);

  const saveButton = document.createElement("button");
  saveButton.type = "button";
  saveButton.className = "control-panel-secondary-button";
  saveButton.textContent = "保存";
  saveButton.disabled = true;

  const resetButton = document.createElement("button");
  resetButton.type = "button";
  resetButton.className = "control-panel-link-button control-panel-shortcut-reset";
  resetButton.textContent = "恢复默认";

  const status = document.createElement("span");
  status.className = "control-panel-shortcut-status";
  status.setAttribute("role", "status");

  let current = initial;
  let pending = initial;
  const sync = () => {
    input.value = formatShortcut(pending);
    saveButton.disabled = pending === current;
  };

  input.addEventListener("keydown", (event) => {
    const next = shortcutFromKeyboardEvent(event);
    if (!next) {
      event.preventDefault();
      status.textContent = "请按下包含 Ctrl、Alt 或 Shift 的组合键";
      return;
    }
    event.preventDefault();
    pending = next;
    status.textContent = "";
    sync();
  });
  input.addEventListener("focus", () => {
    status.textContent = "请直接按下新的组合键";
  });

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    resetButton.disabled = true;
    status.textContent = "保存中...";
    try {
      const updated = await onSave(pending);
      current = updated[action];
      pending = current;
      status.textContent = "已生效";
      sync();
    } catch (err) {
      status.textContent = err instanceof Error ? err.message : String(err);
      sync();
    } finally {
      resetButton.disabled = false;
    }
  });

  resetButton.addEventListener("click", async () => {
    const defaultShortcut = action === "storage" ? "CmdOrCtrl+Shift+V" : "Alt+D";
    pending = defaultShortcut;
    sync();
    if (pending !== current) {
      saveButton.click();
    }
  });

  controls.append(input, saveButton, resetButton, status);
  row.append(copy, controls);
  return row;
}

function renderPersonalSection(content: HTMLElement): void {
  content.innerHTML = "";

  const title = document.createElement("h1");
  title.className = "control-panel-title";
  title.textContent = "个人";

  const grid = document.createElement("div");
  grid.className = "control-panel-card-grid";

  const authState = authStore.getState();

  // 认证卡片
  const authCard = document.createElement("section");
  authCard.className = "control-panel-card";

  if (!authState.onlineMode) {
    authCard.innerHTML = `
      <h2 class="control-panel-card-title">离线模式</h2>
      <p class="control-panel-muted">当前为离线模式，请在设置中启用在线模式后登录。</p>
    `;
  } else if (authState.isLoggedIn && authState.user) {
    // 已登录状态
    const cardTitle = document.createElement("h2");
    cardTitle.className = "control-panel-card-title";
    cardTitle.textContent = "账号管理";

    const logoutButton = document.createElement("button");
    logoutButton.type = "button";
    logoutButton.className = "control-panel-primary-button";
    logoutButton.textContent = "退出登录";
    logoutButton.addEventListener("click", async () => {
      logoutButton.disabled = true;
      logoutButton.textContent = "退出中...";
      try {
        await authStore.logout();
        renderPersonalSection(content);
      } catch (err) {
        console.error("[controlPanelView] logout failed", err);
        alert(`退出失败: ${err instanceof Error ? err.message : String(err)}`);
        logoutButton.disabled = false;
        logoutButton.textContent = "退出登录";
      }
    });

    authCard.append(cardTitle, logoutButton);
  } else {
    // 未登录状态：显示登录/注册表单
    let mode: AuthMode = "login";

    const renderAuthForm = () => {
      authCard.innerHTML = "";

      const cardTitle = document.createElement("h2");
      cardTitle.className = "control-panel-card-title";
      cardTitle.textContent = mode === "login" ? "登录" : "注册";

      const form = document.createElement("div");
      form.className = "control-panel-form";

      if (mode === "register") {
        const emailField = document.createElement("label");
        emailField.className = "control-panel-field";
        emailField.innerHTML = `
          <span>邮箱</span>
          <input type="email" id="auth-email" placeholder="your@email.com" required />
        `;

        const usernameField = document.createElement("label");
        usernameField.className = "control-panel-field";
        usernameField.innerHTML = `
          <span>用户名</span>
          <input type="text" id="auth-username" placeholder="用户名（3-50字符）" required />
        `;

        const passwordField = document.createElement("label");
        passwordField.className = "control-panel-field";
        passwordField.innerHTML = `
          <span>密码</span>
          <input type="password" id="auth-password" placeholder="密码（至少8位）" required />
        `;

        form.append(emailField, usernameField, passwordField);
      } else {
        const identifierField = document.createElement("label");
        identifierField.className = "control-panel-field";
        identifierField.innerHTML = `
          <span>账号</span>
          <input type="text" id="auth-identifier" placeholder="用户名或邮箱" required />
        `;

        const passwordField = document.createElement("label");
        passwordField.className = "control-panel-field";
        passwordField.innerHTML = `
          <span>密码</span>
          <input type="password" id="auth-password" placeholder="密码" required />
        `;

        form.append(identifierField, passwordField);
      }

      const submitButton = document.createElement("button");
      submitButton.type = "button";
      submitButton.className = "control-panel-primary-button";
      submitButton.textContent = mode === "login" ? "登录" : "注册";

      submitButton.addEventListener("click", async () => {
        submitButton.disabled = true;
        const originalText = submitButton.textContent;
        submitButton.textContent = mode === "login" ? "登录中..." : "注册中...";

        try {
          if (mode === "register") {
            const email = (document.getElementById("auth-email") as HTMLInputElement).value;
            const username = (document.getElementById("auth-username") as HTMLInputElement).value;
            const password = (document.getElementById("auth-password") as HTMLInputElement).value;

            if (!email || !username || !password) {
              throw new Error("请填写完整信息");
            }

            await authStore.accountRegister(email, username, password);
          } else {
            const identifier = (document.getElementById("auth-identifier") as HTMLInputElement).value;
            const password = (document.getElementById("auth-password") as HTMLInputElement).value;

            if (!identifier || !password) {
              throw new Error("请填写账号和密码");
            }

            await authStore.accountLogin(identifier, password);
          }

          renderPersonalSection(content);
        } catch (err) {
          console.error(`[controlPanelView] ${mode} failed`, err);
          alert(`${mode === "login" ? "登录" : "注册"}失败: ${err instanceof Error ? err.message : String(err)}`);
          submitButton.disabled = false;
          submitButton.textContent = originalText;
        }
      });

      const switchButton = document.createElement("button");
      switchButton.type = "button";
      switchButton.className = "control-panel-link-button";
      switchButton.textContent = mode === "login" ? "没有账号？前往注册" : "已有账号？返回登录";
      switchButton.addEventListener("click", () => {
        mode = mode === "login" ? "register" : "login";
        renderAuthForm();
      });

      form.append(submitButton, switchButton);
      authCard.append(cardTitle, form);
    };

    renderAuthForm();
  }

  // 个人信息卡片
  const profileCard = document.createElement("section");
  profileCard.className = "control-panel-card";

  const profileTitle = document.createElement("h2");
  profileTitle.className = "control-panel-card-title";
  profileTitle.textContent = "个人信息";

  const profileContent = document.createElement("div");
  profileContent.className = "control-panel-profile";

  if (authState.isLoggedIn && authState.user) {
    const avatarInitial = authState.user.username.charAt(0).toUpperCase();
    const avatar = document.createElement("div");
    avatar.className = "control-panel-avatar";
    avatar.textContent = avatarInitial;

    const profileList = document.createElement("div");
    profileList.className = "control-panel-profile-list";

    const usernameRow = document.createElement("div");
    usernameRow.innerHTML = `<span>昵称</span><strong>${authState.user.username}</strong>`;

    const emailRow = document.createElement("div");
    emailRow.innerHTML = `<span>邮箱</span><strong>${authState.user.email || "未设置"}</strong>`;

    const phoneRow = document.createElement("div");
    phoneRow.innerHTML = `<span>手机</span><strong>${authState.user.phone || "未绑定"}</strong>`;

    const statusRow = document.createElement("div");
    const statusBadge = authState.user.is_vip
      ? '<span class="control-panel-vip-badge">VIP</span>'
      : '<strong>已登录</strong>';
    statusRow.innerHTML = `<span>状态</span>${statusBadge}`;

    profileList.append(usernameRow, emailRow, phoneRow, statusRow);
    profileContent.append(avatar, profileList);
  } else {
    const avatar = document.createElement("div");
    avatar.className = "control-panel-avatar";
    avatar.textContent = "?";

    const profileList = document.createElement("div");
    profileList.className = "control-panel-profile-list";
    profileList.innerHTML = `
      <div><span>昵称</span><strong>未登录</strong></div>
      <div><span>邮箱</span><strong>--</strong></div>
      <div><span>状态</span><strong>离线</strong></div>
    `;

    profileContent.append(avatar, profileList);
  }

  profileCard.append(profileTitle, profileContent);
  grid.append(authCard, profileCard);
  content.append(title, grid);
}

function renderPetSection(content: HTMLElement): void {
  content.innerHTML = "";

  const title = document.createElement("h1");
  title.className = "control-panel-title";
  title.textContent = "宠物日记";

  const card = document.createElement("section");
  card.className = "control-panel-card";
  card.innerHTML = `
    <h2 class="control-panel-card-title">宠物状态</h2>
    <p class="control-panel-muted">
      TODO
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

  // 在线模式开关
  const authState = authStore.getState();
  card.append(
    createToggleRow(
      "在线模式",
      "启用后可登录账号，使用云端功能；关闭则为离线模式。",
      authState.onlineMode,
      async (next) => {
        authStore.setOnlineMode(next);
        return next;
      },
    ),
  );

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

  let closeOnBlur = true;
  try {
    closeOnBlur = await invoke<boolean>("get_close_on_blur");
  } catch (err) {
    console.error("[controlPanelView] get_close_on_blur failed", err);
  }
  card.append(
    createToggleRow(
      "失焦关闭窗口",
      "当应用失去焦点时，自动隐藏窗口。",
      closeOnBlur,
      (next) => invoke<boolean>("set_close_on_blur", { enabled: next }),
    ),
  );

  let workspaceDirectory = "";
  try {
    workspaceDirectory = await invoke<string>("get_workspace_directory");
  } catch (err) {
    console.error("[controlPanelView] get_workspace_directory failed", err);
  }
  card.append(
    createWorkspaceRow(workspaceDirectory, (directory) =>
      invoke<string>("set_workspace_directory", { directory }),
    ),
  );

  card.append(
    createPlaceholderRow("清空记忆", "同时清空本地与云端形成的记忆。"),
    createPlaceholderRow("记忆导出", "导出生成的记忆内容。"),
    createPlaceholderRow("形成记忆", "整理与生成结构化记忆。"),
    createPlaceholderRow("导入记忆", "用于导入外部记忆数据。"),
  );

  content.append(title, card);
}

async function renderShortcutsSection(content: HTMLElement): Promise<void> {
  content.innerHTML = "";

  const title = document.createElement("h1");
  title.className = "control-panel-title";
  title.textContent = "快捷键";

  const card = document.createElement("section");
  card.className = "control-panel-card control-panel-settings-card";

  const cardTitle = document.createElement("h2");
  cardTitle.className = "control-panel-card-title";
  cardTitle.textContent = "热键设置";
  card.append(cardTitle);

  let settings: ShortcutSettings;
  try {
    settings = await invoke<ShortcutSettings>("get_shortcut_settings");
  } catch (err) {
    const error = document.createElement("p");
    error.className = "control-panel-muted";
    error.textContent = `读取快捷键失败：${err instanceof Error ? err.message : String(err)}`;
    card.append(error);
    content.append(title, card);
    return;
  }

  const save = (action: ShortcutAction) => (shortcut: string) =>
    invoke<ShortcutSettings>("set_shortcut", { action, shortcut }).then((updated) => {
      settings = updated;
      return updated;
    });

  card.append(
    createShortcutRow(
      "storage",
      "打开存储区",
      "使用全局快捷键打开剪贴板存储区。",
      settings.storage,
      save("storage"),
    ),
    createShortcutRow(
      "screenshot",
      "截图选择器",
      "使用全局快捷键打开截图区域选择器。",
      settings.screenshot,
      save("screenshot"),
    ),
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
      createNavButton("宠物日记", activeSection === "pet", () => {
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
      createNavButton("快捷键", activeSection === "shortcuts", () => {
        activeSection = "shortcuts";
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
    } else if (activeSection === "settings") {
      void renderSettingsSection(content);
    } else {
      void renderShortcutsSection(content);
    }

    layout.append(sidebar, content);
    root.append(dragBar, closeButton, layout);
  };

  render();
}
