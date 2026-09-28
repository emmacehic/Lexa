/**
 * The single ambient layer (§11.1): three very large blurred colour fields,
 * drifting on a 60 s loop, frozen under prefers-reduced-motion.
 */
export function Ambient() {
  return (
    <div className="ambient" aria-hidden="true">
      <span />
      <span />
      <span />
    </div>
  );
}
