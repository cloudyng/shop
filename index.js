import { SePayPgClient } from 'sepay-pg-node';

/**
 * Cloudflare Worker tích hợp cổng thanh toán SePay.
 *
 * Endpoints:
 *   POST /api/create-order   -> tạo đơn, trả về checkoutURL + form fields cho frontend submit
 *   POST /api/ipn            -> nhận Instant Payment Notification từ SePay (server->server)
 *   GET  /api/order/:id      -> tra cứu trạng thái đơn (đọc từ KV)
 *
 * Biến môi trường (wrangler secret / vars):
 *   SEPAY_MERCHANT_ID, SEPAY_SECRET_KEY, SEPAY_ENV (sandbox|production),
 *   SITE_URL (URL frontend, dùng cho success/error/cancel)
 * KV binding:
 *   ORDERS  -> lưu trạng thái đơn hàng
 */

const cors = (origin) => ({
  'Access-Control-Allow-Origin': origin || '*',
  'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
});

const json = (data, status, origin) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors(origin) },
  });

function makeClient(env) {
  return new SePayPgClient({
    env: env.SEPAY_ENV || 'sandbox',
    merchant_id: env.SEPAY_MERCHANT_ID,
    secret_key: env.SEPAY_SECRET_KEY,
  });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const origin = request.headers.get('Origin');

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors(origin) });
    }

    try {
      // ---- 1. Tạo đơn hàng + init checkout ----
      if (url.pathname === '/api/create-order' && request.method === 'POST') {
        const body = await request.json();
        const { items = [], amount } = body;

        if (!Array.isArray(items) || !items.length || !amount || amount <= 0) {
          return json({ error: 'Dữ liệu đơn hàng không hợp lệ' }, 400, origin);
        }

        // Xác minh lại tổng tiền phía server (không tin client)
        const serverAmount = items.reduce((s, it) => s + Number(it.price) * Number(it.qty), 0);
        if (serverAmount !== Number(amount)) {
          return json({ error: 'Tổng tiền không khớp' }, 400, origin);
        }

        const orderId = 'DH' + Date.now() + Math.floor(Math.random() * 1000);
        const site = env.SITE_URL || url.origin;

        // Lưu đơn ở trạng thái PENDING
        await env.ORDERS.put(
          orderId,
          JSON.stringify({
            id: orderId,
            items,
            amount: serverAmount,
            status: 'PENDING',
            createdAt: new Date().toISOString(),
          }),
          { expirationTtl: 60 * 60 * 24 } // giữ 24h
        );

        const client = makeClient(env);
        const checkoutURL = client.checkout.initCheckoutUrl();
        const fields = client.checkout.initOneTimePaymentFields({
          payment_method: 'BANK_TRANSFER',
          order_invoice_number: orderId,
          order_amount: serverAmount,
          currency: 'VND',
          order_description: `Thanh toan don hang ${orderId}`,
          success_url: `${site}/?payment=success&order=${orderId}`,
          error_url: `${site}/?payment=error&order=${orderId}`,
          cancel_url: `${site}/?payment=cancel&order=${orderId}`,
        });

        return json({ orderId, checkoutURL, fields }, 200, origin);
      }

      // ---- 2. IPN: SePay gọi server->server để báo kết quả ----
      if (url.pathname === '/api/ipn' && request.method === 'POST') {
        const raw = await request.text();

        // SePay có thể gửi JSON hoặc form-urlencoded
        let payload;
        const ct = request.headers.get('Content-Type') || '';
        if (ct.includes('application/json')) {
          payload = JSON.parse(raw);
        } else {
          payload = Object.fromEntries(new URLSearchParams(raw));
        }

        const client = makeClient(env);

        // Xác thực chữ ký IPN bằng secret_key -> chống giả mạo
        let valid = false;
        try {
          valid = client.ipn.verifySignature(payload);
        } catch (_) {
          valid = false;
        }
        if (!valid) {
          return new Response('INVALID_SIGNATURE', { status: 400 });
        }

        const orderId = payload.order_invoice_number;
        const paidAmount = Number(payload.order_amount);
        // Trạng thái từ SePay: SUCCESS / FAILED / ...
        const sepayStatus = (payload.status || payload.payment_status || '').toUpperCase();

        const stored = await env.ORDERS.get(orderId);
        if (!stored) {
          return new Response('ORDER_NOT_FOUND', { status: 404 });
        }
        const order = JSON.parse(stored);

        // Đối chiếu số tiền để chắc chắn không bị sửa
        if (paidAmount !== Number(order.amount)) {
          return new Response('AMOUNT_MISMATCH', { status: 400 });
        }

        // Cập nhật trạng thái (idempotent: chỉ cập nhật nếu còn PENDING)
        if (order.status === 'PENDING') {
          order.status = sepayStatus === 'SUCCESS' ? 'PAID' : 'FAILED';
          order.paidAt = new Date().toISOString();
          order.gatewayRef = payload.transaction_id || payload.txn_ref || null;
          await env.ORDERS.put(orderId, JSON.stringify(order), {
            expirationTtl: 60 * 60 * 24 * 30,
          });

          // TODO: nếu PAID -> tại đây bạn có thể giao hàng, gửi email, ghi DB...
        }

        // Bắt buộc trả 200 để SePay biết đã nhận IPN thành công
        return new Response('OK', { status: 200 });
      }

      // ---- 3. Tra cứu trạng thái đơn ----
      if (url.pathname.startsWith('/api/order/') && request.method === 'GET') {
        const id = url.pathname.split('/').pop();
        const stored = await env.ORDERS.get(id);
        if (!stored) return json({ error: 'Không tìm thấy đơn' }, 404, origin);
        return json(JSON.parse(stored), 200, origin);
      }

      return json({ error: 'Not found' }, 404, origin);
    } catch (err) {
      return json({ error: err.message || 'Server error' }, 500, origin);
    }
  },
};
