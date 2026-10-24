import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { normalizeHost, parseProxy, buildPac, planBypass } from '../../extension/black/black-bypass-core.js';

test('사이트 이름: 주소·호스트·www 모두 호스트로 정리', () => {
  assert.equal(normalizeHost('https://www.Example.com/a/b?x=1').host, 'example.com');
  assert.equal(normalizeHost('sub.example.co.kr').host, 'sub.example.co.kr');
});

test('사이트 이름(오류 경로): 빈 값·IP·localhost 는 단계·원인·조치', () => {
  for (const bad of ['', '   ', '10.0.0.1', 'localhost', 'http://']) {
    const r = normalizeHost(bad);
    assert.equal(r.error?.step, '사이트 이름 확인', bad);
    assert.ok(r.error.reason && r.error.action, bad);
  }
});

test('프록시 주소: 방식별 PAC 토큰', () => {
  assert.equal(parseProxy('socks5://203.0.113.5:1080').pac, 'SOCKS5 203.0.113.5:1080');
  assert.equal(parseProxy('http://p.example.com:8080/').pac, 'PROXY p.example.com:8080');
  assert.equal(parseProxy('https://p.example.com:443').pac, 'HTTPS p.example.com:443');
});

test('프록시 주소(오류 경로): 방식 없음·로그인 포함·포트 범위·미지원 방식', () => {
  assert.match(parseProxy('').error.reason, /입력하지 않았/);
  assert.match(parseProxy('1.2.3.4:1080').error.reason, /방식/);
  assert.match(parseProxy('socks5://u:p@1.2.3.4:1080').error.reason, /로그인/);
  assert.match(parseProxy('socks5://1.2.3.4:70000').error.reason, /주소:포트/);
  assert.match(parseProxy('ftp://1.2.3.4:21').error.reason, /지원하지 않/);
});

test('PAC: 목록 사이트와 하위 도메인만 프록시, 나머지는 직접', () => {
  const pac = buildPac(['example.com'], 'SOCKS5 1.2.3.4:1080');
  const run = (host) => vm.runInNewContext(`${pac};FindProxyForURL('https://${host}/','${host}')`, { dnsDomainIs: (h, d) => h.endsWith(d) });
  assert.equal(run('example.com'), 'SOCKS5 1.2.3.4:1080');
  assert.equal(run('cdn.example.com'), 'SOCKS5 1.2.3.4:1080');
  assert.equal(run('notexample.com'), 'DIRECT');
  assert.equal(run('example.com.evil.io'), 'DIRECT');
});

test('적용 계획: 꺼짐·사이트 없음·프록시 오류·정상', () => {
  assert.equal(planBypass({ on: false, hosts: ['a.com'], proxy: 'socks5://1.2.3.4:1' }).why, 'off');
  assert.equal(planBypass({ on: true, hosts: [], proxy: 'socks5://1.2.3.4:1' }).why, 'no-hosts');
  assert.equal(planBypass({ on: true, hosts: ['a.com'], proxy: 'x' }).why, 'bad-proxy');
  assert.equal(planBypass({ on: true, hosts: ['a.com'], proxy: 'socks5://1.2.3.4:1' }).apply, true);
});
