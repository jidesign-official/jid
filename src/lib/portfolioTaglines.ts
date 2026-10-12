import { randomInt } from "node:crypto";

export const PORTFOLIO_TAGLINES = [
  "Design that bridges imagination and intuition",
  "Between a question mark and an exclamation mark",
  "Design Beyond Form",
] as const;

/** Select during server prerendering; the exported HTML stays stable on hydration. */
export function pickPortfolioTagline(): (typeof PORTFOLIO_TAGLINES)[number] {
  return PORTFOLIO_TAGLINES[randomInt(PORTFOLIO_TAGLINES.length)];
}
