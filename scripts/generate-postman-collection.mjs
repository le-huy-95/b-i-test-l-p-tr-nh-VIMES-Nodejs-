import { writeFileSync } from 'fs';
import { randomUUID } from 'crypto';

const baseUrl = '{{baseUrl}}';

function req(name, method, path, options = {}) {
  const {
    body,
    auth = 'inherit',
    roles,
    tenant = false,
    query = [],
    description = '',
    testScript = [],
  } = options;

  const headers = [{ key: 'Content-Type', value: 'application/json' }];
  if (tenant) {
    headers.push({ key: 'X-Tenant-Id', value: '{{tenantId}}' });
  }

  const request = {
    method,
    header: headers,
    url: {
      raw: `${baseUrl}${path}`,
      host: ['{{baseUrl}}'],
      path: path.replace(/^\//, '').split('/'),
    },
    description: [description, roles ? `Required roles: ${roles}` : ''].filter(Boolean).join('\n\n'),
  };

  if (query.length) {
    request.url.query = query.map((q) => ({
      key: q.key,
      value: q.value,
      description: q.description || '',
      disabled: q.disabled ?? false,
    }));
  }

  if (body !== undefined) {
    request.body = {
      mode: 'raw',
      raw: typeof body === 'string' ? body : JSON.stringify(body, null, 2),
      options: { raw: { language: 'json' } },
    };
  }

  if (auth === 'none') {
    request.auth = { type: 'noauth' };
  }

  const item = { name, request };
  if (testScript.length) {
    item.event = [
      {
        listen: 'test',
        script: { type: 'text/javascript', exec: testScript },
      },
    ];
  }
  return item;
}

const loginTestScript = [
  'const res = pm.response.json();',
  'if (res.success && res.data) {',
  "  if (res.data.accessToken) pm.collectionVariables.set('accessToken', res.data.accessToken);",
  "  if (res.data.refreshToken) pm.collectionVariables.set('refreshToken', res.data.refreshToken);",
  "  if (res.data.tenants?.length) pm.collectionVariables.set('tenantId', res.data.tenants[0].id);",
  '}',
];

const saveIdScript = (varName) => [
  'const res = pm.response.json();',
  'if (res.success && res.data?.id) {',
  `  pm.collectionVariables.set('${varName}', res.data.id);`,
  '}',
];

const collection = {
  info: {
    _postman_id: randomUUID(),
    name: 'Inventory API',
    description:
      'API collection for test-y-Backend inventory system.\n\nBase path: /api/v1\n\nAuth: Bearer {{accessToken}}\nTenant-scoped routes require header X-Tenant-Id: {{tenantId}}\n\nRun Login first to auto-save tokens and tenantId.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: {
    type: 'bearer',
    bearer: [{ key: 'token', value: '{{accessToken}}', type: 'string' }],
  },
  variable: [
    { key: 'baseUrl', value: 'http://localhost:3000' },
    { key: 'accessToken', value: '' },
    { key: 'refreshToken', value: '' },
    { key: 'tenantId', value: '' },
    { key: 'warehouseId', value: '' },
    { key: 'productId', value: '' },
    { key: 'supplierId', value: '' },
    { key: 'customerId', value: '' },
    { key: 'stockReceiptId', value: '' },
    { key: 'stockIssueId', value: '' },
    { key: 'stockOpeningId', value: '' },
    { key: 'platformTenantId', value: '' },
  ],
  item: [
    {
      name: 'Health',
      item: [
        req('Health Check (v1)', 'GET', '/api/v1/health', {
          auth: 'none',
          description: 'Check API and database connectivity',
        }),
        req('Health Check (legacy)', 'GET', '/api/health', {
          auth: 'none',
          description: 'Legacy health endpoint (redirects to /api/v1/health)',
        }),
      ],
    },
    {
      name: 'Auth',
      item: [
        req('Register', 'POST', '/api/v1/auth/register', {
          auth: 'none',
          body: {
            email: 'user@example.com',
            password: 'password123',
            name: 'Test User',
          },
        }),
        req('Verify OTP', 'POST', '/api/v1/auth/verify-otp', {
          auth: 'none',
          body: { email: 'user@example.com', code: '123456' },
        }),
        req('Resend OTP', 'POST', '/api/v1/auth/resend-otp', {
          auth: 'none',
          body: { email: 'user@example.com' },
        }),
        req('Login', 'POST', '/api/v1/auth/login', {
          auth: 'none',
          body: {
            email: 'user@example.com',
            password: 'password123',
            device: {
              deviceId: 'postman-device-1',
              deviceType: 'web',
            },
          },
          testScript: loginTestScript,
        }),
        req('Login with Google', 'POST', '/api/v1/auth/login/google', {
          auth: 'none',
          body: {
            idToken: 'GOOGLE_ID_TOKEN',
            device: { deviceId: 'postman-device-1', deviceType: 'web' },
          },
          description: 'Requires Firebase/Google OAuth configuration',
        }),
        req('Refresh Token', 'POST', '/api/v1/auth/refresh', {
          auth: 'none',
          body: { refreshToken: '{{refreshToken}}' },
          testScript: [
            'const res = pm.response.json();',
            'if (res.success && res.data) {',
            "  if (res.data.accessToken) pm.collectionVariables.set('accessToken', res.data.accessToken);",
            "  if (res.data.refreshToken) pm.collectionVariables.set('refreshToken', res.data.refreshToken);",
            '}',
          ],
        }),
        req('Logout', 'POST', '/api/v1/auth/logout', {
          auth: 'none',
          body: { refreshToken: '{{refreshToken}}', deviceId: 'postman-device-1' },
        }),
        req('Get Me', 'GET', '/api/v1/auth/me', {
          description: 'Get current user profile and tenant memberships',
        }),
        req('Create Tenant', 'POST', '/api/v1/auth/tenants', {
          body: { code: 'MYCO', name: 'My Company' },
          testScript: saveIdScript('tenantId'),
        }),
        req('Accept Invitation', 'POST', '/api/v1/auth/invitations/accept', {
          body: { token: 'INVITATION_TOKEN' },
        }),
        req('Platform Create Tenant', 'POST', '/api/v1/auth/platform/tenants', {
          body: { code: 'PLAT01', name: 'Platform Tenant' },
          roles: 'platform admin',
          testScript: saveIdScript('platformTenantId'),
        }),
        req('Platform Patch Tenant', 'PATCH', '/api/v1/auth/platform/tenants/{{platformTenantId}}', {
          body: { status: 'active', name: 'Updated Tenant Name' },
          roles: 'platform admin',
        }),
      ],
    },
    {
      name: 'Tenant',
      description: 'Requires X-Tenant-Id header',
      item: [
        req('Invite User', 'POST', '/api/v1/tenants/current/invitations', {
          tenant: true,
          roles: 'admin',
          body: { email: 'invitee@example.com', role: 'warehouse_keeper' },
        }),
        req('Create Internal User', 'POST', '/api/v1/tenants/current/users', {
          tenant: true,
          roles: 'admin',
          body: {
            email: 'staff@example.com',
            password: 'password123',
            name: 'Staff User',
            role: 'warehouse_keeper',
            warehouseIds: ['{{warehouseId}}'],
          },
        }),
      ],
    },
    {
      name: 'Warehouses',
      item: [
        req('List Warehouses', 'GET', '/api/v1/warehouses', { tenant: true }),
        req('Create Warehouse', 'POST', '/api/v1/warehouses', {
          tenant: true,
          roles: 'admin',
          body: {
            code: 'WH01',
            name: 'Main Warehouse',
            address: '123 Street, City',
            latitude: 10.762622,
            longitude: 106.660172,
          },
          testScript: saveIdScript('warehouseId'),
        }),
        req('Get Warehouse', 'GET', '/api/v1/warehouses/{{warehouseId}}', { tenant: true }),
        req('Update Warehouse', 'PUT', '/api/v1/warehouses/{{warehouseId}}', {
          tenant: true,
          roles: 'admin',
          body: { name: 'Updated Warehouse Name', address: '456 New Street' },
        }),
      ],
    },
    {
      name: 'Products',
      item: [
        req('List Products', 'GET', '/api/v1/products', { tenant: true }),
        req('Create Product', 'POST', '/api/v1/products', {
          tenant: true,
          roles: 'admin',
          body: {
            sku: 'SKU-001',
            barcode: '8931234567890',
            name: 'Sample Product',
            baseUnitName: 'cái',
            minStockLevel: 0,
            maxStockLevel: null,
            reorderPoint: null,
            averageCost: 0,
            minStockLevel: 0,
            units: [{ unitName: 'thùng', conversionRate: 12 }],
          },
          testScript: saveIdScript('productId'),
        }),
        req('Get Product by Barcode', 'GET', '/api/v1/products/barcode/8931234567890', {
          tenant: true,
        }),
        req('Get Product', 'GET', '/api/v1/products/{{productId}}', { tenant: true }),
        req('Update Product', 'PUT', '/api/v1/products/{{productId}}', {
          tenant: true,
          roles: 'admin',
          body: { name: 'Updated Product Name', minStockLevel: 10 },
        }),
        req('Delete Product (soft)', 'DELETE', '/api/v1/products/{{productId}}', {
          tenant: true,
          roles: 'admin',
        }),
      ],
    },
    {
      name: 'Suppliers',
      item: [
        req('List Suppliers', 'GET', '/api/v1/suppliers', { tenant: true }),
        req('Create Supplier', 'POST', '/api/v1/suppliers', {
          tenant: true,
          roles: 'admin',
          body: {
            code: 'SUP01',
            name: 'ABC Supplier',
            taxCode: '0123456789',
            contact: 'contact@abc.com',
          },
          testScript: saveIdScript('supplierId'),
        }),
        req('Get Supplier', 'GET', '/api/v1/suppliers/{{supplierId}}', { tenant: true }),
        req('Update Supplier', 'PUT', '/api/v1/suppliers/{{supplierId}}', {
          tenant: true,
          roles: 'admin',
          body: { name: 'Updated Supplier Name', contact: 'new@abc.com' },
        }),
      ],
    },
    {
      name: 'Customers',
      item: [
        req('List Customers', 'GET', '/api/v1/customers', { tenant: true }),
        req('Create Customer', 'POST', '/api/v1/customers', {
          tenant: true,
          roles: 'admin',
          body: {
            code: 'CUS01',
            name: 'John Doe',
            phone: '0901234567',
            email: 'john@example.com',
          },
          testScript: saveIdScript('customerId'),
        }),
        req('Get Customer', 'GET', '/api/v1/customers/{{customerId}}', { tenant: true }),
        req('Update Customer', 'PUT', '/api/v1/customers/{{customerId}}', {
          tenant: true,
          roles: 'admin',
          body: { name: 'Jane Doe', phone: '0907654321' },
        }),
      ],
    },
    {
      name: 'Stock Opening Balances',
      item: [
        req('List Stock Opening Balances', 'GET', '/api/v1/stock-opening-balances', { tenant: true }),
        req('Create Stock Opening Balance', 'POST', '/api/v1/stock-opening-balances', {
          tenant: true,
          roles: 'admin',
          body: {
            warehouseId: '{{warehouseId}}',
            effectiveDate: '2026-01-01',
            note: 'Initial stock',
            lines: [{ productId: '{{productId}}', qty: 100, unitCost: 50000 }],
          },
          testScript: saveIdScript('stockOpeningId'),
        }),
        req('Post Stock Opening Balance', 'POST', '/api/v1/stock-opening-balances/{{stockOpeningId}}/post', {
          tenant: true,
          roles: 'admin, accountant, approver',
        }),
      ],
    },
    {
      name: 'Stock Receipts',
      item: [
        req('List Stock Receipts', 'GET', '/api/v1/stock-receipts', { tenant: true }),
        req('Create Stock Receipt', 'POST', '/api/v1/stock-receipts', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
          body: {
            warehouseId: '{{warehouseId}}',
            supplierId: '{{supplierId}}',
            receiptDate: '2026-01-15',
            deliveredByName: 'Driver A',
            note: 'Monthly delivery',
            lines: [
              {
                productId: '{{productId}}',
                unitName: 'cái',
                expectedQty: 100,
                actualQty: 100,
                unitPrice: 45000,
              },
            ],
          },
          testScript: saveIdScript('stockReceiptId'),
        }),
        req('Get Stock Receipt', 'GET', '/api/v1/stock-receipts/{{stockReceiptId}}', { tenant: true }),
        req('Submit Stock Receipt', 'POST', '/api/v1/stock-receipts/{{stockReceiptId}}/submit', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
        }),
        req('Approve Stock Receipt', 'POST', '/api/v1/stock-receipts/{{stockReceiptId}}/approve', {
          tenant: true,
          roles: 'admin, accountant, approver',
        }),
        req('Reject Stock Receipt', 'POST', '/api/v1/stock-receipts/{{stockReceiptId}}/reject', {
          tenant: true,
          roles: 'admin, accountant, approver',
          body: { reason: 'Quantity mismatch' },
        }),
        req('Complete Stock Receipt', 'POST', '/api/v1/stock-receipts/{{stockReceiptId}}/complete', {
          tenant: true,
          roles: 'admin, accountant, approver',
        }),
        req('Cancel Stock Receipt', 'POST', '/api/v1/stock-receipts/{{stockReceiptId}}/cancel', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
        }),
        req('Clone from Rejected Receipt', 'POST', '/api/v1/stock-receipts/{{stockReceiptId}}/clone-from-rejected', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
        }),
      ],
    },
    {
      name: 'Stock Issues',
      item: [
        req('List Stock Issues', 'GET', '/api/v1/stock-issues', { tenant: true }),
        req('Create Stock Issue', 'POST', '/api/v1/stock-issues', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
          body: {
            warehouseId: '{{warehouseId}}',
            issueType: 'sale',
            customerId: '{{customerId}}',
            issueDate: '2026-01-20',
            note: 'Customer order',
            lines: [
              {
                productId: '{{productId}}',
                unitName: 'cái',
                requestedQty: 10,
                actualQty: 10,
                unitPrice: 60000,
              },
            ],
          },
          testScript: saveIdScript('stockIssueId'),
        }),
        req('Get Stock Issue', 'GET', '/api/v1/stock-issues/{{stockIssueId}}', { tenant: true }),
        req('Submit Stock Issue', 'POST', '/api/v1/stock-issues/{{stockIssueId}}/submit', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
        }),
        req('Approve Stock Issue', 'POST', '/api/v1/stock-issues/{{stockIssueId}}/approve', {
          tenant: true,
          roles: 'admin, accountant, approver',
        }),
        req('Reject Stock Issue', 'POST', '/api/v1/stock-issues/{{stockIssueId}}/reject', {
          tenant: true,
          roles: 'admin, accountant, approver',
          body: { reason: 'Insufficient stock' },
        }),
        req('Complete Stock Issue', 'POST', '/api/v1/stock-issues/{{stockIssueId}}/complete', {
          tenant: true,
          roles: 'admin, accountant, approver',
        }),
        req('Cancel Stock Issue', 'POST', '/api/v1/stock-issues/{{stockIssueId}}/cancel', {
          tenant: true,
          roles: 'admin, warehouse_keeper',
        }),
      ],
    },
    {
      name: 'Reports',
      item: [
        req('Stock Balance Report', 'GET', '/api/v1/reports/stock-balance', {
          tenant: true,
          query: [
            { key: 'warehouseId', value: '{{warehouseId}}', description: 'Optional filter by warehouse' },
          ],
        }),
        req('Stock Movement Report', 'GET', '/api/v1/reports/stock-movement', {
          tenant: true,
          query: [
            { key: 'warehouseId', value: '{{warehouseId}}', description: 'Optional filter by warehouse' },
            { key: 'from', value: '2026-01-01', description: 'Start date (ISO string)' },
            { key: 'to', value: '2026-12-31', description: 'End date (ISO string)' },
          ],
        }),
      ],
    },
  ],
};

