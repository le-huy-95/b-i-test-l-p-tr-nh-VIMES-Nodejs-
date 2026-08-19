import { Request, Response } from 'express';
import { productService } from './product.service';

export class ProductController {
  list = async (req: Request, res: Response) => {
    const data = await productService.list(req.tenant!.id, req.query);
    res.json({ success: true, data });
  };

  create = async (req: Request, res: Response) => {
    const data = await productService.create(req.tenant!.id, req.body);
    res.status(201).json({ success: true, data });
  };

  availability = async (req: Request, res: Response) => {
    const data = await productService.availability(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  get = async (req: Request, res: Response) => {
    const data = await productService.get(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };

  update = async (req: Request, res: Response) => {
    const data = await productService.update(req.tenant!.id, req.params.id as string, req.body);
    res.json({ success: true, data });
  };

  softDelete = async (req: Request, res: Response) => {
    const data = await productService.softDelete(req.tenant!.id, req.params.id as string);
    res.json({ success: true, data });
  };
}

export const productController = new ProductController();
