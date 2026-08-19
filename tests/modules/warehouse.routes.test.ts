import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const ROUTES = new URL('../../src/modules/warehouse/warehouse.routes.ts', import.meta.url);

describe('warehouse routes roles', () => {
  it('allows admin and warehouse_keeper to mutate warehouse activity', () => {
    const src = readFileSync(ROUTES, 'utf8');
    const allowed = "requireRoles('admin', 'warehouse_keeper')";
    expect(src).toContain(`router.post('/', ${allowed}`);
    expect(src).toContain(`router.put('/:id', ${allowed}`);
    expect(src).toContain(`router.delete('/:id', ${allowed}`);
    expect(src).toContain(`router.patch('/:id/deactivate', ${allowed}`);
    expect(src).toContain(`router.patch('/:id/activate', ${allowed}`);
  });
});