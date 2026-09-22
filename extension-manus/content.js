// Runs only through user-triggered extension actions; no hidden site APIs.
(()=>{
  const clean=s=>String(s||'').replace(/\s+/g,' ').trim();
  const visible=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
  function allowed(){if(location.protocol!=='https:')throw Error('HTTPS 쇼핑몰에서 실행해 주세요');const txt=document.body.innerText.slice(0,8000);if(/verify you are human|checking your browser|비정상적인 접근|자동입력 방지|로봇이 아닙니다/i.test(txt))throw Error('사이트 확인 화면이 나타났어요 — 자동 작업을 중단합니다')}
  function canonical(){return NojobURL.source(location.href)}
  async function capture(){
    allowed();
    const url=canonical();
    const data=globalThis.NojobExtractor.extract(document,location);
    return {...data,url};
  }
  function links(){allowed();const found=[];for(const a of document.querySelectorAll('a[href]')){try{if(!visible(a))continue;const u=new URL(a.href);if(u.origin!==location.origin||a.closest('header,nav,footer'))continue;const likely=u.searchParams.has('prdtNo')||/\/(?:products?|goods|item|shop_view|detail)[\/._-]?/i.test(u.pathname)||[...u.searchParams.keys()].some(k=>/^(goodsNo|product_no|itemId|goods_code)$/i.test(k));if(likely)found.push(NojobURL.source(u.href))}catch{}}return [...new Set(found)]}
  async function cart(o){
    allowed();if(canonical()!==o.url)throw Error('준비 주문과 현재 상품 페이지가 다릅니다');
    if(!Number.isInteger(o.quantity)||o.quantity<1||o.quantity>100)throw Error('주문 수량을 확인해 주세요');
    const key='black-cart-attempt-'+o.id;if(sessionStorage.getItem(key))throw Error('이미 담기를 시도한 주문입니다. 실제 장바구니부터 확인해 주세요');
    const targets=Object.values(o.attributes||{}).map(clean);if(!targets.length){const d=globalThis.NojobExtractor.extract(document,location);const single=d.variants.length===1&&!Object.keys(d.variants[0].attributes).length&&d.variants[0].source_variant_id===o.source_variant_id;if(!single)targets.push(clean(o.option))}
    for(const target of targets){
      let choices=[...document.querySelectorAll('button,label,a,[role="option"]')].filter(e=>visible(e)&&clean(e.innerText)===target&&!e.disabled&&e.getAttribute('aria-disabled')!=='true'&&!/sold.?out|disabled/i.test(e.className||''));
      choices=choices.filter(e=>!choices.some(other=>other!==e&&e.contains(other)));
      const selects=[...document.querySelectorAll('select')].filter(visible).map(s=>({s,opts:[...s.options].filter(x=>clean(x.text)===target&&!x.disabled)})).filter(x=>x.opts.length===1);
      if(choices.length+selects.length!==1)throw Error('정확한 옵션을 식별하지 못했어요: '+target);
      if(selects.length){selects[0].s.value=selects[0].opts[0].value;selects[0].s.dispatchEvent(new Event('change',{bubbles:true}))}else choices[0].click();
      await new Promise(r=>setTimeout(r,700));allowed();if(canonical()!==o.url)throw Error('옵션 선택 중 상품 페이지가 바뀌었습니다');
    }
    const quantities=[...document.querySelectorAll('input[type="number"],input[name*="qty" i],input[name*="quantity" i]')].filter(visible);
    if(quantities.length>1||(!quantities.length&&o.quantity!==1))throw Error('수량 입력칸을 하나로 확인하지 못했어요');
    if(quantities.length){const q=quantities[0];if(q.disabled||q.readOnly||(q.max&&Number(q.max)<o.quantity))throw Error('구매 가능한 수량을 확인해 주세요');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(q,String(o.quantity));q.dispatchEvent(new Event('input',{bubbles:true}));q.dispatchEvent(new Event('change',{bubbles:true}));await new Promise(r=>setTimeout(r,400));if(Number(q.value)!==o.quantity)throw Error('수량 반영을 확인하지 못했어요')}
    const carts=[...document.querySelectorAll('button,a,[role="button"]')].filter(e=>visible(e)&&['장바구니','장바구니 담기'].includes(clean(e.innerText))&&!e.disabled);
    if(carts.length!==1)throw Error('장바구니 버튼이 불명확합니다. 직접 확인해 주세요');
    const data=globalThis.NojobExtractor.extract(document,location);if(!data.cost||!o.cost||data.cost>o.cost)throw Error('현재 매입가가 변경됐거나 확인되지 않았어요. 가격을 다시 확인해 주세요');
    sessionStorage.setItem(key,'attempted');carts[0].click();
    return {status:'cart_attempted',note:'장바구니 담기를 시도했습니다. 담긴 옵션·수량을 확인한 뒤 플로팅 버튼에서 배송지를 입력하고 직접 결제해 주세요'};
  }
  if(!window.__blackSourcingListener){window.__blackSourcingListener=true;chrome.runtime.onMessage.addListener((m,sender,reply)=>{if(sender.id!==chrome.runtime.id)return;Promise.resolve().then(()=>m.type==='capture'?capture():m.type==='links'?links():m.type==='pageImages'?[...document.images].map(i=>({url:i.currentSrc||i.src})):m.type==='cart'?cart(m.order):Promise.reject(Error('지원하지 않는 작업'))).then(data=>reply({ok:true,data})).catch(e=>reply({ok:false,error:e.message}));return true})}
})();
