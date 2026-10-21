import { edition } from '../../app/edition.js';
export function BrandMark({
  projectSpace = false,
}: {
  projectSpace?: boolean;
}) {
  return (
    <strong className="brand-wordmark brand-image">
      <img
        src={`/brand/coflow-${edition.id}${projectSpace && edition.id === 'student' ? '-transparent' : ''}.png`}
        alt={`汇流 CoFlow ${edition.label}`}
        width="240"
        height="60"
      />
      <span className="sr-only">汇流 CoFlow {edition.label}</span>
    </strong>
  );
}
