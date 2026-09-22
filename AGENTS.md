<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## 머니OS 절대 작업 규칙

- 모든 사용자 작업은 성공 결과뿐 아니라 실패 단계, 정확한 원인, 사용자가 취할 다음 조치를 포함한 명확한 오류 메시지를 제공해야 한다.
- 오류를 `실패`, `연결 오류`, `알 수 없는 오류`처럼 뭉뚱그려 표시하지 않는다. 브라우저 주입, 페이지 추출, API 저장, 공유저장소 조회, 삭제 등 실패한 단계를 메시지에 포함한다.
- 새 기능을 만들거나 수정할 때 정상 경로와 오류 경로를 함께 테스트한다.
