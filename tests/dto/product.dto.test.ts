import { describe, expect, it, vi } from 'vitest';
import { productSchema } from '../../src/dto/product.dto';

vi.stubEnv('DATABASE_URL', 'postgresql://postgres:postgres@localhost:5432/test_db');
vi.stubEnv('JWT_ACCESS_SECRET', 'access-secret');
vi.stubEnv('JWT_REFRESH_SECRET', 'refresh-secret');

describe('productSchema', () => {
  it('parses the simplified product payload', () => {
    const parsed = productSchema.parse({
      sku: 'SP001',
      name: 'Sản phẩm A',
      baseUnitName: 'cái',
      minStockLevel: 0,
      averageCost: 0,
    });

    expect(parsed).toMatchObject({
      sku: 'SP001',
      name: 'Sản phẩm A',
      baseUnitName: 'cái',
      minStockLevel: 0,
      averageCost: 0,
    });
  });
});
