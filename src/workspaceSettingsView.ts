import { invoke } from "@tauri-apps/api/core";
import { authStore } from "./authStore";

type SettingsSection = "general" | "account" | "shortcuts";
type AuthMode = "login" | "register";
type ShortcutAction = "storage" | "screenshot";

interface ShortcutSettings {
  storage: string;
  screenshot: string;
}

function createElement<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function createLoadingState(): HTMLElement {
  return createElement("div", "workspace-settings-loading", "正在读取设置…");
}

function createToggleRow(
  title: string,
  description: string,
  initial: boolean,
  onChange: (next: boolean) => Promise<boolean>,
): HTMLElement {
  const row = createElement("div", "workspace-settings-row");
  const copy = createElement("div", "workspace-settings-copy");
  copy.append(
    createElement("div", "workspace-settings-row-title", title),
    createElement("p", "workspace-settings-row-description", description),
  );

  const toggle = createElement("button", "workspace-settings-toggle");
  toggle.type = "button";
  toggle.setAttribute("role", "switch");
  let state = initial;

  const sync = () => {
    toggle.classList.toggle("is-on", state);
    toggle.setAttribute("aria-checked", String(state));
    toggle.textContent = state ? "开" : "关";
  };

  sync();
  toggle.addEventListener("click", async () => {
    toggle.disabled = true;
    try {
      state = await onChange(!state);
    } catch (error) {
      console.error("[workspaceSettingsView] toggle failed", error);
    } finally {
      sync();
      toggle.disabled = false;
    }
  });

  row.append(copy, toggle);
  return row;
}

function createPlaceholderRow(title: string, description: string): HTMLElement {
  const row = createElement("div", "workspace-settings-row");
  const copy = createElement("div", "workspace-settings-copy");
  copy.append(
    createElement("div", "workspace-settings-row-title", title),
    createElement("p", "workspace-settings-row-description", description),
  );
  row.append(copy, createElement("span", "workspace-settings-badge", "暂未开放"));
  return row;
}

function createField(
  form: HTMLElement,
  labelText: string,
  type: string,
  id: string,
): HTMLInputElement {
  const label = createElement("label", "workspace-settings-field");
  const text = createElement("span", undefined, labelText);
  const input = document.createElement("input");
  input.id = id;
  input.type = type;
  input.required = true;
  label.append(text, input);
  form.appendChild(label);
  return input;
}

function createProfileRow(label: string, value: string): HTMLElement {
  const row = createElement("div", "workspace-settings-profile-row");
  row.append(
    Object.assign(document.createElement("span"), { textContent: label }),
    Object.assign(document.createElement("strong"), { textContent: value }),
  );
  return row;
}

