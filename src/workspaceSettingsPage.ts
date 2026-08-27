import { initWorkspaceSettings } from "./workspaceSettingsView";

export function initWorkspaceSettingsPage(root: HTMLElement): void {
  const settingsRoot = root.querySelector("#workspace-settings-root");
  if (!(settingsRoot instanceof HTMLElement)) return;
  initWorkspaceSettings(settingsRoot);
}
