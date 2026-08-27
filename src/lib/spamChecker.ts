/**
 * Lightweight email spam-trigger analyzer for template subject + body.
 * Heuristic only — not a guarantee against filters.
 */

export type SpamHit = {
  word: string;
  category: string;
  count: number;
  severity: "high" | "medium" | "low";
  tip: string;
};

export type SpamReport = {
  score: number;
  level: "low" | "medium" | "high" | "critical";
  hits: SpamHit[];
  tips: string[];
  summary: string;
};

type Rule = {
  pattern: RegExp;
  label: string;
  category: string;
  severity: "high" | "medium" | "low";
  weight: number;
  tip: string;
};

const RULES: Rule[] = [
  {
    pattern: /\b(free\s*money|make\s*money\s*fast|get\s*rich|guaranteed\s*income)\b/gi,
    label: "money / get rich claims",
    category: "Financial hype",
    severity: "high",
    weight: 18,
    tip: "Strong money claims trigger filters. Use neutral wording.",
  },
  {
    pattern: /\b(act\s*now|limited\s*time|urgent|urgent!!|hurry|expires?\s*today|last\s*chance)\b/gi,
    label: "urgency pressure",
    category: "Urgency",
    severity: "high",
    weight: 12,
    tip: "Reduce urgency words. Prefer calm, factual language.",
  },
  {
    pattern: /\b(winner|you\s*won|congratulations[!]{1,}|claim\s*your\s*prize|lottery)\b/gi,
    label: "prize / winner language",
    category: "Prize scam patterns",
    severity: "high",
    weight: 20,
    tip: "Avoid prize/winner language entirely for business email.",
  },
  {
    pattern: /\b(viagra|cialis|pharmacy|pills?\s*online)\b/gi,
    label: "pharma spam terms",
    category: "Restricted products",
    severity: "high",
    weight: 25,
    tip: "Remove these terms — they almost always land in spam.",
  },
  {
    pattern: /\b(click\s*here|click\s*below|click\s*now)\b/gi,
    label: "click here",
    category: "CTA phrasing",
    severity: "medium",
    weight: 8,
    tip: 'Replace "Click here" with descriptive text, e.g. "View filing details".',
  },
  {
    pattern: /\b(100%\s*free|completely\s*free|free!!!|no\s*cost)\b/gi,
    label: "free emphasis",
    category: "Free offers",
    severity: "high",
    weight: 14,
    tip: "Tone down FREE emphasis; state the offer plainly once.",
  },
  {
    pattern: /\b(buy\s*now|order\s*now|shop\s*now)\b/gi,
    label: "hard sell CTA",
    category: "Sales pressure",
    severity: "medium",
    weight: 8,
    tip: "Softer CTA works better: Review application / Confirm details.",
  },
  {
    pattern: /\b(no\s*obligation|risk\s*free|risk-free|guarantee[d]?)\b/gi,
    label: "guarantee / risk-free",
    category: "Promises",
    severity: "medium",
    weight: 10,
    tip: "Avoid absolute guarantees; use measured language.",
  },
  {
    pattern: /\b(dear\s*friend|dear\s*valued\s*customer|attention[!]?)\b/gi,
    label: "generic greeting",
    category: "Greeting",
    severity: "low",
    weight: 4,
    tip: "Use a specific name or mark name variable instead of generic greetings.",
  },
  {
    pattern: /\b(wire\s*transfer|western\s*union|bitcoin|crypto\s*payment|send\s*payment)\b/gi,
    label: "payment pressure",
    category: "Payment",
    severity: "high",
    weight: 16,
    tip: "Payment requests in cold outreach often trigger spam + distrust.",
  },
  {
    pattern: /\b(this\s*is\s*not\s*spam|not\s*a\s*scam)\b/gi,
    label: "not spam disclaimer",
    category: "Self-defense phrases",
    severity: "high",
    weight: 15,
    tip: "Never write this is not spam — filters treat it as a red flag.",
  },
  {
    pattern: /\b(weight\s*loss|lose\s*weight|miracle|secret\s*formula)\b/gi,
    label: "miracle / health hype",
    category: "Hype",
    severity: "high",
    weight: 14,
    tip: "Health/miracle claims are classic spam triggers.",
  },
  {
    pattern: /\b(cash\s*bonus|extra\s*income|work\s*from\s*home)\b/gi,
    label: "income spam phrases",
    category: "Financial hype",
    severity: "high",
    weight: 14,
    tip: "Classic spam phrases — remove for B2B / legal outreach.",
  },
  {
    pattern: /\b(!!!|\?\?\?)\b/g,
    label: "excess punctuation",
    category: "Formatting",
    severity: "medium",
    weight: 6,
    tip: "Avoid multiple !!! or ??? — looks promotional.",
  },
  {
    pattern: /\b[A-Z]{6,}\b/g,
    label: "ALL CAPS words",
    category: "Formatting",
    severity: "medium",
    weight: 5,
    tip: "Do not shout in ALL CAPS. Use normal sentence case.",
  },
  {
    pattern: /\$\s*\d+|\d+%\s*off|\d+%\s*free/gi,
    label: "price / percent off style offers",
    category: "Offers",
    severity: "medium",
    weight: 7,
    tip: "Heavy discount/price patterns; keep offers understated.",
  },
  {
    pattern: /https?:\/\/[^\s"'<>]+/gi,
    label: "links",
    category: "Links",
    severity: "low",
    weight: 2,
    tip: "Prefer 1 clear trusted link. Too many links raise risk.",
  },
];

function stripHtml(html: string): string {
  return (html || "")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

export function analyzeSpamRisk(subject: string, bodyHtml: string): SpamReport {
  const text = `${subject || ""}\n${stripHtml(bodyHtml || "")}`;
  const hits: SpamHit[] = [];
  let score = 0;

  for (const rule of RULES) {
    const matches = text.match(rule.pattern);
    if (!matches || matches.length === 0) continue;
    const unique = Array.from(new Set(matches.map((m) => m.trim()))).filter(Boolean);
    const count = matches.length;
    score += rule.weight * Math.min(count, 3);
    hits.push({
      word: unique.slice(0, 5).join(", "),
      category: rule.category,
      count,
      severity: rule.severity,
      tip: rule.tip,
    });
  }

  const subj = (subject || "").trim();
  if (subj && subj === subj.toUpperCase() && subj.length > 8) {
    score += 12;
    hits.push({
      word: subject,
      category: "Subject",
      count: 1,
      severity: "high",
      tip: "Subject line in ALL CAPS is a strong spam signal.",
    });
  }
  if ((subj.match(/!/g) || []).length >= 2) {
    score += 8;
    hits.push({
      word: "!! in subject",
      category: "Subject",
      count: 1,
      severity: "medium",
      tip: "Use at most one exclamation mark in the subject, or none.",
    });
  }

  score = Math.max(0, Math.min(100, Math.round(score)));

  let level: SpamReport["level"] = "low";
  if (score >= 70) level = "critical";
  else if (score >= 45) level = "high";
  else if (score >= 25) level = "medium";

  const tipsSet = new Set<string>();
  hits
    .sort((a, b) => {
      const order = { high: 0, medium: 1, low: 2 };
      return order[a.severity] - order[b.severity];
    })
    .forEach((h) => tipsSet.add(h.tip));

  if (score < 25) {
    tipsSet.add("Keep subject clear and specific (e.g. include mark or serial).");
    tipsSet.add("One primary CTA link is enough; avoid URL shorteners.");
  }

  const summary =
    level === "critical"
      ? "High spam risk — rewrite before sending."
      : level === "high"
        ? "Elevated risk — fix highlighted phrases."
        : level === "medium"
          ? "Some triggers found — review and soften wording."
          : "Looks relatively clean. Still test with a real inbox.";

  return {
    score,
    level,
    hits,
    tips: Array.from(tipsSet).slice(0, 8),
    summary,
  };
}