/**
 * CONTROLLER WORKFLOW DUYỆT
 * -------------------------
 * HTTP: submit, approve, reject, list pending, xem lịch sử bước duyệt.
 */
import { Request, Response } from 'express';
import { documentWorkflowService } from './document-workflow.service';
import { getDocumentAdapter } from './adapters/stock-document-adapter';
import {
  assignStepSchema,
  documentTypeSchema,
  uploadAuthorizationSchema,
  workflowActionInputSchema,
  workflowAvailableActionsQuerySchema,
  workflowListQuerySchema,
} from '../../dto/document-workflow.dto';

export class DocumentWorkflowController {
  list = async (req: Request, res: Response) => {
    const query = workflowListQuerySchema.parse(req.query);
    const data = await documentWorkflowService.listWorkflows(req.tenant!.id, query);
    res.json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const documentType = documentTypeSchema.parse(req.params.documentType as string);
    const data = await documentWorkflowService.getWorkflow(req.tenant!.id, documentType, req.params.id as string);
    res.json({ success: true, data });
  };

  actions = async (req: Request, res: Response) => {
    const documentType = documentTypeSchema.parse(req.params.documentType as string);
    const input = workflowActionInputSchema.parse(req.body);
    const adapter = getDocumentAdapter(documentType);
    const data = await documentWorkflowService.performAction(
      req.tenant!.id,
      documentType,
      req.params.id as string,
      input,
      { userId: req.user!.id, name: req.user!.name, email: req.user!.email, role: req.tenant!.role },
      adapter,
    );
    res.json({ success: true, data });
  };

  availableActions = async (req: Request, res: Response) => {
    const documentType = documentTypeSchema.parse(req.params.documentType as string);
    workflowAvailableActionsQuerySchema.parse(req.query);
    const data = await documentWorkflowService.getAvailableActions(
      req.tenant!.id,
      documentType,
      req.params.id as string,
      { userId: req.user!.id, name: req.user!.name, email: req.user!.email, role: req.tenant!.role },
    );
    res.json({ success: true, data });
  };

  assign = async (req: Request, res: Response) => {
    const documentType = documentTypeSchema.parse(req.params.documentType as string);
    const body = assignStepSchema.parse(req.body);
    const data = await documentWorkflowService.assignStep(
      req.tenant!.id,
      documentType,
      req.params.id as string,
      req.params.stepId as string,
      body.assignedApproverId,
    );
    res.json({ success: true, data });
  };

  uploadAuthorization = async (req: Request, res: Response) => {
    const documentType = documentTypeSchema.parse(req.params.documentType as string);
    const body = uploadAuthorizationSchema.parse(req.body);
    const data = await documentWorkflowService.uploadAuthorization(
      req.tenant!.id,
      documentType,
      req.params.id as string,
      req.params.stepId as string,
      {
        uploadedById: req.user!.id,
        fileUrl: body.fileUrl,
        fileName: body.fileName,
        authorizationNo: body.authorizationNo,
        issuedBy: body.issuedBy,
        issuedAt: body.issuedAt ? new Date(body.issuedAt) : undefined,
        validFrom: body.validFrom ? new Date(body.validFrom) : undefined,
        validTo: body.validTo ? new Date(body.validTo) : undefined,
        note: body.note,
      },
    );
    res.status(201).json({ success: true, data });
  };

  timeline = async (req: Request, res: Response) => {
    const documentType = documentTypeSchema.parse(req.params.documentType as string);
    const data = await documentWorkflowService.getTimeline(req.tenant!.id, documentType, req.params.id as string);
    res.json({ success: true, data });
  };
}

export const documentWorkflowController = new DocumentWorkflowController();
