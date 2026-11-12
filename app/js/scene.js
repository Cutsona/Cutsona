// Spatial correlation detects cuts even when both shots are dark.
export function frameChange(before, after, width, height) {
  if (!before) return { cut: false, amount: 0 };
  const n = width * height;
  let difference = 0, a = 0, b = 0, aa = 0, bb = 0, ab = 0;
  for (let k = 0; k < after.length; k += 4) {
    difference += Math.abs(after[k] - before[k]) + Math.abs(after[k + 1] - before[k + 1]) + Math.abs(after[k + 2] - before[k + 2]);
    const x = (before[k] + before[k + 1] + before[k + 2]) / 3;
    const y = (after[k] + after[k + 1] + after[k + 2]) / 3;
    a += x; b += y; aa += x * x; bb += y * y; ab += x * y;
  }
  const amount = difference / (n * 765);
  const denominator = Math.sqrt(Math.max(0, aa - a * a / n) * Math.max(0, bb - b * b / n));
  const correlation = denominator > 1 ? (ab - a * b / n) / denominator : 1;
  const relative = amount / Math.max(0.04, (a + b) / (n * 510));
  return { amount, correlation, cut: amount > 0.2 || (amount > 0.018 && relative > 0.35 && correlation < 0.25) || (amount > 0.06 && correlation < 0.6) };
}
