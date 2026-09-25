// 8 course colour presets — used only as an 8px dot, never a border bar (DESIGN.md).
export const COURSE_COLORS = [
  "#6E8FF0", "#4C7BD9", "#5FAE8C", "#C97A4A",
  "#B25CC9", "#D65A6E", "#C9A24C", "#5C9AB0",
];

export function courseColor(idx: number): string {
  return COURSE_COLORS[idx % COURSE_COLORS.length];
}
