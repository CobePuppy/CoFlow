export function githubConfiguration(env: NodeJS.ProcessEnv) {
  return {
    clientId: !!env.GITHUB_APP_CLIENT_ID?.trim(),
    encryption: /^[a-f0-9]{64}$/i.test(env.SETTINGS_ENCRYPTION_KEY || ''),
    installationLink: /^[a-z0-9-]+$/.test(env.GITHUB_APP_SLUG || ''),
  };
}
