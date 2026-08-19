import { EmailService } from './EmailService.class';
import { prisma } from '../../infra/prisma';

export const emailService = new EmailService(prisma);
