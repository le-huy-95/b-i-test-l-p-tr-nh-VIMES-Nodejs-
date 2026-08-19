import { Router, Request, Response } from 'express';
import { env } from '../../config/env';
import { facebookWebhookChallenge } from './facebook-hub';

const router = Router();

router.get('/', (req: Request, res: Response) => {
  const challenge = facebookWebhookChallenge(
    req.query as Record<string, unknown>,
    env.FACEBOOK_WEBHOOK_VERIFY_TOKEN ?? '',
  );
  if (!challenge) {
    res.status(403).type('text/plain').send('Forbidden');
    return;
  }
  res.status(200).type('text/plain').send(challenge);
});

router.post('/', (req: Request, res: Response) => {
  req.log?.info({ object: req.body?.object }, 'facebook webhook event');
  res.status(200).type('text/plain').send('EVENT_RECEIVED');
});

export default router;
