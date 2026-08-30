/** 从 DataView 读取字符串（按字节，遇 \0 截断，latin1 解码）。
 * 传 len 时按定长读取；不传 len 时从 offset 读到首个 \0 为止（smd-parser 的 texlink 字符串场景）。
 * PT 二进制文件内嵌字符串的唯一解析入口。 */
export function readCString(dv: DataView, offset: number, len?: number): string {
  const bytes = new Uint8Array(dv.buffer, dv.byteOffset + offset, len ?? dv.byteLength - offset);
  let end = 0;
  while (end < bytes.length && bytes[end] !== 0) end++;
  return new TextDecoder('latin1').decode(bytes.subarray(0, end));
}
