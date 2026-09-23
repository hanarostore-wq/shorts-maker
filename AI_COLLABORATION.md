# 여러 AI가 이 저장소를 같이 작업하는 방법

이 저장소(`shorts-maker`)는 옵시디언 보관함(`Desktop\Main`) 안에 들어있고,
GitHub(`hanarostore-wq/shorts-maker`)로 관리됩니다. Claude, ChatGPT, Gemini,
Manus 등 여러 AI가 같은 저장소를 건드리게 되므로, 아래 규칙을 지켜주세요.

이 문서를 다른 AI 채팅창에 그대로 붙여넣으시면 됩니다.

## 이 프로젝트가 뭔가요

`운영본부 관제실` — 이커머스 운영 자동화 시스템입니다.

- `src/` — Next.js 관제실 (웹). 승인 대기함·업무 지시·정책 설정 화면.
- `desktop/` — Electron 데스크톱 브라우저. 관제실이 첫 탭으로 내장되어 있고,
  AI가 실제 쇼핑몰 화면을 보고 클릭해서 업무(발주확인 등)를 수행합니다.
- `extension/` — 상품 소싱용 크롬 확장프로그램.

먼저 읽을 것: `README.md`, `desktop/README.md`, `desktop/설치하기.md`.

## ⚠ 절대 건드리면 안 되는 부분

이 시스템의 핵심은 **되돌리기 어려운 동작(발주·결제·메시지 발송)이 전부
사람의 승인을 거치게 만든 안전장치**입니다. 아래를 우회하는 코드는 절대
작성하지 마세요.

- `src/lib/agent/policy.ts`, `src/lib/agent/store.ts`의 `gateAction` —
  모든 쓰기 동작은 반드시 이 함수를 통과해야 합니다.
- `desktop/agent/brain.js`의 `commit` 도구, `desktop/agent/browserAgent.js`의
  `isCommitControl` — AI가 확정 버튼을 누르기 전 관문을 강제하는 부분입니다.
- `desktop/settings.js` — API 키를 암호화해서 저장합니다. 평문 저장·로그
  출력 금지.

이해 안 되는 상태로 이 파일들을 고치지 마세요. 먼저 질문하세요.

## 브랜치 규칙

`main`은 검증된 것만 올라가는 안정 브랜치입니다. 항상 `main`에서 새로
브랜치를 따서 작업하고, 다른 AI의 미검증 브랜치 위에서 작업하지 마세요.

| AI | 브랜치 접두사 예시 |
| --- | --- |
| Claude | `claude/작업내용` |
| ChatGPT | `chatgpt/작업내용` |
| Gemini | `gemini/작업내용` |
| Manus | `manus/작업내용` |

```bash
git checkout main
git pull origin main
git checkout -b <접두사>/작업내용
# 작업...
git push -u origin <접두사>/작업내용
```

작업 끝나면 PR을 올리거나, 담당자(사용자)에게 브랜치 이름을 알려서
검토·병합을 요청하세요. 스스로 `main`에 바로 병합하지 마세요.

## 저장소 파일을 직접 못 읽고 쓰는 AI (웹챗 등)라면

로컬 파일이나 GitHub에 직접 접근할 수 없다면, 자동 동기화는 불가능합니다.
대신:

1. 담당자가 관련 파일 내용을 붙여넣어 질문합니다.
2. 답변(코드·설명)을 담당자가 받아서, 옵시디언 보관함 안의
   `AI 작업일지.md`에 "어떤 AI가 뭐라고 제안했는지" 기록합니다.
   (이 파일은 `shorts-maker` 폴더 **밖**, 보관함 루트에 둡니다 — git으로
   관리되지 않는 메모 용도입니다.)
3. 실제 반영은 저장소에 직접 접근 가능한 AI(Claude Code 등)가
   그 기록을 보고 적용·커밋합니다.

## 지금 상태

- 관제실·데스크톱 앱 골격, 승인 관문, AI 화면 판단 에이전트까지 구현되어
  Windows 설치파일로 빌드까지 됩니다 (`.github/workflows/build-desktop.yml`).
- 실제 Anthropic API 키를 넣고 돌려본 검증은 아직 안 된 상태입니다.
- 쿠팡·네이버 공식 API 연동은 제거했고, 발주·주문 처리는 AI가 화면을
  직접 보고 클릭하는 방식으로만 갑니다 (`desktop/agent/`).