const environment = {
  id: randomUUID(),
  name: 'Inventory API - Local',
  values: [
    { key: 'baseUrl', value: 'http://localhost:3000', type: 'default', enabled: true },
    { key: 'accessToken', value: '', type: 'secret', enabled: true },
    { key: 'refreshToken', value: '', type: 'secret', enabled: true },
    { key: 'tenantId', value: '', type: 'default', enabled: true },
    { key: 'warehouseId', value: '', type: 'default', enabled: true },
    { key: 'productId', value: '', type: 'default', enabled: true },
    { key: 'supplierId', value: '', type: 'default', enabled: true },
    { key: 'customerId', value: '', type: 'default', enabled: true },
    { key: 'stockReceiptId', value: '', type: 'default', enabled: true },
    { key: 'stockIssueId', value: '', type: 'default', enabled: true },
    { key: 'stockOpeningId', value: '', type: 'default', enabled: true },
    { key: 'platformTenantId', value: '', type: 'default', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

writeFileSync(
  'postman/Inventory-API.postman_collection.json',
  JSON.stringify(collection, null, 2),
);
writeFileSync(
  'postman/Inventory-API-Local.postman_environment.json',
  JSON.stringify(environment, null, 2),
);

const count = collection.item.reduce((acc, folder) => acc + folder.item.length, 0);
console.log(`Generated ${count} API requests in postman/Inventory-API.postman_collection.json`);