function createWorkspaceDirectoryRow(
  initial: string,
  onSave: (directory: string) => Promise<string>,
): HTMLElement {
  const row = createElement("div", "workspace-settings-row is-directory");
  const copy = createElement("div", "workspace-settings-copy");
  copy.append(
    createElement("div", "workspace-settings-row-title", "工作目录"),
    createElement("p", "workspace-settings-row-description", "放入的文件和图片附件会复制到这个目录。"),
  );

  const controls = createElement("div", "workspace-settings-directory-controls");
  const input = createElement("input", "workspace-settings-directory-input");
  input.type = "text";
  input.value = initial;
  input.setAttribute("aria-label", "工作目录");

  const saveButton = createElement("button", "workspace-settings-secondary-button", "保存");
  saveButton.type = "button";
  const status = createElement("span", "workspace-settings-status");
  status.setAttribute("role", "status");
  let current = initial;

  const sync = () => {
    saveButton.disabled = input.value.trim().length === 0 || input.value.trim() === current;
  };

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
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      input.disabled = false;
      sync();
    }
  });

  sync();
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
  if (["Control", "Shift", "Alt", "Meta"].includes(event.key)) return null;
  if (!(event.ctrlKey || event.metaKey || event.altKey || event.shiftKey)) return null;

  const modifiers: string[] = [];
  if (event.ctrlKey || event.metaKey) modifiers.push("CmdOrCtrl");
  if (event.shiftKey) modifiers.push("Shift");
  if (event.altKey) modifiers.push("Alt");

  const key = event.code || event.key;
  if (
    !key ||
    [
      "Unidentified",
      "ControlLeft",
      "ControlRight",
      "ShiftLeft",
      "ShiftRight",
      "AltLeft",
      "AltRight",
      "MetaLeft",
      "MetaRight",
    ].includes(key)
  ) {
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
  const row = createElement("div", "workspace-settings-row is-shortcut");
  const copy = createElement("div", "workspace-settings-copy");
  copy.append(
    createElement("div", "workspace-settings-row-title", title),
    createElement("p", "workspace-settings-row-description", description),
  );

  const controls = createElement("div", "workspace-settings-shortcut-controls");
  const input = createElement("input", "workspace-settings-shortcut-input");
  input.type = "text";
  input.readOnly = true;
  input.value = formatShortcut(initial);
  input.setAttribute("aria-label", `${title}快捷键`);

  const saveButton = createElement("button", "workspace-settings-secondary-button", "保存");
  saveButton.type = "button";
  saveButton.disabled = true;
  const resetButton = createElement("button", "workspace-settings-link-button", "恢复默认");
  resetButton.type = "button";
  const status = createElement("span", "workspace-settings-status");
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
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      resetButton.disabled = false;
      sync();
    }
  });
  resetButton.addEventListener("click", () => {
    pending = action === "storage" ? "CmdOrCtrl+Shift+V" : "Alt+D";
    sync();
    if (pending !== current) saveButton.click();
  });

  sync();
  controls.append(input, saveButton, resetButton, status);
  row.append(copy, controls);
  return row;
}

function renderAccountSection(root: HTMLElement, mode: AuthMode, setMode: (mode: AuthMode) => void): void {
  root.replaceChildren();

  const card = createElement("section", "workspace-settings-card");
  const state = authStore.getState();

  if (!state.onlineMode) {
    card.append(
      createElement(
        "p",
        "workspace-settings-muted",
        "当前为离线模式。请先在运行设置里开启在线模式，再进行登录。",
      ),
    );
    root.append(card);
    return;
  }

  if (state.isLoggedIn && state.user) {
    const profile = createElement("div", "workspace-settings-profile");
    const avatar = createElement("div", "control-panel-avatar", state.user.username.charAt(0).toUpperCase());
    const details = createElement("div", "workspace-settings-profile-details");
    details.append(
      createProfileRow("昵称", state.user.username),
      createProfileRow("邮箱", state.user.email || "未设置"),
      createProfileRow("手机", state.user.phone || "未绑定"),
      createProfileRow("状态", state.user.is_vip ? "VIP" : "已登录"),
    );

    const logout = createElement("button", "workspace-settings-primary-button", "退出登录");
    logout.type = "button";
    logout.addEventListener("click", async () => {
      logout.disabled = true;
      logout.textContent = "退出中...";
      try {
        await authStore.logout();
      } catch (error) {
        console.error("[workspaceSettingsView] logout failed", error);
      } finally {
        logout.disabled = false;
        logout.textContent = "退出登录";
      }
    });

    profile.append(avatar, details);
    card.append(profile, logout);
    root.append(card);
    return;
  }

  const form = createElement("div", "workspace-settings-form");
  const fields: HTMLInputElement[] = [];
  if (mode === "register") {
    fields.push(
      createField(form, "邮箱", "email", "workspace-auth-email"),
      createField(form, "用户名", "text", "workspace-auth-username"),
      createField(form, "密码", "password", "workspace-auth-password"),
    );
  } else {
    fields.push(
      createField(form, "账号", "text", "workspace-auth-identifier"),
      createField(form, "密码", "password", "workspace-auth-password"),
    );
  }

  const submit = createElement("button", "workspace-settings-primary-button", mode === "login" ? "登录" : "注册");
  submit.type = "button";

  const switchButton = createElement(
    "button",
    "workspace-settings-link-button",
    mode === "login" ? "没有账号？前往注册" : "已有账号？返回登录",
  );
  switchButton.type = "button";

  const message = createElement("p", "workspace-settings-error");
  message.hidden = true;

  submit.addEventListener("click", async () => {
    submit.disabled = true;
    const original = submit.textContent;
    submit.textContent = mode === "login" ? "登录中..." : "注册中...";
    message.hidden = true;
    try {
      if (mode === "register") {
        const [email, username, password] = fields.map((field) => field.value.trim());
        if (!email || !username || !password) throw new Error("请填写完整信息");
        await authStore.accountRegister(email, username, password);
      } else {
        const [identifier, password] = fields.map((field) => field.value.trim());
        if (!identifier || !password) throw new Error("请填写账号和密码");
        await authStore.accountLogin(identifier, password);
      }
    } catch (error) {
      console.error("[workspaceSettingsView] auth submit failed", error);
      message.textContent = error instanceof Error ? error.message : String(error);
      message.hidden = false;
      submit.disabled = false;
      submit.textContent = original ?? submit.textContent;
    }
  });

  switchButton.addEventListener("click", () => {
    setMode(mode === "login" ? "register" : "login");
  });

  form.append(submit, switchButton, message);
  card.append(form);
  root.append(card);
}

