import { invoke } from "@tauri-apps/api/core";

// 图片历史现在以文件形式存到 app_data_dir/images/，历史里的 value 是文件路径而不是 data URL。
// 这里统一解析成可直接赋给 <img>.src 的字符串：
// - 旧数据（value 以 "data:" 开头）：直接用，向后兼容。
// - 新数据（文件路径）：走 read_image_data_url 命令按需读盘转成 data URL，只有真正要显示时才读，
//   历史 JSON 本身保持轻量。
export async function resolveImageSrc(value: string): Promise<string> {
  if (!value) return "";
  if (value.startsWith("data:")) return value;
  try {
    const dataUrl = await invoke<string | null>("read_image_data_url", { value });
    return dataUrl ?? "";
  } catch (err) {
    console.error("[media] read_image_data_url failed", err);
    return "";
  }
}
