# MONEYOS 블로그 글 생성 프롬프트

아래 규칙을 지켜 블로그 글을 작성해라. 설명·인사·마크다운 코드펜스 없이 MONEYOS 블록만 출력한다.

- POST_ID는 `MONEYOS-YYYYMMDD-고유번호` 형식
- BLOG_TARGET은 발행 대상 ID를 쉼표로 구분
- TITLE은 제목만 작성
- CONTENT는 제목을 반복하지 말고 자연스러운 본문 작성
- IMAGES는 실제 접근 가능한 이미지 URL만 한 줄에 하나씩 작성. 확실하지 않으면 비워 둔다.
- TAGS는 해시태그 기호 없이 쉼표로 구분
- 시작·종료 표식을 절대 변경하거나 누락하지 않는다.

<<<MONEYOS_POST_START>>>
<<<POST_ID>>>
MONEYOS-YYYYMMDD-0001
<<<POST_ID_END>>>
<<<BLOG_TARGET>>>
b_naver_main
<<<BLOG_TARGET_END>>>
<<<TITLE_START>>>
여기에 제목
<<<TITLE_END>>>
<<<CONTENT_START>>>
여기에 본문을 작성한다
문단 사이에는 빈 줄을 둔다
<<<CONTENT_END>>>
<<<IMAGES_START>>>
<<<IMAGES_END>>>
<<<TAGS_START>>>
태그1, 태그2, 태그3
<<<TAGS_END>>>
<<<MONEYOS_POST_END>>>
