/**
 * public/_worker.js
 * Cloudflare Pages Advanced Mode - Single Worker file
 *
 * File này xử lý TẤT CẢ requests:
 *   - POST /functions/send  → lưu tin nhắn vào KV
 *   - GET  /functions/get   → lấy tin nhắn từ KV
 *   - Tất cả còn lại        → serve static assets (index.html, dashboard.html, v.v.)
 *
 * Binding KV: MESSAGES_KV (cấu hình trong wrangler.toml hoặc Cloudflare Dashboard)
 */

// ---- Hàm tạo CORS headers dùng chung ----
function corsHeaders(contentType = "application/json") {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": contentType,
  };
}

// ---- Xử lý POST /functions/send: nhận tin nhắn và lưu vào KV ----
async function handleSend(request, env) {
  const headers = corsHeaders();

  try {
    // Bước 1: Parse JSON body từ request
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Body phải là định dạng JSON hợp lệ." }),
        { status: 400, headers }
      );
    }

    // Bước 2: Kiểm tra nội dung tin nhắn
    const content = (body.content || "").trim();

    if (!content) {
      return new Response(
        JSON.stringify({ success: false, error: "Nội dung tin nhắn không được để trống." }),
        { status: 400, headers }
      );
    }

    if (content.length > 200) {
      return new Response(
        JSON.stringify({ success: false, error: "Tin nhắn vượt quá 200 ký tự." }),
        { status: 400, headers }
      );
    }

    // Bước 3: Tạo key và lưu vào KV với TTL 24 giờ
    const timestamp = Date.now();
    const key = `msg_${timestamp}`;

    const messageData = {
      content: content,
      timestamp: timestamp,
      createdAt: new Date(timestamp).toISOString(),
    };

    await env.MESSAGES_KV.put(key, JSON.stringify(messageData), {
      expirationTtl: 86400, // Tự xóa sau 24 giờ
    });

    return new Response(
      JSON.stringify({ success: true, key: key }),
      { status: 201, headers }
    );

  } catch (error) {
    console.error("Lỗi handleSend:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Lỗi máy chủ nội bộ." }),
      { status: 500, headers }
    );
  }
}

// ---- Xử lý GET /functions/get: lấy toàn bộ tin nhắn từ KV ----
async function handleGet(request, env) {
  const headers = corsHeaders();

  try {
    // Bước 1: List tất cả keys có tiền tố "msg_"
    const listResult = await env.MESSAGES_KV.list({ prefix: "msg_" });
    const keys = listResult.keys;

    if (!keys || keys.length === 0) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    // Bước 2: Lấy giá trị song song, bỏ qua keys bị null
    const messagePromises = keys.map(async (keyObj) => {
      const rawValue = await env.MESSAGES_KV.get(keyObj.name);
      if (rawValue === null) return null;
      try {
        return JSON.parse(rawValue);
      } catch {
        return null;
      }
    });

    const rawMessages = await Promise.all(messagePromises);

    // Bước 3: Lọc null, sắp xếp mới nhất lên đầu
    const messages = rawMessages
      .filter((msg) => msg !== null)
      .sort((a, b) => b.timestamp - a.timestamp);

    return new Response(JSON.stringify(messages), { status: 200, headers });

  } catch (error) {
    console.error("Lỗi handleGet:", error);
    return new Response(
      JSON.stringify({ error: "Không thể lấy tin nhắn." }),
      { status: 500, headers }
    );
  }
}

// ---- Export default: Entry point của Worker ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname, method } = { pathname: url.pathname, method: request.method };

    // Xử lý CORS Preflight (OPTIONS) cho cả 2 endpoints
    if (method === "OPTIONS" &&
        (pathname === "/functions/send" || pathname === "/functions/get")) {
      return new Response(null, {
        status: 204,
        headers: corsHeaders(),
      });
    }

    // Route: POST /functions/send
    if (pathname === "/functions/send" && method === "POST") {
      return handleSend(request, env);
    }

    // Route: GET /functions/get
    if (pathname === "/functions/get" && method === "GET") {
      return handleGet(request, env);
    }

    // Tất cả routes còn lại: phục vụ static assets (index.html, dashboard.html, v.v.)
    // env.ASSETS là binding tự động của Cloudflare Pages cho static files
    return env.ASSETS.fetch(request);
  },
};