function createNumberRow(
  title: string,
  description: string,
  initial: number,
  onSave: (value: number) => Promise<number>,
  options: { min: number; max: number; step?: number } = { min: 1, max: 500, step: 1 },
): HTMLElement {
  const row = createElement("div", "workspace-settings-row");
  const copy = createElement("div", "workspace-settings-copy");
  copy.append(
    createElement("div", "workspace-settings-row-title", title),
    createElement("p", "workspace-settings-row-description", description),
  );

  const controls = createElement("div", "workspace-settings-directory-controls");
  const input = createElement("input", "workspace-settings-directory-input") as HTMLInputElement;
  input.type = "number";
  input.min = String(options.min);
  input.max = String(options.max);
  input.step = String(options.step ?? 1);
  input.value = String(initial);

  const saveButton = createElement("button", "workspace-settings-secondary-button", "保存");
  saveButton.type = "button";
  const status = createElement("span", "workspace-settings-directory-status");
  status.setAttribute("role", "status");

  let current = initial;
  const sync = () => {
    const next = Number(input.value);
    const valid = Number.isFinite(next) && next >= options.min && next <= options.max;
    saveButton.disabled = !valid || next === current;
  };
  sync();
  input.addEventListener("input", sync);

  saveButton.addEventListener("click", async () => {
    saveButton.disabled = true;
    status.textContent = "保存中…";
    try {
      const next = await onSave(Number(input.value));
      current = next;
      input.value = String(next);
      status.textContent = "已生效";
    } catch (error) {
      status.textContent = error instanceof Error ? error.message : String(error);
    } finally {
      sync();
    }
  });

  controls.append(input, saveButton, status);
  row.append(copy, controls);
  return row;
}

