/**
 * public/_worker.js
 * Cloudflare Pages Advanced Mode - Single Worker file
 *
 * KV Architecture: Lưu TẤT CẢ tin nhắn vào 1 key duy nhất "all_messages"
 * → Tránh vấn đề KV list() eventual consistency (delay lên đến 60s)
 * → Chỉ cần 1 KV.get() để đọc, 1 KV.get() + 1 KV.put() để ghi
 */

// Key duy nhất chứa toàn bộ tin nhắn dưới dạng JSON array
const MESSAGES_KEY = "all_messages";
const MAX_MESSAGES = 100; // Giữ tối đa 100 tin nhắn gần nhất

// ---- CORS headers ----
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

// ---- POST /functions/send ----
async function handleSend(request, env) {
  const headers = corsHeaders();

  try {
    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(
        JSON.stringify({ success: false, error: "Body phải là JSON hợp lệ." }),
        { status: 400, headers }
      );
    }

    const content = (body.content || "").trim();

    if (!content) {
      return new Response(
        JSON.stringify({ success: false, error: "Nội dung không được để trống." }),
        { status: 400, headers }
      );
    }

    if (content.length > 200) {
      return new Response(
        JSON.stringify({ success: false, error: "Tin nhắn vượt quá 200 ký tự." }),
        { status: 400, headers }
      );
    }

    // Đọc danh sách tin nhắn hiện tại (1 KV.get())
    const existing = await env.MESSAGES_KV.get(MESSAGES_KEY, { type: "json" }) || [];

    // Thêm tin nhắn mới vào đầu danh sách
    const newMessage = {
      content,
      timestamp: Date.now(),
      createdAt: new Date().toISOString(),
    };

    const updated = [newMessage, ...existing].slice(0, MAX_MESSAGES);

    // Ghi lại (1 KV.put())
    await env.MESSAGES_KV.put(MESSAGES_KEY, JSON.stringify(updated), {
      expirationTtl: 86400, // Tự xóa sau 24 giờ
    });

    return new Response(
      JSON.stringify({ success: true }),
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

// ---- GET /functions/get ----
async function handleGet(request, env) {
  const headers = corsHeaders();

  try {
    // Chỉ 1 KV.get() duy nhất — không cần list()
    const messages = await env.MESSAGES_KV.get(MESSAGES_KEY, { type: "json" }) || [];
    return new Response(JSON.stringify(messages), { status: 200, headers });

  } catch (error) {
    console.error("Lỗi handleGet:", error);
    return new Response(
      JSON.stringify({ error: "Không thể lấy tin nhắn." }),
      { status: 500, headers }
    );
  }
}

// ---- POST /functions/clear ----
async function handleClear(request, env) {
  const headers = corsHeaders();
  try {
    // Ghi đè bằng mảng rỗng để xóa tất cả tin nhắn ngay lập tức
    await env.MESSAGES_KV.put(MESSAGES_KEY, JSON.stringify([]));
    return new Response(
      JSON.stringify({ success: true }),
      { status: 200, headers }
    );
  } catch (error) {
    console.error("Lỗi handleClear:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Lỗi khi xóa tin nhắn." }),
      { status: 500, headers }
    );
  }
}

// ---- Export default Worker ----
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const { pathname } = url;
    const method = request.method;

    // CORS preflight
    if (method === "OPTIONS" &&
        (pathname === "/functions/send" || pathname === "/functions/get" || pathname === "/functions/clear")) {
      return new Response(null, { status: 204, headers: corsHeaders() });
    }

    if (pathname === "/functions/send" && method === "POST") return handleSend(request, env);
    if (pathname === "/functions/get"  && method === "GET")  return handleGet(request, env);
    if (pathname === "/functions/clear" && method === "POST") return handleClear(request, env);

    // Static assets
    return env.ASSETS.fetch(request);
  },
};
