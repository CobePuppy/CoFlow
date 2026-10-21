// Compatibility development host. Production builds are separate applications.
if (/^\/student(?:\/|$)/.test(location.pathname))
  void import('../../student-web/src/main.js');
else void import('../../enterprise-web/src/main.js');
