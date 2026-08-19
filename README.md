# test-y-backend

Backend API được xây dựng với **Node.js**, **Express**, **TypeScript** và **PostgreSQL**.

## Yêu cầu

- Node.js >= 18
- PostgreSQL >= 14

## Cài đặt

```bash
# Cài dependencies
npm install

# Copy file env và chỉnh sửa thông tin database
cp .env.example .env
```

## Cấu hình Database

1. Tạo database PostgreSQL:

```sql
CREATE DATABASE test_y_db;
```

2. Chạy migration/schema:

```bash
psql -U postgres -d test_y_db -f database/init.sql
```

3. Cập nhật file `.env` với thông tin kết nối PostgreSQL của bạn.

## Chạy ứng dụng

```bash
# Development (hot reload)
npm run dev

# Build production
npm run build

# Chạy production
npm start
```

Server mặc định chạy tại `http://localhost:3000`

## API Endpoints

| Method | Endpoint        | Mô tả                    |
|--------|-----------------|--------------------------|
| GET    | `/api/health`   | Kiểm tra trạng thái API & DB |
| GET    | `/api/users`    | Lấy danh sách users      |
| GET    | `/api/users/:id`| Lấy user theo ID         |
| POST   | `/api/users`    | Tạo user mới             |

### Ví dụ

```bash
# Health check
curl http://localhost:3000/api/health

# Tạo user
curl -X POST http://localhost:3000/api/users \
  -H "Content-Type: application/json" \
  -d '{"name": "John Doe", "email": "john@example.com"}'

# Lấy danh sách users
curl http://localhost:3000/api/users
```

## Cấu trúc thư mục

```
src/
├── config/          # Cấu hình ứng dụng
├── database/        # Kết nối PostgreSQL (connection pool)
├── middleware/      # Express middleware
├── routes/          # API routes
├── app.ts           # Express app setup
└── index.ts         # Entry point
database/
└── init.sql         # Schema khởi tạo database
```

## Scripts

| Script        | Mô tả                          |
|---------------|--------------------------------|
| `npm run dev` | Chạy dev server với hot reload |
| `npm run build` | Build TypeScript sang JS     |
| `npm start`   | Chạy production build          |
| `npm run typecheck` | Kiểm tra TypeScript types |
