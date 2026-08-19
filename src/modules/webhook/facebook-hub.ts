export type FacebookHubQuery = {
  mode?: string;
  token?: string;
  challenge?: string;
};

function asString(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value) && typeof value[0] === 'string') return value[0];
  return undefined;
}

export function parseFacebookHubQuery(query: Record<string, unknown>): FacebookHubQuery {
  const hub = query.hub;
  const nested =
    hub && typeof hub === 'object' && !Array.isArray(hub)
      ? (hub as Record<string, unknown>)
      : undefined;

  return {
    mode: asString(nested?.mode) ?? asString(query.hub_mode) ?? asString(query['hub.mode']),
    token:
      asString(nested?.verify_token) ??
      asString(query.hub_verify_token) ??
      asString(query['hub.verify_token']),
    challenge:
      asString(nested?.challenge) ?? asString(query.hub_challenge) ?? asString(query['hub.challenge']),
  };
}

export function facebookWebhookChallenge(
  query: Record<string, unknown>,
  expectedToken: string,
): string | null {
  if (!expectedToken) return null;
  const { mode, token, challenge } = parseFacebookHubQuery(query);
  if (mode === 'subscribe' && token === expectedToken && challenge) {
    return challenge;
  }
  return null;
}
