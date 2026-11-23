export function buildPerspectiveCardPath(
  w: number,
  h: number,
  slantLeft: number,
  slantRight: number,
  radius: number,
  offsetX = 0,
  offsetY = 0
): string {
  const x0 = offsetX;
  const x1 = offsetX + w;
  const tlY = offsetY + slantLeft;
  const trY = offsetY + slantRight;
  const brY = offsetY + h - slantRight;
  const blY = offsetY + h - slantLeft;

  const dx = x1 - x0;
  const dyTop = trY - tlY;
  const lenTop = Math.hypot(dx, dyTop) || 1;
  const uxTop = dx / lenTop;
  const uyTop = dyTop / lenTop;

  const dyBot = blY - brY;
  const lenBot = Math.hypot(-dx, dyBot) || 1;
  const uxBot = -dx / lenBot;
  const uyBot = dyBot / lenBot;

  const r = Math.min(radius, w * 0.22, h * 0.22);
  const f = (n: number) => Number(n.toFixed(2));

  return [
    `M ${f(x0)} ${f(tlY + r)}`,
    `Q ${f(x0)} ${f(tlY)} ${f(x0 + r * uxTop)} ${f(tlY + r * uyTop)}`,
    `L ${f(x1 - r * uxTop)} ${f(trY - r * uyTop)}`,
    `Q ${f(x1)} ${f(trY)} ${f(x1)} ${f(trY + r)}`,
    `L ${f(x1)} ${f(brY - r)}`,
    `Q ${f(x1)} ${f(brY)} ${f(x1 + r * uxBot)} ${f(brY + r * uyBot)}`,
    `L ${f(x0 - r * uxBot)} ${f(blY - r * uyBot)}`,
    `Q ${f(x0)} ${f(blY)} ${f(x0)} ${f(blY - r)}`,
    'Z',
  ].join(' ');
}
