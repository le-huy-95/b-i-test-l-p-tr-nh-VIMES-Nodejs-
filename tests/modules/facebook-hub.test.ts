import { describe, expect, it } from 'vitest';
import { facebookWebhookChallenge, parseFacebookHubQuery } from '../../src/modules/webhook/facebook-hub';

describe('facebook hub verification', () => {
  it('parses nested hub query from Express qs', () => {
    expect(
      parseFacebookHubQuery({
        hub: { mode: 'subscribe', verify_token: 'secret', challenge: 'abc' },
      }),
    ).toEqual({ mode: 'subscribe', token: 'secret', challenge: 'abc' });
  });

  it('returns the challenge when mode and token match', () => {
    expect(
      facebookWebhookChallenge(
        { hub: { mode: 'subscribe', verify_token: 'secret', challenge: 'abc' } },
        'secret',
      ),
    ).toBe('abc');
  });

  it('rejects a mismatched verify token', () => {
    expect(
      facebookWebhookChallenge(
        { 'hub.mode': 'subscribe', 'hub.verify_token': 'wrong', 'hub.challenge': 'abc' },
        'secret',
      ),
    ).toBeNull();
  });
});
