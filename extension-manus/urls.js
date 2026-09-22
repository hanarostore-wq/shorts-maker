(function(root){
 'use strict';
 function source(value,collection=false){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||u.port||!u.hostname.includes('.')||/^(?:\d+\.){3}\d+$/.test(u.hostname)||/\.(?:local|localhost|internal|test|invalid)$/.test(u.hostname))throw Error('공개 HTTPS 상품 페이지에서 실행해 주세요');
  if(!collection&&['abcmart.a-rt.com','m.abcmart.a-rt.com'].includes(u.hostname)){const id=u.searchParams.get('prdtNo');if(!/^\d+$/.test(id||''))throw Error('상품 상세페이지를 열어 주세요');return 'https://abcmart.a-rt.com/product/new?prdtNo='+id}
  for(const key of [...u.searchParams.keys()])if(/^utm_/i.test(key)||['NaPm','gclid','fbclid'].includes(key))u.searchParams.delete(key);
  u.hash='';if((!u.pathname||u.pathname==='/')&&!u.search)throw Error('상품 상세페이지를 열어 주세요');return u.href;
 }
 root.NojobURL={source};if(typeof module!=='undefined')module.exports=root.NojobURL;
})(globalThis);
