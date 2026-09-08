/**
 * Thông báo trực tiếp cho sự kiện không thuộc luồng chứng từ kho.
 *
 * Hiện tại chỉ có thông báo lời mời tenant (`notifyInvitationCreated`).
 * Tách riêng khỏi stock-doc-notify để module tenant/invitation import gọn,
 * không kéo theo toàn bộ handler phiếu nhập/xuất.
 */

import { NOTIFICATION_EVENT_TYPES } from './event-types';
import { publishTenantNotification } from './publish';

/** Dữ liệu đầu vào khi tạo thông báo "được mời vào tổ chức" */
export interface InvitationCreatedInput {
  userId: string;
  invitationId: string;
  tenantId: string;
  tenantName: string;
  inviterId: string;
  inviterName: string;
}

/**
 * Gửi thông báo in-app tới người được mời khi admin tạo lời mời tenant.
 * Người nhận: explicit_users với userId của người được mời.
 */
export async function notifyInvitationCreated(input: InvitationCreatedInput): Promise<void> {
  await publishTenantNotification({
    eventType: NOTIFICATION_EVENT_TYPES.INVITATION_CREATED,
    tenantId: input.tenantId,
    actorUserId: input.inviterId,
    actorName: input.inviterName,
    source: { type: 'tenant_invitation', id: input.invitationId },
    recipientPolicy: { type: 'explicit_users', userIds: [input.userId] },
    notification: {
      title: 'Lời mời vào tổ chức',
      body: `${input.inviterName} đã mời bạn vào ${input.tenantName}`,
      targetType: 'tenant_invitation',
      targetId: input.invitationId,
      routeName: 'tenant_invitation_detail',
      routeParams: { invitationId: input.invitationId, tenantId: input.tenantId },
      deeplink: `myapp://tenant-invitations/${input.invitationId}`,
    },
  });
}