async function renderGeneralSection(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  const card = createElement("section", "workspace-settings-card");
  const authState = authStore.getState();
  card.append(
    createToggleRow(
      "在线模式",
      "启用后可登录账号并使用云端功能；关闭则为离线模式。",
      authState.onlineMode,
      async (next) => {
        authStore.setOnlineMode(next);
        return next;
      },
    ),
  );

  let autostart = false;
  try {
    autostart = await invoke<boolean>("get_autostart");
  } catch (error) {
    console.error("[workspaceSettingsView] get_autostart failed", error);
  }
  card.append(
    createToggleRow(
      "开机自启",
      "登录 Windows 后自动启动桌面宠物。",
      autostart,
      (next) => invoke<boolean>("set_autostart", { enabled: next }),
    ),
  );

  let closeOnBlur = true;
  try {
    closeOnBlur = await invoke<boolean>("get_close_on_blur");
  } catch (error) {
    console.error("[workspaceSettingsView] get_close_on_blur failed", error);
  }
  card.append(
    createToggleRow(
      "失焦关闭窗口",
      "当应用失去焦点时，自动隐藏窗口。",
      closeOnBlur,
      (next) => invoke<boolean>("set_close_on_blur", { enabled: next }),
    ),
  );

  let autoSync = false;
  try {
    autoSync = await invoke<boolean>("get_auto_sync");
  } catch (error) {
    console.error("[workspaceSettingsView] get_auto_sync failed", error);
  }
  card.append(
    createToggleRow(
      "自动同步",
      "新增素材后自动上传到云端并更新上传状态（需在线模式 + 已登录）。",
      autoSync,
      (next) => invoke<boolean>("set_auto_sync", { enabled: next }),
    ),
  );

  let textBatchSize = 50;
  try {
    textBatchSize = await invoke<number>("get_text_upload_batch_size");
  } catch (error) {
    console.error("[workspaceSettingsView] get_text_upload_batch_size failed", error);
  }
  card.append(
    createNumberRow(
      "文本同步批量阈值",
      "文本素材不会逐条上传；累计到该数量后，会合并成一个 txt 文件再上传。",
      textBatchSize,
      (next) => invoke<number>("set_text_upload_batch_size", { batchSize: next }),
      { min: 1, max: 500, step: 1 },
    ),
  );

  let workspaceDirectory = "";
  try {
    workspaceDirectory = await invoke<string>("get_workspace_directory");
  } catch (error) {
    console.error("[workspaceSettingsView] get_workspace_directory failed", error);
  }
  card.append(
    createWorkspaceDirectoryRow(workspaceDirectory, (directory) =>
      invoke<string>("set_workspace_directory", { directory }),
    ),
    createPlaceholderRow("清空记忆", "同时清空本地与云端形成的记忆。"),
    createPlaceholderRow("记忆导出", "导出生成的记忆内容。"),
    createPlaceholderRow("形成记忆", "整理与生成结构化记忆。"),
    createPlaceholderRow("导入记忆", "用于导入外部记忆数据。"),
  );

  root.append(card);
}

async function renderShortcutsSection(root: HTMLElement): Promise<void> {
  root.replaceChildren();
  const card = createElement("section", "workspace-settings-card");

  let settings: ShortcutSettings;
  try {
    settings = await invoke<ShortcutSettings>("get_shortcut_settings");
  } catch (error) {
    card.append(
      createElement(
        "p",
        "workspace-settings-error",
        `读取快捷键失败：${error instanceof Error ? error.message : String(error)}`,
      ),
    );
    root.append(card);
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
  root.append(card);
}

export function initWorkspaceSettings(root: HTMLElement): {
  setSection: (section: SettingsSection) => void;
} {
  const content = root.querySelector("#workspace-settings-content");
  const general = root.querySelector("#workspace-settings-general");
  const account = root.querySelector("#workspace-settings-account");
  const shortcuts = root.querySelector("#workspace-settings-shortcuts");
  if (!(content instanceof HTMLElement)) {
    return { setSection: () => {} };
  }

  let activeSection: SettingsSection = "general";
  let accountMode: AuthMode = "login";
  let renderVersion = 0;
  const render = async () => {
    const version = ++renderVersion;
    general?.classList.toggle("is-active", activeSection === "general");
    account?.classList.toggle("is-active", activeSection === "account");
    shortcuts?.classList.toggle("is-active", activeSection === "shortcuts");
    content.replaceChildren(createLoadingState());
    const nextContent = createElement("div");
    if (activeSection === "general") {
      await renderGeneralSection(nextContent);
    } else if (activeSection === "account") {
      renderAccountSection(nextContent, accountMode, (nextMode) => {
        accountMode = nextMode;
        void render();
      });
    } else {
      await renderShortcutsSection(nextContent);
    }
    if (version === renderVersion) {
      content.replaceChildren(...Array.from(nextContent.childNodes));
    }
  };

  general?.addEventListener("click", () => {
    activeSection = "general";
    void render();
  });
  account?.addEventListener("click", () => {
    activeSection = "account";
    void render();
  });
  shortcuts?.addEventListener("click", () => {
    activeSection = "shortcuts";
    void render();
  });
  authStore.subscribe(() => {
    if (activeSection === "account") {
      void render();
    }
  });
  void render();

  return {
    setSection: (section) => {
      activeSection = section;
      void render();
    },
  };
}
