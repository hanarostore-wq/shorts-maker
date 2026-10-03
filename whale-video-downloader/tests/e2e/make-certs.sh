#!/usr/bin/env bash
# 모의 사이트용 테스트 인증서 생성 (크롬은 --ignore-certificate-errors 로 띄우므로 시스템에 설치하지 않는다)
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p certs && cd certs
DOMAINS="youtube.com tiktok.com bsky.app bsky.social plc.directory instagram.com cdninstagram.com facebook.com xx.fbcdn.net fbcdn.net x.com twimg.com xiaohongshu.com xhscdn.com snapchat.com sc-cdn.net douyin.com douyinvod.com kuaishou.com kwaicdn.com bilibili.com bilivideo.com weibo.com video.weibocdn.com weibocdn.com pinterest.com pinimg.com naver.com pstatic.net vimeo.com vimeocdn.com akamaized.vimeocdn.com dailymotion.com dmcdn.net googlevideo.com example-videos.com doubleclick.net"
SAN=""; for d in $DOMAINS; do SAN="$SAN,DNS:$d,DNS:*.$d"; done; SAN=${SAN#,}
openssl req -x509 -newkey rsa:2048 -nodes -keyout ca.key -out ca.crt -days 3650 -subj "/CN=SMD Test CA" 2>/dev/null
openssl req -newkey rsa:2048 -nodes -keyout server.key -out server.csr -subj "/CN=smd-mock" 2>/dev/null
printf "subjectAltName=%s\nbasicConstraints=CA:FALSE\nkeyUsage=digitalSignature,keyEncipherment\nextendedKeyUsage=serverAuth\n" "$SAN" > ext.cnf
openssl x509 -req -in server.csr -CA ca.crt -CAkey ca.key -CAcreateserial -out server.crt -days 3650 -extfile ext.cnf 2>/dev/null
echo "테스트 인증서 생성 완료"
