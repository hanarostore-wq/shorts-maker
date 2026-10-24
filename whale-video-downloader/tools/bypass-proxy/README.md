# 451 우회용 프록시 (한국 밖 서버에 설치)

클라우드플레어가 "HTTP 451 법적 사유로 이용 불가"로 막는 사이트는, 접속이 **한국 안 서버**로 들어올 때만 막힙니다.
한국 밖(일본·미국 등) 서버를 거쳐 가면 열립니다. 이 폴더의 `socks5-proxy.mjs` 가 그 서버에서 돌리는 프록시입니다.

## 준비물
- 한국 밖 리눅스 서버(VPS) 1대 — 일본·싱가포르 등이 가깝고 빠릅니다. 가장 싼 사양으로 충분합니다.
- Node 18 이상 (`node -v` 로 확인)
- 내 PC 의 공인 IP — https://api.ipify.org 를 열면 나옵니다. (확장은 프록시 로그인을 지원하지 않아 **내 IP 만 허용**하는 방식입니다)

## 설치 (서버에서)
```bash
git clone https://github.com/hanarostore-wq/shorts-maker.git && cd shorts-maker/whale-video-downloader
ALLOW_IPS=내공인IP PORT=1080 node tools/bypass-proxy/socks5-proxy.mjs
```
`SOCKS5 프록시 켜짐: 포트 1080, 허용 IP …` 가 나오면 됩니다. 계속 켜 두려면:
```bash
sudo tee /etc/systemd/system/bypass-proxy.service >/dev/null <<UNIT
[Unit]
Description=451 bypass SOCKS5 proxy
After=network.target
[Service]
Environment=ALLOW_IPS=내공인IP
Environment=PORT=1080
WorkingDirectory=/경로/shorts-maker/whale-video-downloader
ExecStart=/usr/bin/node tools/bypass-proxy/socks5-proxy.mjs
Restart=always
[Install]
WantedBy=multi-user.target
UNIT
sudo systemctl enable --now bypass-proxy
```
서버 방화벽(클라우드 보안 그룹 포함)에서 1080 포트를 **내 공인 IP 에만** 열어 두세요.

## 확장에 넣기
팝업 → `블랙전용` → `451 우회` → 주소칸에 `socks5://서버IP:1080` → [저장] (권한 묻기에서 [허용]).
그 뒤로는 451 이 뜨는 사이트가 자동으로 우회됩니다. 사이트 옆 [시험]으로 확인할 수 있습니다.

## 안전
- `ALLOW_IPS` 가 비면 시작하지 않습니다(아무나 쓰는 열린 프록시 방지). 허용 목록에 없는 주소는 바로 끊습니다.
- 서버 자신·사설망(127.*, 10.*, 192.168.* 등)으로의 연결은 막습니다.
- 집 IP 가 바뀌면(유동 IP) 연결이 끊깁니다 → `ALLOW_IPS` 를 새 IP 로 고쳐 다시 시작하세요.
- 이 프록시를 거친 사이트의 접속 기록은 그 서버 업체에 남을 수 있습니다.

## 오류가 나면
| 증상 | 원인 | 조치 |
|---|---|---|
| 확장 [시험]에서 "12초 안에 응답하지 않았습니다" | 서버 방화벽이 포트를 막았거나 서버가 꺼져 있음 | 서버에서 프록시가 켜져 있는지, 1080 포트가 내 IP 에 열려 있는지 확인 |
| "프록시로 … 연결하지 못했습니다" | 내 공인 IP 가 바뀌어 허용 목록에 없음 | 서버 로그의 `거부: 허용 목록에 없는 주소` 를 보고 `ALLOW_IPS` 수정 |
| 프록시를 거쳤는데도 451 | 서버가 한국 안이거나 한국 쪽 클라우드플레어 서버로 연결됨 | 다른 나라(일본·미국) 서버로 바꾸기 |
