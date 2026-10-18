import { edition } from '../edition.js';
export function EditionSwitch() {
  return (
    <nav className="edition-switch" aria-label="版本入口">
      <a
        href="/enterprise/"
        aria-current={edition.id === 'enterprise' ? 'page' : undefined}
      >
        企业版
      </a>
      <a
        href="/student/"
        aria-current={edition.id === 'student' ? 'page' : undefined}
      >
        学生版
      </a>
    </nav>
  );
}
