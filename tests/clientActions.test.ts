import { describe, expect, it } from "vitest";
import {
  DESKTOP_TOOL_CAPABILITIES,
  createDesktopCapabilitiesPayload,
  createDesktopClientContext,
} from "../src/clientActions";

describe("desktop tool capabilities", () => {
  it("builds an agent payload with valid capability fields", () => {
    const payload = createDesktopCapabilitiesPayload();

    expect(payload.capabilities.length).toBeGreaterThan(0);
    for (const capability of payload.capabilities) {
      expect(capability.name).toMatch(/^[a-z0-9_.-]+$/);
      expect(capability.description.length).toBeGreaterThan(0);
      expect(capability.input_schema).toMatchObject({ type: "object" });
      expect(["low", "medium", "high"]).toContain(capability.risk_level);
      expect(typeof capability.requires_confirmation).toBe("boolean");
    }
  });

  it("keeps capability names unique", () => {
    const names = DESKTOP_TOOL_CAPABILITIES.map((capability) => capability.name);

    expect(new Set(names).size).toBe(names.length);
  });

  it("advertises a strict allowlist for app opening", () => {
    const capability = DESKTOP_TOOL_CAPABILITIES.find(
      (item) => item.name === "windows.open_app",
    );

    expect(capability?.input_schema).toMatchObject({
      type: "object",
      properties: {
        app_id: {
          type: "string",
          enum: ["calculator", "notepad", "explorer", "paint", "snipping_tool", "settings"],
        },
      },
      required: ["app_id"],
      additionalProperties: false,
    });
  });

  it("keeps frontend labels separate from agent payloads", () => {
    const capability = DESKTOP_TOOL_CAPABILITIES.find(
      (item) => item.name === "windows.calendar.open_ics",
    );
    const payload = createDesktopCapabilitiesPayload();
    const agentCapability = payload.capabilities.find(
      (item) => item.name === "windows.calendar.open_ics",
    ) as Record<string, unknown> | undefined;

    expect(capability).toMatchObject({
      label_name: "新建日历事件",
      label_description: "生成 .ics 文件并用默认日历应用打开。",
    });
    expect(agentCapability).toBeDefined();
    expect(agentCapability && "label_name" in agentCapability).toBe(false);
    expect(agentCapability && "label_description" in agentCapability).toBe(false);
  });

  it("wraps capabilities in a client context for agent requests", () => {
    const context = createDesktopClientContext();
    const payload = createDesktopCapabilitiesPayload();

    expect(context.platform).toBe("windows");
    expect(context.capabilities).toEqual(payload.capabilities);
  });

  it("advertises the calendar event capability", () => {
    const capability = DESKTOP_TOOL_CAPABILITIES.find(
      (item) => item.name === "windows.calendar.open_ics",
    );

    expect(capability).toMatchObject({
      name: "windows.calendar.open_ics",
      risk_level: "medium",
      requires_confirmation: true,
    });
    expect(capability?.input_schema).toMatchObject({
      type: "object",
      properties: {
        title: { type: "string" },
        start: { type: "string" },
        end: { type: "string" },
        timezone: { type: "string" },
        location: { type: "string" },
        notes: { type: "string" },
      },
      required: ["title", "start", "end", "timezone"],
      additionalProperties: false,
    });
  });
});
