import { invoke } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { authStore } from "./authStore";

type SectionKey = "personal" | "pet" | "settings";
type AuthMode = "login" | "register";

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

  card.append(
    createPlaceholderRow("清空记忆", "同时清空本地与云端形成的记忆。"),
    createPlaceholderRow("记忆导出", "导出生成的记忆内容。"),
    createPlaceholderRow("形成记忆", "整理与生成结构化记忆。"),
    createPlaceholderRow("导入记忆", "用于导入外部记忆数据。"),
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
