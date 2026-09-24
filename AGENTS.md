# MAIN 공통 규칙 진입점

작업 시작 시 [중앙 AGENTS](../AGENTS.md)를 먼저 읽고 필수 읽기 순서를 따릅니다. 현재 로컬 원본은 C:/Users/Administrator/Desktop/Main/AGENTS.md, 원격 기준은 hanarostore-wq/obsidian-main/main/AGENTS.md입니다. 중앙 체크아웃에 접근하지 못하면 그 이유와 필요한 최신 인계를 기록합니다. 아래 프로젝트 규칙도 함께 지킵니다. 공통 규칙 전문은 복제하지 않습니다.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 머니OS 절대 작업 규칙

- 모든 사용자 작업은 성공 결과뿐 아니라 실패 단계, 정확한 원인, 사용자가 취할 다음 조치를 포함한 명확한 오류 메시지를 제공해야 한다.
- 오류를 `실패`, `연결 오류`, `알 수 없는 오류`처럼 뭉뚱그려 표시하지 않는다. 브라우저 주입, 페이지 추출, API 저장, 공유저장소 조회, 삭제 등 실패한 단계를 메시지에 포함한다.
- 새 기능을 만들거나 수정할 때 정상 경로와 오류 경로를 함께 테스트한다.
