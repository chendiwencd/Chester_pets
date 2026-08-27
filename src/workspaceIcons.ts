export type WorkspaceIconName =
  | "file-text"
  | "folder-open"
  | "history"
  | "image"
  | "arrow-left"
  | "command"
  | "list-todo"
  | "message-circle"
  | "notebook-text"
  | "paperclip"
  | "pin"
  | "plug-zap"
  | "plus"
  | "search"
  | "send-horizontal"
  | "settings-2"
  | "sparkles"
  | "trash-2"
  | "x"
  | "pencil"
  | "check";

const ICON_PATHS: Record<WorkspaceIconName, string> = {
  "arrow-left": '<path d="m15 18-6-6 6-6"></path><path d="M9 12h12"></path>',
  command: '<path d="M18 3a3 3 0 1 0 0 6h-1v6h1a3 3 0 1 0 0-6h-1"></path><path d="M6 3a3 3 0 1 1 0 6h1v6H6a3 3 0 1 1 0-6h1"></path><path d="M9 9h6v6H9z"></path>',
  search: '<circle cx="11" cy="11" r="8"></circle><path d="m21 21-4.3-4.3"></path>',
  x: '<path d="M18 6 6 18"></path><path d="m6 6 12 12"></path>',
  "folder-open":
    '<path d="m6 14 1.5-1.5a2 2 0 0 1 3 0L12 14l1.5-1.5a2 2 0 0 1 3 0L18 14"></path><path d="M3 7v10a2 2 0 0 0 2 2h14"></path><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v5"></path>',
  "notebook-text":
    '<path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z"></path><path d="M13 2v7h7"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path>',
  "message-circle":
    '<path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"></path><path d="M8 12h.01"></path><path d="M12 12h.01"></path><path d="M16 12h.01"></path>',
  "settings-2":
    '<path d="M20 7h-9"></path><path d="M14 17H5"></path><circle cx="17" cy="17" r="3"></circle><circle cx="7" cy="7" r="3"></circle>',
  image:
    '<rect width="18" height="18" x="3" y="3" rx="2" ry="2"></rect><circle cx="9" cy="9" r="2"></circle><path d="m21 15-3.086-3.086a2 2 0 0 0-2.828 0L6 21"></path>',
  "file-text":
    '<path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z"></path><path d="M14 2v6h6"></path><path d="M16 13H8"></path><path d="M16 17H8"></path><path d="M10 9H8"></path>',
  plus: '<path d="M5 12h14"></path><path d="M12 5v14"></path>',
  "trash-2":
    '<path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"></path><path d="M3 6h18"></path><path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>',
  pin: '<path d="M12 17v5"></path><path d="M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1v3.76Z"></path>',
  paperclip:
    '<path d="m21.44 11.05-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"></path>',
  sparkles:
    '<path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275Z"></path><path d="M5 3v4"></path><path d="M19 17v4"></path><path d="M3 5h4"></path><path d="M17 19h4"></path>',
  "plug-zap":
    '<path d="M12 22v-5"></path><path d="M9 8V2"></path><path d="M15 8V2"></path><path d="M18 8v4a6 6 0 0 1-12 0V8Z"></path><path d="m19 2-3 4h4l-3 4"></path>',
  history:
    '<path d="M3 12a9 9 0 1 0 3-6.7"></path><path d="M3 4v5h5"></path><path d="M12 7v5l3 2"></path>',
  "list-todo":
    '<rect width="6" height="6" x="3" y="3" rx="1"></rect><path d="m3 17 2 2 4-4"></path><path d="M13 6h8"></path><path d="M13 12h8"></path><path d="M13 18h8"></path>',
  "send-horizontal": '<path d="m3 3 3 9-3 9 19-9Z"></path><path d="M6 12h16"></path>',
  pencil:
    '<path d="M17 3a2.85 2.83 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5Z"></path><path d="m15 5 4 4"></path>',
  check: '<path d="M20 6 9 17l-5-5"></path>',
};

export function createWorkspaceIcon(
  name: WorkspaceIconName,
  className = "workspace-inline-icon",
): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("fill", "none");
  svg.setAttribute("stroke", "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  svg.setAttribute("class", className);
  svg.innerHTML = ICON_PATHS[name];
  return svg;
}
