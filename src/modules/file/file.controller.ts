import { Request, Response } from 'express';
import { fileService } from './file.service';
import { parseUploadMediaInput, parseUploadMediaKind } from '../../dto/upload-media.dto';

export class FileController {
  upload = async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'FILE_REQUIRED', message: 'File is required (multipart field "file")' },
      });
      return;
    }
    const { kind } = parseUploadMediaInput(req.body);
    const data = await fileService.uploadFile(req.tenant!.id, req.user!.id, req.file, kind);
    res.status(201).json({ success: true, data });
  };

  replace = async (req: Request, res: Response) => {
    if (!req.file) {
      res.status(400).json({
        success: false,
        error: { code: 'FILE_REQUIRED', message: 'File is required (multipart field "file")' },
      });
      return;
    }
    const kind = parseUploadMediaKind(req.body);
    const data = await fileService.replaceFile(req.params.id as string, req.tenant!.id, {
      userId: req.user!.id,
      role: req.tenant!.role,
    }, req.file, kind);
    res.json({ success: true, data });
  };

  getOne = async (req: Request, res: Response) => {
    const data = await fileService.getFile(req.params.id as string, req.tenant!.id);
    res.json({ success: true, data });
  };

  list = async (req: Request, res: Response) => {
    const data = await fileService.listFiles(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  remove = async (req: Request, res: Response) => {
    const data = await fileService.deleteFile(req.params.id as string, req.tenant!.id, {
      userId: req.user!.id,
      role: req.tenant!.role,
    });
    res.json({ success: true, data });
  };
}

export const fileController = new FileController();
