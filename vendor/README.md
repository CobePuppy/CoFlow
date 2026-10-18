# Vendored browser PDF parser

pdfjs-dist 6.4.299 is retained as its original npm tarball to make installation reproducible after repeated registry download timeouts. The downloaded tarball was SHA512-checked against the official registry integrity recorded by pnpm before it was added here. Its package license and notices are inside the tarball.

Source: https://registry.npmjs.org/pdfjs-dist/-/pdfjs-dist-6.4.299.tgz
Project: https://github.com/mozilla/pdf.js

The web app uses this as a repository-relative file dependency. Do not replace the tarball without updating the manifest and lockfile and checking PDF parsing and the locally bundled worker. Native canvas is unnecessary for browser-only text extraction and is excluded in pnpm-workspace.yaml.
