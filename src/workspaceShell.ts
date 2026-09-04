import { createWorkspaceIcon } from "./workspaceIcons";

function element<K extends keyof HTMLElementTagNameMap>(
  tagName: K,
  className?: string,
  textContent?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tagName);
  if (className) node.className = className;
  if (textContent !== undefined) node.textContent = textContent;
  return node;
}

function icon(name: Parameters<typeof createWorkspaceIcon>[0], className: string): SVGSVGElement {
  return createWorkspaceIcon(name, `workspace-inline-icon ${className}`);
}

function button(
  id: string,
  className: string,
  label: string,
  iconName?: Parameters<typeof createWorkspaceIcon>[0],
): HTMLButtonElement {
  const node = element("button", className);
  node.id = id;
  node.type = "button";
  node.setAttribute("aria-label", label);
  if (iconName) node.appendChild(icon(iconName, "workspace-icon-button-glyph"));
  return node;
}

function buildHeader(): HTMLElement {
  const header = element("header", "workspace-header");
  const lights = element("div", "workspace-header-lights");
  lights.setAttribute("aria-hidden", "true");

  const search = element("label", "workspace-search");
  search.htmlFor = "workspace-search-input";
  search.appendChild(icon("search", "workspace-icon-search"));
  const searchInput = element("input", "workspace-search-input");
  searchInput.id = "workspace-search-input";
  searchInput.type = "text";
  searchInput.placeholder = "搜索消息、文件或任务";
  searchInput.autocomplete = "off";
  search.appendChild(searchInput);

  const actions = element("div", "workspace-header-actions");
  actions.appendChild(button("workspace-close", "workspace-close", "关闭工作区", "x"));
  header.append(lights, search, actions);
  return header;
}

function buildNavigation(): HTMLElement {
  const nav = element("aside", "workspace-nav");
  const group = element("div", "workspace-nav-group");
  const items: Array<{
    id: string;
    label: string;
    iconName: Parameters<typeof createWorkspaceIcon>[0];
  }> = [
    { id: "workspace-nav-assets", label: "素材区", iconName: "folder-open" },
    { id: "workspace-nav-notebook", label: "记事本", iconName: "notebook-text" },
    { id: "workspace-nav-chat", label: "Chat", iconName: "message-circle" },
  ];

  for (const item of items) {
    const navButton = button(item.id, "workspace-nav-button", item.label);
    navButton.append(
      icon(item.iconName, "workspace-icon-nav"),
      element("span", "workspace-nav-label", item.label),
    );
    group.appendChild(navButton);
  }

  const footer = element("div", "workspace-nav-footer");
  const settings = button("workspace-nav-settings", "workspace-nav-settings", "打开设置", "settings-2");
  settings.setAttribute("aria-label", "设置");
  footer.appendChild(settings);
  nav.append(group, footer);
  return nav;
}

function buildAssetsPage(): HTMLElement {
  const page = element("section", "workspace-page");
  page.id = "workspace-page-assets";

  const grid = element("div", "workspace-page-grid is-assets");
  const card = element("section", "workspace-card workspace-assets-card");
  const header = element("div", "workspace-card-header");
  const filters = element("div", "workspace-filter-row");
  filters.id = "workspace-assets-filters";
  header.appendChild(filters);

  const count = element("div", "workspace-page-count", "0 个素材");
  count.id = "workspace-assets-count";
  const assets = element("div", "workspace-assets-grid");
  assets.id = "workspace-assets-grid";
  card.append(header, count, assets);

  const side = element("aside", "workspace-side-column");
  const detail = element("div", "workspace-side-detail");
  detail.id = "workspace-assets-detail";
  side.appendChild(detail);
  grid.append(card, side);
  page.appendChild(grid);
  return page;
}

