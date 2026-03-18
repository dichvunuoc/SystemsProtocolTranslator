#!/usr/bin/env bash

TARGET_HOST="${1:-8.8.8.8}"   # host/IP cần kiểm tra, mặc định 8.8.8.8
TARGET_PORT="${2:-}"          # port cần kiểm tra (optional)

echo "===== THÔNG TIN IP ====="
# IP nội bộ (Wi-Fi thường là en0)
LOCAL_IP=$(ipconfig getifaddr en0 2>/dev/null || echo "Không lấy được IP en0")
echo "IP nội bộ (en0): $LOCAL_IP"

# IP public
PUBLIC_IP=$(curl -s ifconfig.me || echo "Không lấy được IP public")
echo "IP public:        $PUBLIC_IP"

echo ""
echo "===== KIỂM TRA KẾT NỐI ====="
echo "Ping tới $TARGET_HOST ..."
ping -c 4 "$TARGET_HOST"

echo ""
echo "Ping tới google.com ..."
ping -c 4 google.com

# Nếu có truyền port thì kiểm tra luôn bằng nc
if [[ -n "$TARGET_PORT" ]]; then
  echo ""
  echo "===== KIỂM TRA PORT ====="
  echo "Kiểm tra kết nối $TARGET_HOST:$TARGET_PORT ..."
  nc -vz "$TARGET_HOST" "$TARGET_PORT"
fi

echo ""
echo "Hoàn tất."