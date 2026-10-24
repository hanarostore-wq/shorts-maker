#!/usr/bin/env bash
# 451 우회 프록시 한 방 설치 (한국 밖 리눅스 서버에서 root 로 실행). 이 파일은 make-installer.mjs 가 만든 것이라 직접 고치지 않는다.
#   sudo bash install.sh [내공인IP[,IP2]] [포트]
#   - IP 를 안 주면 지금 SSH 로 들어온 내 주소(SSH_CLIENT)를 허용 IP 로 씁니다(집에서 SSH 로 접속했다면 그대로 맞음).
set -euo pipefail
fail() { printf '설치 실패\n단계: %s\n원인: %s\n조치: %s\n' "$1" "$2" "$3" >&2; exit 1; }

[ "$(id -u)" = 0 ] || fail "권한 확인" "root 가 아닙니다" "sudo bash install.sh 로 다시 실행하세요."
command -v systemctl >/dev/null || fail "환경 확인" "systemd 가 없는 서버입니다" "Ubuntu·Debian·Rocky 같은 systemd 리눅스에서 실행하세요."

ALLOW="${1:-${ALLOW_IPS:-}}"
if [ -z "$ALLOW" ] && [ -n "${SSH_CLIENT:-}" ]; then ALLOW="${SSH_CLIENT%% *}"; echo "허용 IP 를 SSH 접속 주소로 정했습니다: $ALLOW"; fi
[ -n "$ALLOW" ] || fail "허용 IP 확인" "허용할 내 공인 IP 가 없습니다" "집 PC 에서 https://api.ipify.org 를 열어 나온 주소를 넣으세요. 예) sudo bash install.sh 203.0.113.7"
PORT="${2:-${PORT:-1080}}"
case "$PORT" in ''|*[!0-9]*) fail "포트 확인" "포트 '$PORT' 는 숫자가 아닙니다" "예) sudo bash install.sh $ALLOW 1080";; esac
[ "$PORT" -ge 1 ] && [ "$PORT" -le 65535 ] || fail "포트 확인" "포트 $PORT 가 1~65535 가 아닙니다" "예) sudo bash install.sh $ALLOW 1080"

if ! command -v node >/dev/null || [ "$(node -p 'process.versions.node.split(".")[0]')" -lt 18 ]; then
  echo "Node.js 18 이상을 설치합니다…"
  if command -v apt-get >/dev/null; then
    apt-get update -qq && apt-get install -y -qq curl ca-certificates >/dev/null && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - >/dev/null && apt-get install -y -qq nodejs >/dev/null
  elif command -v dnf >/dev/null; then
    dnf install -y -q nodejs >/dev/null
  else
    fail "Node.js 설치" "apt/dnf 가 없는 서버입니다" "Node 18 이상을 직접 설치한 뒤 다시 실행하세요."
  fi
  command -v node >/dev/null || fail "Node.js 설치" "설치 뒤에도 node 를 찾지 못했습니다" "서버가 인터넷에 연결되어 있는지 확인하고 다시 실행하세요."
fi

mkdir -p /opt/bypass-proxy
base64 -d > /opt/bypass-proxy/socks5-proxy.mjs <<'B64'
__PROXY_B64__
B64
node --check /opt/bypass-proxy/socks5-proxy.mjs || fail "프록시 파일 확인" "설치된 프록시 파일이 손상되었습니다" "이 설치 파일을 다시 받아 실행하세요."

cat > /etc/systemd/system/bypass-proxy.service <<UNIT
[Unit]
Description=451 bypass SOCKS5 proxy
After=network.target
[Service]
Environment=ALLOW_IPS=$ALLOW
Environment=PORT=$PORT
ExecStart=$(command -v node) /opt/bypass-proxy/socks5-proxy.mjs
Restart=always
DynamicUser=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now bypass-proxy >/dev/null 2>&1 || fail "서비스 시작" "systemd 가 프록시를 시작하지 못했습니다" "journalctl -u bypass-proxy -n 30 로 이유를 확인하세요."
sleep 1
systemctl is-active --quiet bypass-proxy || fail "서비스 확인" "프록시가 켜지자마자 꺼졌습니다" "journalctl -u bypass-proxy -n 30 로 이유를 확인하세요. (포트 $PORT 를 다른 프로그램이 쓰는 경우가 많습니다)"

# 서버 안 방화벽(켜져 있을 때만): 내 IP 에게만 포트를 연다
IFS=',' read -ra IPS <<< "$ALLOW"
if command -v ufw >/dev/null && ufw status | grep -q "Status: active"; then
  for ip in "${IPS[@]}"; do ufw allow from "$ip" to any port "$PORT" proto tcp >/dev/null; done
  echo "ufw 방화벽에 허용 규칙을 넣었습니다."
fi

PUB="$(curl -fsS --max-time 5 https://api.ipify.org 2>/dev/null || echo '서버공인IP')"
echo
echo "설치 완료. 확장 팝업 → 블랙전용 → 451 우회 → 주소칸에 아래를 넣고 [저장]:"
echo "  socks5://$PUB:$PORT"
echo "※ 서버 업체의 보안 그룹·방화벽에서 TCP $PORT 를 내 IP($ALLOW)에게 열어야 합니다(업체 콘솔 설정)."
echo "※ 집 IP 가 바뀌면: sudo systemctl edit --full bypass-proxy 에서 ALLOW_IPS 를 고치고 sudo systemctl restart bypass-proxy"