function buildNotebookPage(): HTMLElement {
  const page = element("section", "workspace-page");
  page.id = "workspace-page-notebook";
  page.hidden = true;

  const grid = element("div", "workspace-page-grid is-notebook");
  const listCard = element("section", "workspace-card workspace-notebook-list-card");
  const header = element("div", "workspace-card-header");
  const copy = element("div");
  const kicker = element("div", "workspace-kicker", "便签列表");
  const count = element("div", "workspace-page-count", "0 条便签");
  count.id = "workspace-notebook-count";
  copy.append(kicker, count);
  const actions = element("div", "workspace-inline-actions");
  actions.appendChild(button("workspace-notebook-new", "workspace-icon-button", "新建便签", "plus"));
  actions.appendChild(button("workspace-notebook-manage", "workspace-icon-button", "管理便签", "list-todo"));
  header.append(copy, actions);

  const list = element("div", "workspace-note-list");
  list.id = "workspace-notebook-list";
  listCard.append(header, list);

  const detail = element("section", "workspace-card workspace-note-detail-card");
  detail.id = "workspace-notebook-detail";
  grid.append(listCard, detail);
  page.appendChild(grid);
  return page;
}

function buildChatPage(): HTMLElement {
  const page = element("section", "workspace-page");
  page.id = "workspace-page-chat";
  page.hidden = true;

  const layout = element("div", "workspace-chat-layout");
  const thread = element("section", "workspace-card workspace-chat-thread-card");
  const header = element("div", "workspace-card-header");
  header.append(element("span", "workspace-kicker", "当前对话"), status);
  const feed = element("div", "workspace-chat-feed");
  feed.id = "workspace-chat-feed";
  thread.append(header, feed);

  const toolbar = element("div", "workspace-chat-toolbar");
  toolbar.id = "workspace-chat-toolbar";

  const composerCard = element("section", "workspace-card workspace-chat-composer-card");
  const resources = element("div", "workspace-chat-resources");
  resources.id = "workspace-chat-resources";
  const composer = element("div", "workspace-chat-composer");
  const inputShell = element("div", "workspace-chat-input-shell");
  const input = element("textarea", "workspace-chat-input");
  input.id = "workspace-chat-input";
  input.placeholder = "输入需求、追加文件，或继续指定某个模块的细化方向";

  const footer = element("div", "workspace-chat-footer");
  const hint = element("div", "workspace-chat-hint");
  hint.id = "workspace-chat-hint";
  const submit = button("workspace-chat-submit", "workspace-send-button", "发送", "send-horizontal");
  submit.querySelector("svg")?.classList.add("workspace-icon-send");
  inputShell.append(input, submit);
  footer.append(hint);
  composer.append(inputShell, footer);
  composerCard.append(composer);
  layout.append(thread, toolbar, composerCard, resources);
  page.appendChild(layout);
  return page;
}

function buildSettingsPage(): HTMLElement {
  const page = element("section", "workspace-page");
  page.id = "workspace-page-settings";
  page.hidden = true;

  const layout = element("div", "workspace-settings-layout");
  const settingsCard = element("section", "workspace-card workspace-settings-panel");
  const settingsRoot = element("div", "workspace-settings-root");
  settingsRoot.id = "workspace-settings-root";
  const settingsLayout = element("div", "workspace-settings-inner");
  const settingsNav = element("nav", "workspace-settings-section-nav");
  const settingsGeneral = button(
    "workspace-settings-general",
    "workspace-settings-section-button is-active",
    "运行设置",
  );
  settingsGeneral.textContent = "运行设置";
  const settingsAccount = button(
    "workspace-settings-account",
    "workspace-settings-section-button",
    "用户登录",
  );
  settingsAccount.textContent = "用户登录";
  const settingsShortcuts = button(
    "workspace-settings-shortcuts",
    "workspace-settings-section-button",
    "快捷键设置",
  );
  settingsShortcuts.textContent = "快捷键设置";
  settingsNav.append(settingsGeneral, settingsAccount, settingsShortcuts);

  const settingsContent = element("div", "workspace-settings-content");
  settingsContent.id = "workspace-settings-content";
  settingsLayout.append(settingsNav, settingsContent);
  settingsRoot.appendChild(settingsLayout);
  settingsCard.appendChild(settingsRoot);

  layout.append(settingsCard);
  page.append(layout);
  return page;
}

export function buildWorkspaceShell(root: HTMLElement): void {
  root.replaceChildren();
  const shell = element("div", "workspace-shell");
  const body = element("div", "workspace-body");
  const main = element("section", "workspace-main");
  main.append(buildAssetsPage(), buildNotebookPage(), buildChatPage(), buildSettingsPage());
  body.append(buildNavigation(), main);
  shell.append(buildHeader(), body);
  root.appendChild(shell);
}
