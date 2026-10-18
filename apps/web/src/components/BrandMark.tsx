import { edition } from '../edition.js';
export function BrandMark() {
  return (
    <strong className="brand-wordmark brand-image">
      <img
        src={`/brand/coflow-${edition.id}.png`}
        alt={`汇流 CoFlow ${edition.label}`}
        width="240"
        height="60"
      />
      <span className="sr-only">汇流 CoFlow {edition.label}</span>
    </strong>
  );
}
