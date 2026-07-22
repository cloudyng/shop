// ====== Cấu hình ======
// Đổi thành URL Worker của bạn sau khi deploy, ví dụ:
// const API_BASE = "https://sepay-shop-worker.your-account.workers.dev";
const API_BASE = ""; // để trống nếu Worker phục vụ cùng domain

// ====== Dữ liệu sản phẩm (demo) ======
const PRODUCTS = [
  { id: "SP01", name: "Tai nghe Bluetooth", desc: "Chống ồn, pin 30h", price: 590000, emoji: "🎧" },
  { id: "SP02", name: "Bàn phím cơ", desc: "Switch red, RGB", price: 850000, emoji: "⌨️" },
  { id: "SP03", name: "Chuột không dây", desc: "8000 DPI, im lặng", price: 320000, emoji: "🖱️" },
  { id: "SP04", name: "Webcam 1080p", desc: "Tự động lấy nét", price: 450000, emoji: "📷" },
  { id: "SP05", name: "Đèn LED để bàn", desc: "3 chế độ sáng", price: 180000, emoji: "💡" },
  { id: "SP06", name: "Loa mini", desc: "Bass mạnh, chống nước", price: 260000, emoji: "🔊" },
];

const fmt = (n) => n.toLocaleString("vi-VN") + "₫";

// ====== Theme ======
const themeToggle = document.getElementById("themeToggle");
const themeIcon = themeToggle.querySelector(".theme-icon");
function applyTheme(t) {
  document.documentElement.setAttribute("data-theme", t);
  themeIcon.textContent = t === "dark" ? "☀️" : "🌙";
  localStorage.setItem("theme", t);
}
applyTheme(localStorage.getItem("theme") ||
  (matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"));
themeToggle.onclick = () =>
  applyTheme(document.documentElement.getAttribute("data-theme") === "dark" ? "light" : "dark");

// ====== Giỏ hàng ======
let cart = JSON.parse(localStorage.getItem("cart") || "{}");
const saveCart = () => localStorage.setItem("cart", JSON.stringify(cart));

function addToCart(id) {
  cart[id] = (cart[id] || 0) + 1;
  saveCart(); renderCart();
}
function changeQty(id, delta) {
  cart[id] = (cart[id] || 0) + delta;
  if (cart[id] <= 0) delete cart[id];
  saveCart(); renderCart();
}
function cartTotal() {
  return Object.entries(cart).reduce((s, [id, q]) => {
    const p = PRODUCTS.find(x => x.id === id);
    return s + (p ? p.price * q : 0);
  }, 0);
}

// ====== Render sản phẩm ======
const grid = document.getElementById("productGrid");
grid.innerHTML = PRODUCTS.map(p => `
  <div class="card">
    <div class="thumb">${p.emoji}</div>
    <div class="card-body">
      <div class="card-name">${p.name}</div>
      <div class="card-desc">${p.desc}</div>
      <div class="card-price">${fmt(p.price)}</div>
      <button class="btn-add" data-id="${p.id}">Thêm vào giỏ</button>
    </div>
  </div>`).join("");
grid.addEventListener("click", e => {
  const btn = e.target.closest(".btn-add");
  if (btn) addToCart(btn.dataset.id);
});

// ====== Render giỏ hàng ======
const cartItemsEl = document.getElementById("cartItems");
const cartCountEl = document.getElementById("cartCount");
const cartTotalEl = document.getElementById("cartTotal");
const checkoutBtn = document.getElementById("checkoutBtn");

function renderCart() {
  const entries = Object.entries(cart);
  const count = entries.reduce((s, [, q]) => s + q, 0);
  cartCountEl.textContent = count;
  cartTotalEl.textContent = fmt(cartTotal());
  checkoutBtn.disabled = count === 0;

  if (!entries.length) {
    cartItemsEl.innerHTML = `<div class="empty">Giỏ hàng trống 🛒</div>`;
    return;
  }
  cartItemsEl.innerHTML = entries.map(([id, q]) => {
    const p = PRODUCTS.find(x => x.id === id);
    return `<div class="cart-line">
      <div class="ci-emoji">${p.emoji}</div>
      <div class="ci-info">
        <div class="ci-name">${p.name}</div>
        <div class="ci-price">${fmt(p.price)} × ${q}</div>
      </div>
      <div class="qty">
        <button data-id="${id}" data-d="-1">−</button>
        <span>${q}</span>
        <button data-id="${id}" data-d="1">+</button>
      </div>
    </div>`;
  }).join("");
}
cartItemsEl.addEventListener("click", e => {
  const b = e.target.closest("button[data-d]");
  if (b) changeQty(b.dataset.id, parseInt(b.dataset.d, 10));
});

// ====== Drawer ======
const drawer = document.getElementById("cartDrawer");
const overlay = document.getElementById("overlay");
const openDrawer = () => { drawer.classList.add("open"); overlay.classList.remove("hidden"); };
const closeDrawer = () => { drawer.classList.remove("open"); overlay.classList.add("hidden"); };
document.getElementById("cartToggle").onclick = openDrawer;
document.getElementById("cartClose").onclick = closeDrawer;
overlay.onclick = closeDrawer;

// ====== Checkout ======
checkoutBtn.onclick = async () => {
  checkoutBtn.disabled = true;
  checkoutBtn.textContent = "Đang tạo đơn...";
  try {
    const items = Object.entries(cart).map(([id, qty]) => {
      const p = PRODUCTS.find(x => x.id === id);
      return { id, name: p.name, price: p.price, qty };
    });
    const res = await fetch(`${API_BASE}/api/create-order`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items, amount: cartTotal() }),
    });
    if (!res.ok) throw new Error("Không tạo được đơn hàng");
    const data = await res.json();

    // Worker trả về { checkoutURL, fields } -> tạo form POST tự submit sang SePay
    const form = document.createElement("form");
    form.method = "POST";
    form.action = data.checkoutURL;
    for (const [name, value] of Object.entries(data.fields)) {
      const input = document.createElement("input");
      input.type = "hidden";
      input.name = name;
      input.value = value;
      form.appendChild(input);
    }
    document.body.appendChild(form);
    form.submit();
  } catch (err) {
    showStatus("error", "Lỗi", err.message || "Có lỗi xảy ra, vui lòng thử lại.");
    checkoutBtn.disabled = false;
    checkoutBtn.textContent = "Thanh toán qua SePay";
  }
};

// ====== Modal trạng thái (khi quay lại từ SePay) ======
const statusModal = document.getElementById("statusModal");
function showStatus(type, title, msg) {
  const icon = { success: "✅", error: "❌", cancel: "⚠️" }[type] || "ℹ️";
  document.getElementById("statusIcon").textContent = icon;
  document.getElementById("statusTitle").textContent = title;
  document.getElementById("statusMsg").textContent = msg;
  statusModal.classList.remove("hidden");
}
document.getElementById("statusClose").onclick = () => statusModal.classList.add("hidden");

// Đọc query param khi SePay redirect về success/error/cancel
(function checkReturn() {
  const p = new URLSearchParams(location.search).get("payment");
  if (p === "success") {
    cart = {}; saveCart(); renderCart();
    showStatus("success", "Thanh toán thành công!", "Cảm ơn bạn đã mua hàng tại MiniShop.");
  } else if (p === "error") {
    showStatus("error", "Thanh toán thất bại", "Giao dịch không hoàn tất. Vui lòng thử lại.");
  } else if (p === "cancel") {
    showStatus("cancel", "Đã hủy thanh toán", "Bạn đã hủy giao dịch.");
  }
  if (p) history.replaceState({}, "", location.pathname);
})();

renderCart();
