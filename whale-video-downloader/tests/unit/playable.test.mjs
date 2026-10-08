import { test } from 'node:test';
import assert from 'node:assert/strict';

// 서비스워커 파일은 chrome API 를 쓰므로 함수 본문만 확인용으로 다시 만든다(같은 규칙을 그대로 옮김)
const src = (await import('node:fs')).readFileSync(new URL('../../extension/background/service-worker.js', import.meta.url), 'utf8');
const body = /export function playableUrl\(req, desc\) \{([\s\S]*?)\n\}/.exec(src)[1];
const playableUrl = new Function('req', 'desc', body);

test('팟플레이어 주소: 유튜브는 영상 페이지, 하나짜리 파일·HLS 는 원본 주소', () => {
  assert.equal(playableUrl({ site: 'youtube', id: 'abcdefghijk' }, null), 'https://www.youtube.com/watch?v=abcdefghijk');
  assert.equal(playableUrl({ site: 'x' }, { type: 'file', url: 'https://video.twimg.com/a.mp4' }), 'https://video.twimg.com/a.mp4');
  assert.equal(playableUrl({ site: 'bluesky' }, { type: 'hls', url: 'https://video.bsky.app/watch/x/y/playlist.m3u8' }), 'https://video.bsky.app/watch/x/y/playlist.m3u8');
});

test('(오류 경로) 영상·음성이 나뉜 형식이나 blob 주소는 넘기지 않음', () => {
  assert.equal(playableUrl({ site: 'x' }, { type: 'merge', video: {}, audio: {} }), '');
  assert.equal(playableUrl({ site: 'x' }, { type: 'file', url: 'blob:https://x.com/1' }), '');
  assert.equal(playableUrl({ site: 'x' }, null), '');
});

test('팟플레이어 주소: 최고 화질이 영상·음성 나뉜 형식이면 예비 후보의 하나짜리 파일(인스타 등)', () => {
  const desc = { type: 'merge', video: { url: 'https://x/v.mp4' }, audio: { url: 'https://x/a.mp4' }, fallbacks: [{ type: 'merge' }, { type: 'file', url: 'https://scontent.cdninstagram.com/prog.mp4' }] };
  assert.equal(playableUrl({ site: 'instagram' }, desc), 'https://scontent.cdninstagram.com/prog.mp4');
});

test('(오류 경로) 쿠키·Referer 가 필요한 주소(틱톡 등)는 팟플레이어에 넘기지 않음 → 먼저 받아서 열기', () => {
  assert.equal(playableUrl({ site: 'tiktok' }, { type: 'file', url: 'https://v16-webapp-prime.tiktok.com/v.mp4', headers: { referer: 'https://www.tiktok.com/' } }), '');
  assert.equal(playableUrl({ site: 'x' }, { type: 'file', url: 'https://cdn.example.com/v.mp4', credentials: 'include' }), '');
});
