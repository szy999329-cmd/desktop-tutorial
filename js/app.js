/* 面包工厂 · 面包店经营管理 App
 * 纯前端单页应用，数据保存在浏览器 localStorage，可离线使用。 */
(function () {
  "use strict";

  // 防点击劫持：若本页被嵌入到别的网站的 iframe 中，立即跳出/隐藏
  try { if (window.top !== window.self) { window.top.location = window.self.location; } }
  catch (e) { document.documentElement.style.display = "none"; }

  const STORE_KEY = "breadfactory.v1";
  const BREAD_EMOJIS = ["🥖", "🥐", "🍞", "🥯", "🥨", "🧇", "🍰", "🧁", "🍪", "🥧", "🍩", "🥞"];

  /* ---------- 状态与持久化 ---------- */
  const defaultState = () => ({
    shopName: "面包工厂",
    currency: "¥",
    products: [],
    orders: [],
    seeded: false,
  });

  let state = load();
  let activeTab = "dashboard";
  let cart = {}; // productId -> qty

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) return sanitizeState(raw);
    } catch (e) { /* ignore */ }
    return defaultState();
  }
  function save() {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); }
    catch (e) { toast("保存失败：存储空间可能已满"); }
  }

  /* 安全校验：把任何来源（localStorage / 导入备份）的数据重建成干净对象。
     只复制已知字段、强制类型、白名单 emoji，从根上杜绝 XSS / 原型污染 / 类型混淆。 */
  function num(v, min) { const n = Number(v); return Number.isFinite(n) ? Math.max(min, n) : min; }
  function str(v, max, fallback) { return typeof v === "string" ? v.slice(0, max) : (fallback || ""); }
  function safeEmoji(e) { return BREAD_EMOJIS.indexOf(e) >= 0 ? e : "🥖"; }
  function sanitizeProduct(p) {
    if (!p || typeof p !== "object") return null;
    return {
      id: str(p.id, 40) || uid(),
      name: str(p.name, 60, "未命名"),
      emoji: safeEmoji(p.emoji),
      category: str(p.category, 30, "其他"),
      price: num(p.price, 0), cost: num(p.cost, 0),
      stock: Math.floor(num(p.stock, 0)), low: Math.floor(num(p.low, 0)),
    };
  }
  function sanitizeOrder(o) {
    if (!o || typeof o !== "object" || !Array.isArray(o.items)) return null;
    const items = o.items.map((i) => (i && typeof i === "object") ? {
      productId: str(i.productId, 40), name: str(i.name, 60), emoji: safeEmoji(i.emoji),
      price: num(i.price, 0), cost: num(i.cost, 0), qty: Math.floor(num(i.qty, 0)),
    } : null).filter(Boolean);
    const total = num(o.total, 0), cost = num(o.cost, 0);
    return { id: str(o.id, 40) || uid(), items, total, cost,
      profit: Number.isFinite(Number(o.profit)) ? Number(o.profit) : total - cost,
      createdAt: str(o.createdAt, 40) || new Date().toISOString() };
  }
  function sanitizeState(raw) {
    let obj;
    try { obj = typeof raw === "string" ? JSON.parse(raw) : raw; } catch (e) { return defaultState(); }
    if (!obj || typeof obj !== "object") return defaultState();
    const s = defaultState();
    s.shopName = str(obj.shopName, 40) || s.shopName;
    s.currency = str(obj.currency, 3) || s.currency;
    s.seeded = !!obj.seeded;
    s.products = Array.isArray(obj.products) ? obj.products.map(sanitizeProduct).filter(Boolean) : [];
    s.orders = Array.isArray(obj.orders) ? obj.orders.map(sanitizeOrder).filter(Boolean) : [];
    return s;
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
  const money = (n) => state.currency + (Math.round(n * 100) / 100).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const todayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  /* ---------- 示例数据 ---------- */
  function seedDemo() {
    state.products = [
      { id: uid(), name: "法式长棍", emoji: "🥖", category: "面包", price: 12, cost: 4.5, stock: 24, low: 8 },
      { id: uid(), name: "牛角可颂", emoji: "🥐", category: "面包", price: 9, cost: 3.2, stock: 30, low: 10 },
      { id: uid(), name: "吐司面包", emoji: "🍞", category: "面包", price: 15, cost: 5, stock: 18, low: 6 },
      { id: uid(), name: "贝果", emoji: "🥯", category: "面包", price: 10, cost: 3.5, stock: 5, low: 8 },
      { id: uid(), name: "草莓蛋糕", emoji: "🍰", category: "蛋糕", price: 28, cost: 11, stock: 9, low: 4 },
      { id: uid(), name: "杯子蛋糕", emoji: "🧁", category: "蛋糕", price: 14, cost: 5, stock: 16, low: 6 },
      { id: uid(), name: "曲奇饼干", emoji: "🍪", category: "饼干", price: 6, cost: 1.8, stock: 40, low: 12 },
      { id: uid(), name: "甜甜圈", emoji: "🍩", category: "甜点", price: 8, cost: 2.6, stock: 3, low: 6 },
    ];
    // 造几单历史订单（今天 + 前几天）用于报表演示
    const now = new Date();
    const mkOrder = (daysAgo, picks) => {
      const d = new Date(now); d.setDate(d.getDate() - daysAgo);
      const items = picks.map(([idx, qty]) => {
        const p = state.products[idx];
        return { productId: p.id, name: p.name, emoji: p.emoji, price: p.price, cost: p.cost, qty };
      });
      const total = items.reduce((s, i) => s + i.price * i.qty, 0);
      const cost = items.reduce((s, i) => s + i.cost * i.qty, 0);
      return { id: uid(), items, total, cost, profit: total - cost, createdAt: d.toISOString() };
    };
    state.orders = [
      mkOrder(0, [[0, 3], [1, 2], [6, 4]]),
      mkOrder(0, [[4, 1], [5, 2]]),
      mkOrder(1, [[2, 2], [0, 1], [7, 3]]),
      mkOrder(1, [[1, 4], [6, 6]]),
      mkOrder(2, [[4, 2], [3, 2]]),
      mkOrder(3, [[0, 5], [2, 3], [5, 2]]),
      mkOrder(4, [[6, 10], [1, 3]]),
      mkOrder(5, [[3, 4], [7, 5]]),
    ];
    state.seeded = true;
    save();
  }

  /* ---------- 通用 UI 辅助 ---------- */
  function toast(msg) {
    const el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("is-show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("is-show"), 1800);
  }

  function openModal(title, bodyHTML, onMount) {
    const root = document.getElementById("modalRoot");
    root.innerHTML = `
      <div class="modal-backdrop">
        <div class="modal" role="dialog" aria-modal="true">
          <h3 class="modal__title">${title}</h3>
          <div id="modalBody">${bodyHTML}</div>
        </div>
      </div>`;
    const backdrop = root.querySelector(".modal-backdrop");
    backdrop.addEventListener("click", (e) => { if (e.target === backdrop) closeModal(); });
    if (onMount) onMount(root.querySelector("#modalBody"));
  }
  function closeModal() { document.getElementById("modalRoot").innerHTML = ""; }

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  /* ---------- 数据计算 ---------- */
  function ordersOn(dayKey) { return state.orders.filter((o) => todayKey(new Date(o.createdAt)) === dayKey); }
  function sum(arr, f) { return arr.reduce((s, x) => s + f(x), 0); }

  function productStats() {
    const map = {};
    state.orders.forEach((o) => o.items.forEach((i) => {
      const m = map[i.productId] || (map[i.productId] = { name: i.name, emoji: i.emoji, qty: 0, revenue: 0 });
      m.qty += i.qty; m.revenue += i.price * i.qty;
    }));
    return Object.values(map).sort((a, b) => b.qty - a.qty);
  }

  /* ---------- 各页面渲染 ---------- */
  function renderDashboard() {
    const t = todayKey();
    const today = ordersOn(t);
    const revenue = sum(today, (o) => o.total);
    const profit = sum(today, (o) => o.profit);
    const items = sum(today, (o) => sum(o.items, (i) => i.qty));
    const lowStock = state.products.filter((p) => p.stock <= p.low);
    const top = productStats().slice(0, 3);

    return `
      <h2 class="section-title">今日经营（${t}）</h2>
      <div class="grid2">
        <div class="card stat stat--accent"><span class="stat__label">今日营业额</span><span class="stat__value">${money(revenue)}</span><span class="stat__hint">${today.length} 笔订单</span></div>
        <div class="card stat"><span class="stat__label">今日毛利</span><span class="stat__value">${money(profit)}</span><span class="stat__hint">已售 ${items} 件</span></div>
      </div>
      <div class="grid2 mt12">
        <div class="card stat"><span class="stat__label">产品种类</span><span class="stat__value">${state.products.length}</span><span class="stat__hint">在售单品</span></div>
        <div class="card stat"><span class="stat__label">库存预警</span><span class="stat__value" style="color:${lowStock.length ? "var(--bad)" : "var(--good)"}">${lowStock.length}</span><span class="stat__hint">需补货</span></div>
      </div>

      <h2 class="section-title">快捷操作</h2>
      <div class="grid2">
        <button class="btn btn--primary" data-go="pos">🧾 去收银</button>
        <button class="btn btn--soft" data-action="add-product">➕ 新增产品</button>
      </div>

      ${lowStock.length ? `
      <h2 class="section-title">⚠️ 补货提醒</h2>
      ${lowStock.map((p) => `
        <div class="row">
          <div class="row__emoji">${esc(p.emoji)}</div>
          <div class="row__main"><div class="row__name">${esc(p.name)}</div><div class="row__meta">仅剩 ${p.stock} 件 · 预警线 ${p.low}</div></div>
          <div class="row__right"><button class="btn btn--sm btn--soft" data-restock="${p.id}">补货</button></div>
        </div>`).join("")}` : ""}

      <h2 class="section-title">🔥 热销榜（累计）</h2>
      ${top.length ? top.map((p, i) => `
        <div class="row">
          <div class="row__emoji">${["🥇","🥈","🥉"][i] || "🏅"}</div>
          <div class="row__main"><div class="row__name">${esc(p.emoji)} ${esc(p.name)}</div><div class="row__meta">累计售出 ${p.qty} 件</div></div>
          <div class="row__right"><div class="row__price">${money(p.revenue)}</div></div>
        </div>`).join("") : `<div class="card muted">还没有销售记录，去收银开张吧！</div>`}
    `;
  }

  function renderProducts() {
    if (!state.products.length) {
      return emptyState("🥐", "还没有产品，点右下角 ➕ 添加你的第一款面包");
    }
    const cats = {};
    state.products.forEach((p) => (cats[p.category] || (cats[p.category] = [])).push(p));
    let html = "";
    Object.keys(cats).forEach((c) => {
      html += `<h2 class="section-title">${esc(c)}</h2>`;
      html += cats[c].map((p) => {
        const margin = p.price > 0 ? Math.round((1 - p.cost / p.price) * 100) : 0;
        return `
        <div class="row" data-edit="${p.id}">
          <div class="row__emoji">${esc(p.emoji)}</div>
          <div class="row__main">
            <div class="row__name">${esc(p.name)}</div>
            <div class="row__meta">成本 ${money(p.cost)} · 毛利率 ${margin}% · 库存 ${p.stock}</div>
          </div>
          <div class="row__right"><div class="row__price">${money(p.price)}</div>
            ${p.stock <= p.low ? '<span class="badge badge--bad">缺货</span>' : '<span class="badge badge--good">在售</span>'}
          </div>
        </div>`;
      }).join("");
    });
    return html;
  }

  function renderInventory() {
    if (!state.products.length) return emptyState("📦", "暂无库存。先到「产品」页新增产品。");
    const totalStock = sum(state.products, (p) => p.stock);
    const stockValue = sum(state.products, (p) => p.stock * p.cost);
    const low = state.products.filter((p) => p.stock <= p.low).length;
    let html = `
      <div class="grid2">
        <div class="card stat stat--accent"><span class="stat__label">库存总量</span><span class="stat__value">${totalStock}</span><span class="stat__hint">件商品</span></div>
        <div class="card stat"><span class="stat__label">库存成本</span><span class="stat__value">${money(stockValue)}</span><span class="stat__hint">${low} 项预警</span></div>
      </div>
      <h2 class="section-title">库存明细（点击调整）</h2>`;
    html += state.products.slice().sort((a, b) => (a.stock - a.low) - (b.stock - b.low)).map((p) => `
      <div class="row">
        <div class="row__emoji">${esc(p.emoji)}</div>
        <div class="row__main">
          <div class="row__name">${esc(p.name)}</div>
          <div class="row__meta">预警线 ${p.low} · 库存成本 ${money(p.stock * p.cost)}</div>
        </div>
        <div class="stepper">
          <button data-stock="${p.id}" data-delta="-1">−</button>
          <span style="color:${p.stock <= p.low ? "var(--bad)" : "var(--text)"}">${p.stock}</span>
          <button data-stock="${p.id}" data-delta="1">＋</button>
          <button class="btn btn--sm btn--soft" data-restock="${p.id}" style="margin-left:6px">补货</button>
        </div>
      </div>`).join("");
    return html;
  }

  function renderPOS() {
    if (!state.products.length) return emptyState("🧾", "还没有产品可售，先去「产品」页添加。");
    let html = `<h2 class="section-title">选择商品下单</h2><div class="pos-grid">`;
    html += state.products.map((p) => {
      const out = p.stock <= 0;
      const q = cart[p.id] || 0;
      return `
      <button class="pos-item ${out ? "is-out" : ""}" data-pos="${p.id}">
        ${q ? `<span class="pos-qty">${q}</span>` : ""}
        <div class="pos-item__emoji">${esc(p.emoji)}</div>
        <div class="pos-item__name">${esc(p.name)}</div>
        <div class="pos-item__price">${money(p.price)}</div>
        <div class="pos-item__stock">${out ? "已售罄" : "库存 " + p.stock}</div>
      </button>`;
    }).join("");
    html += `</div>`;
    return html;
  }

  function renderCartBar() {
    const root = document.getElementById("modalRoot"); // reuse container? no — use dedicated
    let bar = document.getElementById("cartBar");
    const ids = Object.keys(cart).filter((k) => cart[k] > 0);
    if (activeTab !== "pos" || !ids.length) { if (bar) bar.remove(); return; }
    const count = ids.reduce((s, k) => s + cart[k], 0);
    const total = ids.reduce((s, k) => {
      const p = state.products.find((x) => x.id === k); return s + (p ? p.price * cart[k] : 0);
    }, 0);
    if (!bar) {
      bar = document.createElement("div");
      bar.id = "cartBar"; bar.className = "cart-bar";
      document.getElementById("app").appendChild(bar);
    }
    bar.innerHTML = `
      <div><div class="cart-bar__total">${money(total)}</div><div class="cart-bar__sub">${count} 件商品</div></div>
      <button class="btn" style="background:#fff;color:var(--crust-d)" id="checkoutBtn">结账 →</button>`;
    bar.querySelector("#checkoutBtn").onclick = openCheckout;
  }

  function openCheckout() {
    const ids = Object.keys(cart).filter((k) => cart[k] > 0);
    if (!ids.length) return;
    const lines = ids.map((k) => {
      const p = state.products.find((x) => x.id === k);
      return `<div class="cart-line">
        <span>${esc(p.emoji)}</span>
        <span class="cart-line__name">${esc(p.name)}</span>
        <div class="stepper">
          <button data-cart="${k}" data-delta="-1">−</button>
          <span>${cart[k]}</span>
          <button data-cart="${k}" data-delta="1">＋</button>
        </div>
        <span class="right" style="width:64px;font-weight:700">${money(p.price * cart[k])}</span>
      </div>`;
    }).join("");
    const total = ids.reduce((s, k) => { const p = state.products.find((x) => x.id === k); return s + p.price * cart[k]; }, 0);
    openModal("确认订单", `
      ${lines}
      <div class="cart-line" style="border:none"><span class="cart-line__name" style="font-weight:800">合计</span>
        <span style="font-size:18px;font-weight:800;color:var(--crust)">${money(total)}</span></div>
      <button class="btn btn--primary btn--block mt12" id="confirmOrder">✓ 完成收款</button>
      <button class="btn btn--ghost btn--block mt8" id="cancelCheckout">取消</button>
    `, (body) => {
      body.querySelectorAll("[data-cart]").forEach((b) => b.onclick = () => {
        const id = b.getAttribute("data-cart");
        adjustCart(id, parseInt(b.getAttribute("data-delta"), 10));
        if (Object.keys(cart).filter((k) => cart[k] > 0).length) openCheckout(); else closeModal();
        renderCartBar();
      });
      body.querySelector("#confirmOrder").onclick = completeOrder;
      body.querySelector("#cancelCheckout").onclick = closeModal;
    });
  }

  function completeOrder() {
    const ids = Object.keys(cart).filter((k) => cart[k] > 0);
    const items = ids.map((k) => {
      const p = state.products.find((x) => x.id === k);
      p.stock = Math.max(0, p.stock - cart[k]);
      return { productId: p.id, name: p.name, emoji: p.emoji, price: p.price, cost: p.cost, qty: cart[k] };
    });
    const total = sum(items, (i) => i.price * i.qty);
    const cost = sum(items, (i) => i.cost * i.qty);
    state.orders.push({ id: uid(), items, total, cost, profit: total - cost, createdAt: new Date().toISOString() });
    save();
    cart = {};
    closeModal();
    toast("收款成功 " + money(total));
    render();
  }

  function adjustCart(id, delta) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    const next = (cart[id] || 0) + delta;
    if (next <= 0) { delete cart[id]; return; }
    if (next > p.stock) { toast("库存不足，仅剩 " + p.stock); return; }
    cart[id] = next;
  }

  function renderReports() {
    if (!state.orders.length) return emptyState("📈", "还没有销售数据，完成订单后这里会生成报表。");
    // 近 7 天营业额
    const days = [];
    for (let i = 6; i >= 0; i--) {
      const d = new Date(); d.setDate(d.getDate() - i);
      const k = todayKey(d);
      const os = ordersOn(k);
      days.push({ key: k, label: `${d.getMonth() + 1}/${d.getDate()}`, revenue: sum(os, (o) => o.total), profit: sum(os, (o) => o.profit) });
    }
    const maxRev = Math.max(1, ...days.map((d) => d.revenue));
    const totalRev = sum(state.orders, (o) => o.total);
    const totalProfit = sum(state.orders, (o) => o.profit);
    const avg = totalRev / state.orders.length;
    const top = productStats().slice(0, 5);
    const maxQty = Math.max(1, ...top.map((p) => p.qty));

    let html = `
      <div class="grid2">
        <div class="card stat stat--accent"><span class="stat__label">累计营业额</span><span class="stat__value">${money(totalRev)}</span><span class="stat__hint">${state.orders.length} 笔订单</span></div>
        <div class="card stat"><span class="stat__label">累计毛利</span><span class="stat__value">${money(totalProfit)}</span><span class="stat__hint">客单价 ${money(avg)}</span></div>
      </div>
      <h2 class="section-title">近 7 天营业额</h2>
      <div class="card">
        ${days.map((d) => `
          <div class="bar-row">
            <div class="bar-row__label">${d.label}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(d.revenue / maxRev * 100)}%"></div></div>
            <div class="bar-row__val">${d.revenue ? money(d.revenue) : "—"}</div>
          </div>`).join("")}
      </div>
      <h2 class="section-title">畅销商品 Top 5</h2>
      <div class="card">
        ${top.map((p) => `
          <div class="bar-row">
            <div class="bar-row__label">${esc(p.emoji)} ${esc(p.name)}</div>
            <div class="bar-track"><div class="bar-fill" style="width:${Math.round(p.qty / maxQty * 100)}%"></div></div>
            <div class="bar-row__val">${p.qty} 件</div>
          </div>`).join("")}
      </div>`;
    return html;
  }

  function emptyState(emoji, text) {
    return `<div class="empty"><div class="empty__emoji">${emoji}</div><div class="empty__text">${text}</div></div>`;
  }

  /* ---------- 产品表单 ---------- */
  function productForm(existing) {
    const p = existing || { name: "", emoji: "🥖", category: "面包", price: "", cost: "", stock: 0, low: 8 };
    const body = `
      <div class="field"><label>名称</label><input id="pName" value="${esc(p.name)}" placeholder="如：法式长棍" /></div>
      <div class="field"><label>图标</label><div class="emoji-picker" id="pEmoji">
        ${BREAD_EMOJIS.map((e) => `<button type="button" data-e="${e}" class="${e === p.emoji ? "is-active" : ""}">${e}</button>`).join("")}
      </div></div>
      <div class="field"><label>分类</label>
        <input id="pCategory" value="${esc(p.category)}" list="catList" placeholder="面包 / 蛋糕 / 饼干..." />
        <datalist id="catList">${[...new Set(state.products.map((x) => x.category))].map((c) => `<option value="${esc(c)}">`).join("")}</datalist>
      </div>
      <div class="field-row">
        <div class="field"><label>售价 (${state.currency})</label><input id="pPrice" type="number" inputmode="decimal" step="0.5" value="${p.price}" placeholder="0.00" /></div>
        <div class="field"><label>成本 (${state.currency})</label><input id="pCost" type="number" inputmode="decimal" step="0.5" value="${p.cost}" placeholder="0.00" /></div>
      </div>
      <div class="field-row">
        <div class="field"><label>当前库存</label><input id="pStock" type="number" inputmode="numeric" value="${p.stock}" /></div>
        <div class="field"><label>预警库存</label><input id="pLow" type="number" inputmode="numeric" value="${p.low}" /></div>
      </div>
      <button class="btn btn--primary btn--block mt8" id="saveProduct">保存</button>
      ${existing ? `<button class="btn btn--danger btn--block mt8" id="delProduct">删除该产品</button>` : ""}
      <button class="btn btn--ghost btn--block mt8" id="cancelProduct">取消</button>
    `;
    openModal(existing ? "编辑产品" : "新增产品", body, (root) => {
      let emoji = p.emoji;
      root.querySelectorAll("#pEmoji button").forEach((b) => b.onclick = () => {
        emoji = b.getAttribute("data-e");
        root.querySelectorAll("#pEmoji button").forEach((x) => x.classList.remove("is-active"));
        b.classList.add("is-active");
      });
      root.querySelector("#saveProduct").onclick = () => {
        const name = root.querySelector("#pName").value.trim();
        const price = parseFloat(root.querySelector("#pPrice").value) || 0;
        const cost = parseFloat(root.querySelector("#pCost").value) || 0;
        const stock = parseInt(root.querySelector("#pStock").value, 10) || 0;
        const low = parseInt(root.querySelector("#pLow").value, 10) || 0;
        const category = root.querySelector("#pCategory").value.trim() || "其他";
        if (!name) { toast("请填写产品名称"); return; }
        if (existing) {
          Object.assign(existing, { name, emoji, category, price, cost, stock, low });
        } else {
          state.products.push({ id: uid(), name, emoji, category, price, cost, stock, low });
        }
        save(); closeModal(); render(); toast("已保存");
      };
      if (existing) root.querySelector("#delProduct").onclick = () => {
        state.products = state.products.filter((x) => x.id !== existing.id);
        save(); closeModal(); render(); toast("已删除");
      };
      root.querySelector("#cancelProduct").onclick = closeModal;
    });
  }

  function restockForm(id) {
    const p = state.products.find((x) => x.id === id);
    if (!p) return;
    openModal(`补货 · ${esc(p.name)}`, `
      <div class="field"><label>当前库存：${p.stock} 件，补货数量</label>
        <input id="rAmount" type="number" inputmode="numeric" value="20" /></div>
      <button class="btn btn--primary btn--block" id="doRestock">确认补货</button>
      <button class="btn btn--ghost btn--block mt8" id="cancelRestock">取消</button>
    `, (root) => {
      root.querySelector("#doRestock").onclick = () => {
        const n = parseInt(root.querySelector("#rAmount").value, 10) || 0;
        p.stock += n; save(); closeModal(); render(); toast(`已补货 ${n} 件`);
      };
      root.querySelector("#cancelRestock").onclick = closeModal;
    });
  }

  /* ---------- 设置 ---------- */
  function openSettings() {
    openModal("设置", `
      <div class="field"><label>店铺名称</label><input id="sName" value="${esc(state.shopName)}" /></div>
      <div class="field"><label>货币符号</label><input id="sCur" value="${esc(state.currency)}" maxlength="3" /></div>
      <button class="btn btn--primary btn--block" id="sSave">保存设置</button>
      <div class="divider"></div>
      <button class="btn btn--soft btn--block" id="sSeed">载入示例数据</button>
      <button class="btn btn--soft btn--block mt8" id="sExport">导出数据备份</button>
      <button class="btn btn--soft btn--block mt8" id="sImport">导入数据备份</button>
      <button class="btn btn--danger btn--block mt8" id="sClear">清空全部数据</button>
      <p class="muted mt12" style="font-size:12px;text-align:center">数据仅保存在本机浏览器中，添加到主屏幕后可离线使用。</p>
    `, (root) => {
      root.querySelector("#sSave").onclick = () => {
        state.shopName = root.querySelector("#sName").value.trim() || "面包工厂";
        state.currency = root.querySelector("#sCur").value.trim() || "¥";
        save(); closeModal(); render(); toast("设置已保存");
      };
      root.querySelector("#sSeed").onclick = () => {
        if (confirm("载入示例数据会覆盖现有产品和订单，确定？")) { seedDemo(); closeModal(); render(); toast("已载入示例数据"); }
      };
      root.querySelector("#sExport").onclick = () => {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `面包工厂备份-${todayKey()}.json`;
        a.click(); URL.revokeObjectURL(a.href); toast("已导出备份文件");
      };
      root.querySelector("#sImport").onclick = () => {
        const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/json";
        inp.onchange = () => {
          const f = inp.files[0]; if (!f) return;
          const r = new FileReader();
          r.onload = () => {
            try { state = sanitizeState(r.result); save(); closeModal(); render(); toast("导入成功"); }
            catch (e) { toast("文件格式错误"); }
          };
          r.readAsText(f);
        };
        inp.click();
      };
      root.querySelector("#sClear").onclick = () => {
        if (confirm("将清空所有产品、库存和订单，且不可恢复。确定？")) {
          state = defaultState(); save(); closeModal(); render(); toast("已清空");
        }
      };
    });
  }

  /* ---------- 路由与事件 ---------- */
  function render() {
    document.getElementById("shopName").textContent = state.shopName;
    document.getElementById("shopDate").textContent = new Date().toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" });
    const view = document.getElementById("view");
    const map = { dashboard: renderDashboard, pos: renderPOS, products: renderProducts, inventory: renderInventory, reports: renderReports };
    view.innerHTML = (map[activeTab] || renderDashboard)();

    // FAB（仅产品页）
    let fab = document.getElementById("fab");
    if (activeTab === "products") {
      if (!fab) { fab = document.createElement("button"); fab.id = "fab"; fab.className = "fab"; fab.textContent = "＋";
        fab.onclick = () => productForm(null); document.getElementById("app").appendChild(fab); }
    } else if (fab) fab.remove();

    document.querySelectorAll(".tabbar__item").forEach((b) =>
      b.classList.toggle("is-active", b.getAttribute("data-tab") === activeTab));
    renderCartBar();
    window.scrollTo(0, 0);
  }

  function go(tab) { activeTab = tab; render(); }

  document.addEventListener("click", (e) => {
    const t = e.target.closest("[data-tab],[data-go],[data-edit],[data-restock],[data-stock],[data-pos],[data-action]");
    if (!t) return;
    if (t.dataset.tab) return go(t.dataset.tab);
    if (t.dataset.go) return go(t.dataset.go);
    if (t.dataset.action === "add-product") return productForm(null);
    if (t.dataset.edit) return productForm(state.products.find((p) => p.id === t.dataset.edit));
    if (t.dataset.restock) return restockForm(t.dataset.restock);
    if (t.hasAttribute && t.dataset.stock) {
      const p = state.products.find((x) => x.id === t.dataset.stock);
      if (p) { p.stock = Math.max(0, p.stock + parseInt(t.dataset.delta, 10)); save(); render(); }
      return;
    }
    if (t.dataset.pos) { adjustCart(t.dataset.pos, 1); render(); return; }
  });

  document.getElementById("settingsBtn").addEventListener("click", openSettings);

  /* ---------- 启动 ---------- */
  if (!state.seeded && !state.products.length) seedDemo();
  render();

  // 注册 Service Worker（离线可用）
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", () => navigator.serviceWorker.register("./sw.js").catch(() => {}));
  }
})();
