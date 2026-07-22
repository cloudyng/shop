# MiniShop — Web Shop + SePay Checkout

Web shop tĩnh (HTML/CSS/JS, có nút gạt sáng/tối) + backend Cloudflare Worker (Node.js compat) tích hợp cổng thanh toán **SePay** kèm **IPN**.

```
sepay-shop/
├── public/            # Frontend (deploy lên Cloudflare Pages hoặc host tĩnh)
│   ├── index.html
│   ├── style.css
│   └── app.js
└── worker/            # Cloudflare Worker (backend SePay + IPN)
    ├── src/index.js
    ├── wrangler.toml
    └── package.json
```

## 1. Deploy Worker (backend)

```bash
cd worker
npm install

# Tạo KV lưu đơn hàng, dán id trả về vào wrangler.toml
npx wrangler kv namespace create ORDERS

# Nạp secret SePay
npx wrangler secret put SEPAY_MERCHANT_ID
npx wrangler secret put SEPAY_SECRET_KEY

# Sửa SITE_URL trong wrangler.toml thành domain frontend của bạn
npx wrangler deploy
```

Worker sẽ có URL dạng: `https://sepay-shop-worker.<account>.workers.dev`

## 2. Deploy Frontend

- Sửa `API_BASE` trong `public/app.js` thành URL Worker (nếu khác domain).
- Deploy thư mục `public/` lên **Cloudflare Pages** (hoặc bất kỳ host tĩnh nào).

```bash
npx wrangler pages deploy public
```

## 3. Cấu hình IPN trên dashboard SePay

Trong trang quản trị merchant SePay, đặt **IPN URL** trỏ tới:

```
https://sepay-shop-worker.<account>.workers.dev/api/ipn
```

SePay sẽ gọi server→server tới endpoint này mỗi khi có kết quả thanh toán.
Worker xác thực chữ ký (`verifySignature`), đối chiếu số tiền, rồi cập nhật
trạng thái đơn trong KV (`PENDING` → `PAID` / `FAILED`).

## Luồng thanh toán

1. Người dùng bấm **Thanh toán** → frontend gọi `POST /api/create-order`.
2. Worker lưu đơn `PENDING`, dùng `sepay-pg-node` tạo `checkoutURL` + form fields.
3. Frontend tự tạo `<form method="POST">` submit sang SePay.
4. Người dùng thanh toán trên cổng SePay.
5. SePay gọi **IPN** `/api/ipn` (nguồn tin cậy để cập nhật đơn).
6. SePay redirect người dùng về `success_url` / `error_url` / `cancel_url`
   → frontend hiển thị thông báo tương ứng.

> Lưu ý bảo mật: chỉ tin **IPN** để xác nhận đã thanh toán, không tin redirect URL,
> và luôn kiểm tra lại tổng tiền phía server.
