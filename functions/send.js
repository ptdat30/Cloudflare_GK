/**
 * Cloudflare Pages Function: /functions/send.js
 * Xử lý request POST để nhận tin nhắn từ Frontend và lưu vào Cloudflare KV.
 * Binding KV Namespace: MESSAGES_KV (cấu hình trong Cloudflare Dashboard)
 */

// Hàm tạo header CORS để cho phép Frontend gọi API từ các origin khác nhau
function buildCorsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json",
  };
}

// Hàm xử lý chính - Cloudflare Pages Functions export dạng object với method tương ứng
export async function onRequestPost(context) {
  const { request, env } = context;
  const headers = buildCorsHeaders();

  try {
    // Bước 1: Đọc và parse body JSON từ request của Frontend
    let body;
    try {
      body = await request.json();
    } catch {
      // Nếu body không phải JSON hợp lệ thì báo lỗi ngay
      return new Response(
        JSON.stringify({ success: false, error: "Body phải là định dạng JSON hợp lệ." }),
        { status: 400, headers }
      );
    }

    // Bước 2: Lấy nội dung tin nhắn và kiểm tra hợp lệ
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

    // Bước 3: Tạo key duy nhất dựa trên timestamp (đảm bảo sắp xếp đúng thứ tự thời gian)
    const timestamp = Date.now();
    const key = `msg_${timestamp}`;

    // Bước 4: Tạo object dữ liệu tin nhắn sẽ được lưu vào KV
    const messageData = {
      content: content,
      timestamp: timestamp,
      createdAt: new Date(timestamp).toISOString(),
    };

    // Bước 5: Lưu vào Cloudflare KV với TTL 24 giờ (86400 giây) để tự dọn dẹp
    await env.MESSAGES_KV.put(key, JSON.stringify(messageData), {
      expirationTtl: 86400, // Tin nhắn tự xóa sau 24 giờ
    });

    // Bước 6: Trả về phản hồi thành công
    return new Response(
      JSON.stringify({ success: true, key: key }),
      { status: 201, headers }
    );
  } catch (error) {
    // Xử lý lỗi không mong muốn từ KV hoặc các bước khác
    console.error("Lỗi trong send.js:", error);
    return new Response(
      JSON.stringify({ success: false, error: "Lỗi máy chủ nội bộ. Vui lòng thử lại." }),
      { status: 500, headers }
    );
  }
}

// Xử lý OPTIONS request cho CORS Preflight (trình duyệt gửi trước khi POST)
export async function onRequestOptions() {
  return new Response(null, {
    status: 204,
    headers: buildCorsHeaders(),
  });
}
