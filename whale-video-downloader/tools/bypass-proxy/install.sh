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
Ly8gNDUxIOyasO2ajOyaqSBTT0NLUzUg7ZSE66Gd7IucICjtlZzqta0g67CWIOyEnOuyhOyXkOyE
nCDsi6TtlokpLiDtmZXsnqUg67iU656Z7KCE7JqpIOKGkiA0NTEg7Jqw7ZqMIOyXkCBgc29ja3M1
Oi8v7ISc67KE7KO87IaMOu2PrO2KuGAg66GcIOuEo+uKlOuLpC4KLy8gICBBTExPV19JUFM964K0
7KeR6rO17J24SVBbLElQLi4uXSBbUE9SVD0xMDgwXSBbSE9TVD0wLjAuMC4wXSBub2RlIHRvb2xz
L2J5cGFzcy1wcm94eS9zb2NrczUtcHJveHkubWpzCi8vICAtIO2ZleyepeydtCDtlITroZ3si5wg
66Gc6re47J247J2EIOuquyDtlZjrr4DroZwgJ+2XiOyaqSBJUCcg67Cp7IudOiBBTExPV19JUFMg
7JeQIOyXhuuKlCDso7zshozripQg67CU66GcIOuBiuuKlOuLpC4gQUxMT1dfSVBTIOqwgCDruYTr
qbQg7Iuc7J6R7ZWY7KeAIOyViuuKlOuLpCjsl7TrprAg7ZSE66Gd7IucIOuwqeyngCkuCi8vICAt
IENPTk5FQ1Qg66eMIOuwm+qzoCwg7ISc67KEIOyekOyLoMK37IKs7ISk66edKDEyNy4qLCAxMC4q
LCAxOTIuMTY4Liog65OxKeycvOuhnOydmCDsl7DqsrDsnYAg66eJ64qU64ukKEFMTE9XX1BSSVZB
VEVfREVTVD0xIOydtOuptCDtkoDrprwg4oCUIOyLnO2XmOyaqSkuCi8vICAtIOyZuOu2gCDtjKjt
gqTsp4Ag7JeG7J20IE5vZGUgMTgrIOunjCDsnojsnLzrqbQg65Cc64ukLgppbXBvcnQgbmV0IGZy
b20gJ25vZGU6bmV0JzsKaW1wb3J0IGRucyBmcm9tICdub2RlOmRucy9wcm9taXNlcyc7CmltcG9y
dCB7IHBhdGhUb0ZpbGVVUkwgfSBmcm9tICdub2RlOnVybCc7Cgpjb25zdCBSRVAgPSB7IG9rOiAw
LCBmYWlsOiAxLCBkZW5pZWQ6IDIsIHVucmVhY2g6IDMsIGhvc3Q6IDQsIHJlZnVzZWQ6IDUsIGNt
ZDogNywgYXR5cDogOCB9Owpjb25zdCBzdHJpcCA9IChpcCkgPT4gU3RyaW5nKGlwIHx8ICcnKS5y
ZXBsYWNlKC9eOjpmZmZmOi8sICcnKTsKCmV4cG9ydCBmdW5jdGlvbiBpc1ByaXZhdGUoaXApIHsK
ICBjb25zdCBhID0gc3RyaXAoaXApOwogIGlmIChuZXQuaXNJUHY0KGEpKSB7CiAgICBjb25zdCBb
cCwgcV0gPSBhLnNwbGl0KCcuJykubWFwKE51bWJlcik7CiAgICByZXR1cm4gcCA9PT0gMCB8fCBw
ID09PSAxMCB8fCBwID09PSAxMjcgfHwgKHAgPT09IDE2OSAmJiBxID09PSAyNTQpIHx8IChwID09
PSAxNzIgJiYgcSA+PSAxNiAmJiBxIDw9IDMxKSB8fCAocCA9PT0gMTkyICYmIHEgPT09IDE2OCkg
fHwgKHAgPT09IDEwMCAmJiBxID49IDY0ICYmIHEgPD0gMTI3KSB8fCBwID49IDIyNDsKICB9CiAg
Y29uc3QgbCA9IGEudG9Mb3dlckNhc2UoKTsKICByZXR1cm4gbCA9PT0gJzo6JyB8fCBsID09PSAn
OjoxJyB8fCBsLnN0YXJ0c1dpdGgoJ2ZjJykgfHwgbC5zdGFydHNXaXRoKCdmZCcpIHx8IGwuc3Rh
cnRzV2l0aCgnZmU4MCcpOwp9CgpleHBvcnQgZnVuY3Rpb24gY3JlYXRlUHJveHkoeyBhbGxvdywg
YWxsb3dQcml2YXRlID0gZmFsc2UsIGxvZyA9ICgpID0+IHt9LCBpZGxlTXMgPSAxMjAwMDAgfSkg
ewogIGNvbnN0IGFsbG93ZWQgPSBuZXcgU2V0KChhbGxvdyB8fCBbXSkubWFwKHN0cmlwKSk7CiAg
aWYgKCFhbGxvd2VkLnNpemUpIHRocm93IG5ldyBFcnJvcign7ZeI7JqpIElQKEFMTE9XX0lQUynq
sIAg67mE7Ja0IOyeiOyWtCDsi5zsnpHtlZjsp4Ag7JWK7Iq164uI64ukIOKAlCDslYTrrLTrgpgg
7JOw64qUIOyXtOumsCDtlITroZ3si5zqsIAg65Cp64uI64ukJyk7CiAgcmV0dXJuIG5ldC5jcmVh
dGVTZXJ2ZXIoKGMpID0+IHsKICAgIGNvbnN0IGZyb20gPSBzdHJpcChjLnJlbW90ZUFkZHJlc3Mp
OwogICAgYy5vbignZXJyb3InLCAoKSA9PiB7fSk7CiAgICBpZiAoIWFsbG93ZWQuaGFzKGZyb20p
KSB7CiAgICAgIGxvZyhg6rGw67aAOiDtl4jsmqkg66qp66Gd7JeQIOyXhuuKlCDso7zshowgJHtm
cm9tfWApOwogICAgICByZXR1cm4gYy5kZXN0cm95KCk7CiAgICB9CiAgICBjLnNldFRpbWVvdXQo
aWRsZU1zLCAoKSA9PiBjLmRlc3Ryb3koKSk7CiAgICBsZXQgYnVmID0gQnVmZmVyLmFsbG9jKDAp
OwogICAgbGV0IHN0YWdlID0gJ2hlbGxvJzsKICAgIGNvbnN0IHJlcGx5ID0gKHJlcCkgPT4gYy53
cml0ZShCdWZmZXIuZnJvbShbNSwgcmVwLCAwLCAxLCAwLCAwLCAwLCAwLCAwLCAwXSkpOwogICAg
Y29uc3Qgb25EYXRhID0gYXN5bmMgKGQpID0+IHsKICAgICAgYnVmID0gQnVmZmVyLmNvbmNhdChb
YnVmLCBkXSk7CiAgICAgIGlmIChzdGFnZSA9PT0gJ2hlbGxvJykgewogICAgICAgIGlmIChidWYu
bGVuZ3RoIDwgMikgcmV0dXJuOwogICAgICAgIGlmIChidWZbMF0gIT09IDUgfHwgYnVmLmxlbmd0
aCA8IDIgKyBidWZbMV0pIHJldHVybiBjLmRlc3Ryb3koKTsKICAgICAgICBjb25zdCBtZXRob2Rz
ID0gWy4uLmJ1Zi5zdWJhcnJheSgyLCAyICsgYnVmWzFdKV07CiAgICAgICAgYnVmID0gYnVmLnN1
YmFycmF5KDIgKyBidWZbMV0pOwogICAgICAgIGlmICghbWV0aG9kcy5pbmNsdWRlcygwKSkgewog
ICAgICAgICAgYy53cml0ZShCdWZmZXIuZnJvbShbNSwgMHhmZl0pKTsKICAgICAgICAgIHJldHVy
biBjLmRlc3Ryb3koKTsKICAgICAgICB9CiAgICAgICAgYy53cml0ZShCdWZmZXIuZnJvbShbNSwg
MF0pKTsKICAgICAgICBzdGFnZSA9ICdyZXEnOwogICAgICB9CiAgICAgIGlmIChzdGFnZSA9PT0g
J3JlcScpIHsKICAgICAgICBpZiAoYnVmLmxlbmd0aCA8IDUpIHJldHVybjsKICAgICAgICBpZiAo
YnVmWzBdICE9PSA1KSByZXR1cm4gYy5kZXN0cm95KCk7CiAgICAgICAgY29uc3QgYXR5cCA9IGJ1
ZlszXTsKICAgICAgICBsZXQgaG9zdDsKICAgICAgICBsZXQgZW5kOwogICAgICAgIGlmIChhdHlw
ID09PSAxKSB7CiAgICAgICAgICBpZiAoYnVmLmxlbmd0aCA8IDEwKSByZXR1cm47CiAgICAgICAg
ICBob3N0ID0gWy4uLmJ1Zi5zdWJhcnJheSg0LCA4KV0uam9pbignLicpOwogICAgICAgICAgZW5k
ID0gODsKICAgICAgICB9IGVsc2UgaWYgKGF0eXAgPT09IDMpIHsKICAgICAgICAgIGVuZCA9IDUg
KyBidWZbNF07CiAgICAgICAgICBpZiAoYnVmLmxlbmd0aCA8IGVuZCArIDIpIHJldHVybjsKICAg
ICAgICAgIGhvc3QgPSBidWYuc3ViYXJyYXkoNSwgZW5kKS50b1N0cmluZygndXRmOCcpOwogICAg
ICAgIH0gZWxzZSBpZiAoYXR5cCA9PT0gNCkgewogICAgICAgICAgaWYgKGJ1Zi5sZW5ndGggPCAy
MikgcmV0dXJuOwogICAgICAgICAgaG9zdCA9IEFycmF5LmZyb20oeyBsZW5ndGg6IDggfSwgKF8s
IGkpID0+IGJ1Zi5yZWFkVUludDE2QkUoNCArIGkgKiAyKS50b1N0cmluZygxNikpLmpvaW4oJzon
KTsKICAgICAgICAgIGVuZCA9IDIwOwogICAgICAgIH0gZWxzZSByZXR1cm4gKHJlcGx5KFJFUC5h
dHlwKSwgYy5lbmQoKSk7CiAgICAgICAgaWYgKGJ1ZlsxXSAhPT0gMSkgcmV0dXJuIChyZXBseShS
RVAuY21kKSwgYy5lbmQoKSk7CiAgICAgICAgY29uc3QgcG9ydCA9IGJ1Zi5yZWFkVUludDE2QkUo
ZW5kKTsKICAgICAgICBjb25zdCByZXN0ID0gYnVmLnN1YmFycmF5KGVuZCArIDIpOwogICAgICAg
IHN0YWdlID0gJ2Nvbm5lY3RpbmcnOwogICAgICAgIGMucmVtb3ZlTGlzdGVuZXIoJ2RhdGEnLCBv
bkRhdGEpOwogICAgICAgIGMucGF1c2UoKTsKICAgICAgICBsZXQgYWRkciA9IGhvc3Q7CiAgICAg
ICAgdHJ5IHsKICAgICAgICAgIGlmICghbmV0LmlzSVAoaG9zdCkpIGFkZHIgPSAoYXdhaXQgZG5z
Lmxvb2t1cChob3N0KSkuYWRkcmVzczsKICAgICAgICB9IGNhdGNoIHsKICAgICAgICAgIGxvZyhg
7J2066aEIOuquyDssL7snYw6ICR7aG9zdH1gKTsKICAgICAgICAgIHJldHVybiAocmVwbHkoUkVQ
Lmhvc3QpLCBjLmVuZCgpKTsKICAgICAgICB9CiAgICAgICAgaWYgKCFhbGxvd1ByaXZhdGUgJiYg
aXNQcml2YXRlKGFkZHIpKSB7CiAgICAgICAgICBsb2coYOunieydjDog7IKs7ISkwrfrgrTrtoAg
7KO87IaM66GcIOyXsOqysCDsi5zrj4QgJHtob3N0fSDihpIgJHthZGRyfWApOwogICAgICAgICAg
cmV0dXJuIChyZXBseShSRVAuZGVuaWVkKSwgYy5lbmQoKSk7CiAgICAgICAgfQogICAgICAgIGNv
bnN0IHVwID0gbmV0LmNvbm5lY3QoeyBob3N0OiBhZGRyLCBwb3J0IH0pOwogICAgICAgIHVwLnNl
dFRpbWVvdXQoaWRsZU1zLCAoKSA9PiB1cC5kZXN0cm95KCkpOwogICAgICAgIHVwLm9uKCdlcnJv
cicsIChlKSA9PiB7CiAgICAgICAgICBsb2coYOyXsOqysCDsi6TtjKggJHtob3N0fToke3BvcnR9
ICgke2UuY29kZSB8fCBlLm1lc3NhZ2V9KWApOwogICAgICAgICAgaWYgKCF1cC5jb25uZWN0aW5n
ICYmIHVwLmJ5dGVzV3JpdHRlbiArIHVwLmJ5dGVzUmVhZCA+IDApIHJldHVybiBjLmRlc3Ryb3ko
KTsKICAgICAgICAgIHJlcGx5KGUuY29kZSA9PT0gJ0VDT05OUkVGVVNFRCcgPyBSRVAucmVmdXNl
ZCA6IGUuY29kZSA9PT0gJ0VORVRVTlJFQUNIJyA/IFJFUC51bnJlYWNoIDogZS5jb2RlID09PSAn
RVRJTUVET1VUJyA/IFJFUC5ob3N0IDogUkVQLmZhaWwpOwogICAgICAgICAgYy5lbmQoKTsKICAg
ICAgICB9KTsKICAgICAgICB1cC5vbignY29ubmVjdCcsICgpID0+IHsKICAgICAgICAgIHJlcGx5
KFJFUC5vayk7CiAgICAgICAgICBpZiAocmVzdC5sZW5ndGgpIHVwLndyaXRlKHJlc3QpOwogICAg
ICAgICAgYy5waXBlKHVwKTsKICAgICAgICAgIHVwLnBpcGUoYyk7CiAgICAgICAgICBjLm9uKCdj
bG9zZScsICgpID0+IHVwLmRlc3Ryb3koKSk7CiAgICAgICAgICB1cC5vbignY2xvc2UnLCAoKSA9
PiBjLmRlc3Ryb3koKSk7CiAgICAgICAgICBjLnJlc3VtZSgpOwogICAgICAgIH0pOwogICAgICB9
CiAgICB9OwogICAgYy5vbignZGF0YScsIChkKSA9PiBvbkRhdGEoZCkuY2F0Y2goKCkgPT4gYy5k
ZXN0cm95KCkpKTsKICB9KTsKfQoKaWYgKGltcG9ydC5tZXRhLnVybCA9PT0gcGF0aFRvRmlsZVVS
TChwcm9jZXNzLmFyZ3ZbMV0gfHwgJycpLmhyZWYpIHsKICBjb25zdCBhbGxvdyA9IChwcm9jZXNz
LmVudi5BTExPV19JUFMgfHwgJycpLnNwbGl0KCcsJykubWFwKChzKSA9PiBzLnRyaW0oKSkuZmls
dGVyKEJvb2xlYW4pOwogIGNvbnN0IHBvcnQgPSBOdW1iZXIocHJvY2Vzcy5lbnYuUE9SVCB8fCAx
MDgwKTsKICBjb25zdCBiYWQgPSBhbGxvdy5maWx0ZXIoKGlwKSA9PiAhbmV0LmlzSVAoc3RyaXAo
aXApKSk7CiAgaWYgKCFhbGxvdy5sZW5ndGggfHwgYmFkLmxlbmd0aCB8fCAhKHBvcnQgPj0gMSAm
JiBwb3J0IDw9IDY1NTM1KSkgewogICAgY29uc29sZS5lcnJvcihg7ZSE66Gd7IucIOyLnOyekSDs
i6TtjKhcbuuLqOqzhDog7ISk7KCVIO2ZleyduFxu7JuQ7J24OiAkeyFhbGxvdy5sZW5ndGggPyAn
QUxMT1dfSVBTKO2XiOyaqe2VoCDrgrQg6rO17J24IElQKeqwgCDruYTslrQg7J6I7Iq164uI64uk
JyA6IGJhZC5sZW5ndGggPyBgSVAg7ZiV7Iud7J20IOyVhOuLmeuLiOuLpDogJHtiYWQuam9pbign
LCAnKX1gIDogYFBPUlQg6rCAIDF+NjU1MzUg6rCAIOyVhOuLmeuLiOuLpCAoJHtwcm9jZXNzLmVu
di5QT1JUfSlgfVxu7KGw7LmYOiDsp5HCt+yCrOustOyLpCBQQyDsl5DshJwgaHR0cHM6Ly9hcGku
aXBpZnkub3JnIOulvCDsl7TslrQg64KY7JioIOyjvOyGjOulvCDrhKPsnLzshLjsmpQuIOyYiCkg
QUxMT1dfSVBTPTIwMy4wLjExMy43IFBPUlQ9MTA4MCBub2RlIHRvb2xzL2J5cGFzcy1wcm94eS9z
b2NrczUtcHJveHkubWpzYCk7CiAgICBwcm9jZXNzLmV4aXQoMSk7CiAgfQogIGNvbnN0IHNydiA9
IGNyZWF0ZVByb3h5KHsgYWxsb3csIGFsbG93UHJpdmF0ZTogcHJvY2Vzcy5lbnYuQUxMT1dfUFJJ
VkFURV9ERVNUID09PSAnMScsIGxvZzogKG0pID0+IGNvbnNvbGUubG9nKGAke25ldyBEYXRlKCku
dG9JU09TdHJpbmcoKX0gJHttfWApIH0pOwogIHNydi5vbignZXJyb3InLCAoZSkgPT4gewogICAg
Y29uc29sZS5lcnJvcihg7ZSE66Gd7IucIOyLnOyekSDsi6TtjKhcbuuLqOqzhDog7Y+s7Yq4IOyX
tOq4sFxu7JuQ7J24OiAke2UuY29kZSA9PT0gJ0VBRERSSU5VU0UnID8gYCR7cG9ydH0g7Y+s7Yq4
66W8IOydtOuvuCDri6Trpbgg7ZSE66Gc6re4656o7J20IOyTsOqzoCDsnojsirXri4jri6RgIDog
ZS5jb2RlID09PSAnRUFDQ0VTJyA/IGAke3BvcnR9IO2PrO2KuOulvCDsl7Qg6raM7ZWc7J20IOyX
huyKteuLiOuLpGAgOiBlLm1lc3NhZ2V9XG7sobDsuZg6IFBPUlQ964uk66W467KI7Zi4IOuhnCDr
i6Tsi5wg7Iuk7ZaJ7ZWY7IS47JqULmApOwogICAgcHJvY2Vzcy5leGl0KDEpOwogIH0pOwogIHNy
di5saXN0ZW4ocG9ydCwgcHJvY2Vzcy5lbnYuSE9TVCB8fCAnMC4wLjAuMCcsICgpID0+IGNvbnNv
bGUubG9nKGBTT0NLUzUg7ZSE66Gd7IucIOy8nOynkDog7Y+s7Yq4ICR7cG9ydH0sIO2XiOyaqSBJ
UCAke2FsbG93LmpvaW4oJywgJyl9YCkpOwp9Cg==
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
