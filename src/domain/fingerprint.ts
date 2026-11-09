/**
 * 稳定序列化与 SHA-256 指纹。对应 docs/03 §7 与 docs/04 §3。
 * 对象键递归字典序排序，数组维持顺序，JSON 紧凑无额外空白，UTF-8 编码后 SHA-256。
 */

/** 递归生成规范 JSON 字符串。 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    const parts = keys.map(
      (k) => `${JSON.stringify(k)}:${canonicalJson(obj[k])}`
    );
    return `{${parts.join(",")}}`;
  }
  // string / number / boolean：JSON.stringify 本身是紧凑形式
  return JSON.stringify(value);
}

/** 计算 UTF-8 字符串的 SHA-256（hex）。依赖 WebCrypto（现代浏览器与 Node 19+ 均内置）。 */
export async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await globalThis.crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** 对任意对象计算规范指纹。 */
export async function fingerprint(value: unknown): Promise<string> {
  return sha256Hex(canonicalJson(value));
}
