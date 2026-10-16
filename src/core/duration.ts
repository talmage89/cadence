const unitMilliseconds: Record<string, number> = {
  s: 1_000,
  m: 60_000,
  h: 3_600_000,
  d: 86_400_000,
};

export function parseDuration(text: string): number {
  const match = text.trim().match(/^(\d+)([smhd])$/);
  if (!match) throw new Error(`invalid duration "${text}": use a whole number with s, m, h, or d, like 45m`);

  const [, amount = "", unit = ""] = match;
  const milliseconds = Number(amount) * (unitMilliseconds[unit] ?? Number.NaN);
  if (!(milliseconds > 0)) throw new Error(`invalid duration "${text}": must be longer than zero`);
  return milliseconds;
}
