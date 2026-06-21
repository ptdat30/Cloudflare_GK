/**
 * Cloudflare Pages Function: /functions/get.js
 * Xử lý request GET để lấy toàn bộ tin nhắn từ Cloudflare KV và trả về cho Dashboard.
 * Binding KV Namespace: MESSAGES_KV (cấu hình trong Cloudflare Dashboard)
 */

// Hàm tạo header CORS để cho phép Dashboard gọi API từ các origin khác nhau
function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

// Hàm xử lý chính - Lấy toàn bộ tin nhắn từ KV
export async function onRequestGet(context) {
  const { env } = context;
  const headers = buildCorsHeaders();

  try {
    // Bước 1: Liệt kê tất cả các key trong KV có tiền tố "msg_"
    // Cloudflare KV list() trả về tối đa 1000 keys mỗi lần gọi
    const listResult = await env.MESSAGES_KV.list({ prefix: "msg_" });
    const keys = listResult.keys; // Mảng các object { name: "msg_timestamp", ... }

    // Nếu chưa có tin nhắn nào thì trả về mảng rỗng ngay
    if (!keys || keys.length === 0) {
      return new Response(JSON.stringify([]), { status: 200, headers });
    }

    // Bước 2: Lấy giá trị song song cho tất cả các key (dùng Promise.all để tối ưu tốc độ)
    const messagePromises = keys.map(async (keyObj) => {
      const rawValue = await env.MESSAGES_KV.get(keyObj.name);

      // Nếu key đã hết hạn hoặc bị xóa thì bỏ qua
      if (rawValue === null) return null;

      try {
        // Parse JSON và trả về object tin nhắn đầy đủ
        return JSON.parse(rawValue);
      } catch {
        // Nếu giá trị bị lỗi format thì bỏ qua để không làm crash dashboard
        return null;
      }
    });

    const rawMessages = await Promise.all(messagePromises);

    // Bước 3: Lọc bỏ các giá trị null, sắp xếp theo thời gian mới nhất lên đầu
    const messages = rawMessages
      .filter((msg) => msg !== null)
      .sort((a, b) => b.timestamp - a.timestamp); // Mới nhất lên đầu

    // Bước 4: Trả về mảng JSON cho Dashboard
    return new Response(JSON.stringify(messages), { status: 200, headers });
  } catch (error) {
    // Xử lý lỗi không mong muốn từ KV
    console.error("Lỗi trong get.js:", error);
    return new Response(
      JSON.stringify({ error: "Không thể lấy tin nhắn. Vui lòng thử lại." }),
      { status: 500, headers }
    );
  }
}

// Xử lý OPTIONS request cho CORS Preflight
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}
