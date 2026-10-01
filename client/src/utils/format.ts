/** 秒 → `mm:ss`（分钟也补零，行内一列时间左对齐时不会跳）；时长未知或非法返回 `--:--`（PRD 11.2 必测基础函数） */
export function formatTime(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return "--:--";
  const total = Math.floor(seconds);
  const minutes = Math.floor(total / 60);
  const rest = total % 60;
  return `${String(minutes).padStart(2, "0")}:${String(rest).padStart(2, "0")}`;
}

/** 字节 → 人读大小（默认 1 位小数；B 取整）；非法值返回 `—`。digits 可指定小数位（如上限提示用 0 位） */
export function formatSize(bytes: number | null | undefined, digits = 1): string {
  if (bytes == null || !Number.isFinite(bytes) || bytes < 0) return "—";
  if (bytes < 1024) return `${Math.round(bytes)} B`;

  const units = ["KB", "MB", "GB", "TB"] as const;
  let value = bytes / 1024;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value.toFixed(Math.min(3, Math.max(0, Math.trunc(digits))))} ${units[index]}`;
}

/** ISO 8601（UTC）→ 本地 `yyyy-MM-dd HH:mm`；非法值原样返回 */
export function formatDateTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  const pad = (value: number) => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  );
}
