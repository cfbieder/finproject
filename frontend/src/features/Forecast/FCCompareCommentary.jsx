/**
 * FCCompareCommentary (CR040) — deterministic "where they differ" panel.
 *
 * Instant, rule-based commentary computed client-side from the compare
 * result (no LLM). The AI narrative panel (CR040 P3) will sit alongside.
 */
import {
  Flag,
  GitBranch,
  ArrowLeftRight,
  TrendingUp,
  Landmark,
  Layers,
  CalendarRange,
} from "lucide-react";

const KIND_ICONS = {
  headline: Flag,
  divergence: GitBranch,
  crossover: ArrowLeftRight,
  "pl-movers": TrendingUp,
  "bs-movers": Landmark,
  structural: Layers,
  range: CalendarRange,
};

export default function FCCompareCommentary({ items }) {
  if (!items || !items.length) return null;

  return (
    <div className="fc-compare-commentary">
      <h3>Where they differ</h3>
      <ul>
        {items.map((item, i) => {
          const Icon = KIND_ICONS[item.kind] || Flag;
          return (
            <li key={`${item.kind}-${i}`}>
              <span className="fc-compare-commentary__icon">
                <Icon size={15} />
              </span>
              <span>{item.text}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
