/* Browser-visible product data only. No private page globals or hidden APIs. */
(function(root){
  'use strict';
  const clean=v=>String(v??'').replace(/\s+/g,' ').trim();
  const unique=xs=>[...new Set(xs)];
  function price(v){if(v===null||v===undefined||typeof v==='boolean')return null;const s=String(v).replace(/[^0-9.]/g,'');if(!s)return null;const n=Number(s);return Number.isFinite(n)&&n>=0?n:null}
  function stock(v){if(v===null||v===undefined||typeof v==='boolean'||!String(v).trim())return null;const n=Number(v);return Number.isInteger(n)&&n>=0?n:null}
  function availability(v){const s=String(v||'').toLowerCase();if(/outofstock|soldout|sold.out|discontinued/.test(s))return 'out_of_stock';if(/instock|limitedavailability/.test(s))return 'available';if(/preorder|backorder/.test(s))return 'preorder';return 'unknown'}
  function url(value,base){try{const u=new URL(typeof value==='object'?value?.url||value?.contentUrl:value,base);return u.protocol==='https:'&&!u.username&&!u.password?u.href:null}catch{return null}}
  function normalize(input){
    const images=[];for(const im of input.images||[]){const u=url(typeof im==='string'?im:im.url,input.url);if(!u||images.some(i=>i.url===u))continue;images.push({url:u,role:im.role||'product',source:im.source||'page',alt:clean(im.alt).slice(0,300)})}
    const groups=[];for(const g of input.option_groups||[]){const values=[];for(const v of g.values||[]){const label=clean(v.label);if(!label||values.some(x=>x.label===label))continue;values.push({...v,label,stock_quantity:stock(v.stock_quantity),availability:['available','out_of_stock','preorder'].includes(v.availability)?v.availability:'unknown'})}if(values.length)groups.push({name:clean(g.name)||'옵션',values,source:g.source||'page'})}
    const variants=[];for(const v of input.variants||[]){const attrs={};for(const [k,val]of Object.entries(v.attributes||{})){if(clean(val))attrs[clean(k)]=clean(val)}if(!Object.keys(attrs).length&&!v.source_variant_id)continue;const key=JSON.stringify(Object.entries(attrs).sort())+'|'+(v.source_variant_id||'');if(variants.some(x=>x.key===key))continue;variants.push({key,source_variant_id:clean(v.source_variant_id),attributes:attrs,price:price(v.price),stock_quantity:stock(v.stock_quantity),availability:['available','out_of_stock','preorder'].includes(v.availability)?v.availability:'unknown',source:v.source||'page'})}
    const warnings=[...(input.warnings||[])];if(!images.length)warnings.push('상품 이미지를 찾지 못했습니다');if(!groups.length&&!variants.length)warnings.push('옵션을 찾지 못했습니다 — 상품 상세의 옵션 영역을 펼친 뒤 다시 읽어 주세요');if(groups.length>1&&!variants.length)warnings.push('색상·사이즈 목록만 확인됨 — 조합별 구매 가능 여부는 아직 미확인');
    for(const v of [...groups.flatMap(g=>g.values),...variants])if(v.stock_quantity===0)v.availability='out_of_stock';
    const options=groups.length?groups.map(g=>g.name+': '+g.values.map(v=>v.label+(v.availability==='out_of_stock'?' (품절)':'')).join(', ')).join(' / '):variants.map(v=>Object.entries(v.attributes).map(([k,val])=>k+' '+val).join(' / ')+(v.availability==='out_of_stock'?' (품절)':'')).join(', ');
    return {...input,cost:price(input.cost)||0,images:images.slice(0,80),image_url:images[0]?.url||'',option_groups:groups,variants,options,warnings:unique(warnings),capture_version:'0.2',captured_at:new Date().toISOString()}
  }
  function extract(doc,loc){
    const base=loc.href,images=[],groups=[],variants=[],warnings=[];
    const meta=n=>doc.querySelector(`meta[property="${n}"],meta[name="${n}"]`)?.content||'';
    const type=(o,t)=>(Array.isArray(o?.['@type'])?o['@type']:[o?.['@type']]).includes(t);
    let product=null;
    function walk(o){if(!o||typeof o!=='object'||product)return;if(type(o,'Product')||type(o,'ProductGroup')){product=o;return}if(Array.isArray(o))o.forEach(walk);else if(o['@graph'])walk(o['@graph'])}
    for(const s of doc.querySelectorAll('script[type="application/ld+json"]'))try{walk(JSON.parse(s.textContent))}catch{}
    function imageList(value,source,role='product'){for(const v of (Array.isArray(value)?value:[value])){if(!v)continue;const u=url(v,base);if(u)images.push({url:u,source,role})}}
    function variant(v){const attrs={};if(v.color)attrs['색상']=v.color;if(v.size)attrs['사이즈']=typeof v.size==='object'?v.size.name:v.size;
      const offers=Array.isArray(v.offers)?v.offers:[v.offers||{}];for(const offer of offers){const quantity=stock(offer.inventoryLevel?.value);variants.push({attributes:attrs,source_variant_id:v.sku||offer.sku||'',price:offer.price,availability:quantity===0?'out_of_stock':availability(offer.availability),stock_quantity:quantity,source:'structured_data'})}
      imageList(v.image,'variant');
    }
    if(product){imageList(product.image,'structured_data');for(const v of (Array.isArray(product.hasVariant)?product.hasVariant:product.hasVariant?[product.hasVariant]:[]))variant(v);if(product.size||product.color)variant(product)}
    const offer=Array.isArray(product?.offers)?product.offers[0]:product?.offers||{};
    let name=clean(product?.name||meta('og:title'));const brand=clean(typeof product?.brand==='object'?product.brand.name:product?.brand);
    let cost=price(offer.price??meta('product:price:amount'));
    imageList(meta('og:image'),'open_graph');
    const shown=e=>!!(e&&e.getClientRects().length&&getComputedStyle(e).visibility!=='hidden');
    const inProduct=e=>!e.closest('header,nav,footer,[class*="recommend" i],[class*="related" i],[class*="recent" i],[class*="review" i]');
    function disabled(e){const parent=e.closest('li,label,[role="option"]');const desc=clean((e.className||'')+' '+(parent?.className||'')+' '+(e.getAttribute('aria-label')||'')+' '+(e.textContent||''));return !!(e.disabled||e.getAttribute('aria-disabled')==='true'||parent?.getAttribute('aria-disabled')==='true'||/(?:sold.?out|disabled|품절|재입고알림)/i.test(desc))}
    function val(e,label){const q=stock(e.getAttribute('data-stock')??e.getAttribute('data-stock-qty')??e.getAttribute('data-stock-quantity'));return {label:clean(label).replace(/\s*\(?품절\)?\s*$/,''),value:e.value||e.getAttribute('data-value')||e.getAttribute('data-size')||'',availability:disabled(e)||q===0?'out_of_stock':'available',stock_quantity:q,source:'option_control'}}
    function groupName(e){const ref=e.getAttribute('aria-labelledby');const label=ref?doc.getElementById(ref)?.textContent:'';const explicit=e.id?doc.querySelector(`label[for="${CSS.escape(e.id)}"]`)?.textContent:'';const context=e.closest('fieldset')?.querySelector('legend')?.textContent||e.closest('dl')?.querySelector('dt')?.textContent||'';const n=clean(label||explicit||e.getAttribute('aria-label')||context||e.name||e.id);return /size|사이즈|치수/i.test(n)?'사이즈':/color|colour|컬러|색상/i.test(n)?'색상':n||'옵션'}
    for(const select of doc.querySelectorAll('select')){
      if(!inProduct(select)||!shown(select))continue;const n=groupName(select);
      if(/배송|수량|정렬|sort|quantity|qty|country|검색/i.test(n))continue;
      const values=[...select.options].filter(o=>o.value&&!/선택\s*(하세요|해주세요)|선택해|select|choose|선택$/i.test(clean(o.text))).map(o=>val(o,o.text));
      if(values.length&&(n!=='옵션'||values.some(v=>/^\d{2,3}(\.5)?$/.test(v.label))))groups.push({name:n,values,source:'select'});
    }
    const radios=new Map();for(const e of doc.querySelectorAll('input[type="radio"]')){
      if(!inProduct(e))continue;const label=(e.id?doc.querySelector(`label[for="${CSS.escape(e.id)}"]`):null)||e.closest('label');
      if(!label||!shown(label))continue;const n=groupName(e);if(/배송|결제|delivery|payment/i.test(n))continue;
      const key=e.name||n;if(!radios.has(key))radios.set(key,{name:n,values:[],source:'radio'});radios.get(key).values.push(val(e,label.textContent));
    }groups.push(...radios.values());
    // Restrict button options to explicitly named size/color/option containers.
    const containers=[...doc.querySelectorAll('[class*="size" i],[id*="size" i],[class*="color" i],[class*="colour" i],[id*="color" i],[role="listbox"],[data-option-group]')].filter(e=>inProduct(e)&&!/guide|chart|info|recommend/i.test((e.className||'')+' '+e.id));
    const used=new Set();for(const container of containers){
      const desc=clean((container.className||'')+' '+container.id+' '+(container.getAttribute('aria-label')||'')+' '+(container.getAttribute('data-option-group')||''));
      const n=/color|colour|색상|컬러/i.test(desc)?'색상':/size|사이즈/i.test(desc)?'사이즈':groupName(container);
      const controls=[...container.querySelectorAll('button,a,label,[role="option"],[data-size],[data-color]')].filter(e=>shown(e)&&inProduct(e));
      const values=[];for(const e of controls){if(used.has(e)||controls.some(o=>o!==e&&e.contains(o)))continue;
        let label=clean(e.getAttribute('data-size')||e.getAttribute('data-color')||e.getAttribute('data-option-name')||e.textContent||e.getAttribute('aria-label')||e.title||e.querySelector('img')?.alt);
        if(!label||label.length>70||/가이드|선택|장바구니|구매|배송|리뷰|guide|chart/i.test(label))continue;
        if(n==='사이즈'&&!/^(?:\d{2,3}(?:\.5)?(?:\s*mm)?|[2-6]?[XSML]{1,4}|FREE|ONE\s*SIZE)(?:\s*\(?품절\)?)?$/i.test(label))continue;
        used.add(e);values.push(val(e,label));
      }if(values.length)groups.push({name:n,values,source:'option_buttons'});
    }
    const merged=[];for(const g of groups){let m=merged.find(x=>x.name===g.name);if(!m){m={...g,values:[]};merged.push(m)}for(const v of g.values){const prev=m.values.find(x=>x.label===v.label);if(!prev)m.values.push(v);else if(prev.availability!==v.availability){prev.availability='unknown';warnings.push(g.name+' '+v.label+'의 품절 표시가 일치하지 않습니다')}}}
    // Product-specific image regions; never sweep recommendations or navigation artwork.
    const imageRoots=[...doc.querySelectorAll('[class*="product" i][class*="image" i],[class*="prod" i][class*="visual" i],[class*="product" i][class*="visual" i],[class*="goods" i][class*="image" i],[class*="detail" i][class*="image" i],[id*="product" i],[class*="prd" i][class*="img" i],[class*="thumb" i],[class*="zoom" i]')].filter(inProduct);
    for(const root of imageRoots)for(const img of root.querySelectorAll('img')){
      if(!inProduct(img))continue;const w=Number(img.getAttribute('width')||img.naturalWidth||0),h=Number(img.getAttribute('height')||img.naturalHeight||0);if(w&&h&&Math.max(w,h)<100)continue;
      for(const value of [img.getAttribute('data-original'),img.getAttribute('data-src'),img.getAttribute('data-lazy-src'),img.getAttribute('data-zoom-image'),img.currentSrc,img.getAttribute('src')]){
        if(!value||/logo|icon|sprite|spinner|loading|placeholder|banner/i.test(value))continue;
        const u=url(value,base);if(u)images.push({url:u,source:'product_dom',role:/detail|description/i.test((root.className||'')+' '+root.id)?'detail':'product',alt:clean(img.alt)});
      }
      const srcset=img.getAttribute('srcset')||img.getAttribute('data-srcset')||'';
      if(srcset){const largest=srcset.split(',').map(x=>x.trim().split(/\s+/)).sort((a,b)=>parseFloat(b[1]||'1')-parseFloat(a[1]||'1'))[0];if(largest?.[0])imageList(largest[0],'srcset')}
    }
    if(!name)name=clean(doc.querySelector('h1')?.textContent||doc.title);
    const specs={};for(const x of (Array.isArray(product?.additionalProperty)?product.additionalProperty:[]))if(x.name&&x.value)specs[clean(x.name)]=clean(x.value);
    for(const row of doc.querySelectorAll('[class*="spec" i] tr,[class*="information" i] tr,[id*="spec" i] tr')){const cells=row.querySelectorAll('th,td');if(cells.length===2&&inProduct(row))specs[clean(cells[0].textContent)]=clean(cells[1].textContent)}
    const fact=v=>Array.isArray(v)?v.map(fact).filter(Boolean).join(' / '):typeof v==='object'?clean(v?.name||v?.value):clean(v);
    for(const [label,v] of [['소재',product?.material],['제조자',product?.manufacturer],['제조국',product?.countryOfOrigin],['색상',product?.color],['사이즈',product?.size],['브랜드',product?.brand]])if(fact(v)&&!specs[label])specs[label]=fact(v);
    const knownLabel=v=>['제조자및수입자','제조자수입자','취급시주의사항및세탁방법','세탁방법및취급시주의사항','취급시주의사항품질보증기준','취급주의사항','세탁및취급주의사항'].includes(clean(v).replace(/[^가-힣]/g,''))||/^(?:제품(?:의)?\s*)?(?:소재|주소재|재질|제조국|원산지|제조자(?:\s*\(수입자\))?|제조사|색상|컬러|치수|사이즈|브랜드|취급\s*시\s*주의사항|세탁방법(?:\s*및\s*취급\s*시\s*주의사항)?)$/.test(clean(v));
    for(const row of doc.querySelectorAll('tr')){
      const cells=row.querySelectorAll('th,td');
      if(inProduct(row)&&cells.length%2===0)for(let i=0;i<cells.length;i+=2){if(knownLabel(cells[i].textContent)){const k=clean(cells[i].textContent);if(!specs[k])specs[k]=clean(cells[i+1].textContent)}}
    }
    for(const dt of doc.querySelectorAll('dt')){
      const dd=dt.nextElementSibling;
      if(dd?.tagName==='DD'&&inProduct(dt)&&knownLabel(dt.textContent)){const k=clean(dt.textContent);if(!specs[k])specs[k]=clean(dd.textContent)}
    }
    const breadcrumb=[...doc.querySelectorAll('[itemtype*="BreadcrumbList"] [itemprop="name"],nav[aria-label="breadcrumb"] a,.breadcrumb a,.breadcrumbs a')].map(e=>clean(e.textContent)).filter(Boolean).join(' > ');
    const description=clean(product?.description||doc.querySelector('[itemprop="description"]')?.textContent||meta('og:description'));
    const pageText=doc.body?.innerText||'';
    if(!cost){
      const priceMatch=pageText.match(/(?:^|\s)(\d{1,3}(?:,\d{3})+|\d{4,7})\s*원/);
      if(priceMatch)cost=price(priceMatch[1]);
    }
    if(!merged.some(g=>/사이즈|size/i.test(g.name))){
      const sizeArea=pageText.match(/사이즈[\s\S]{0,700}?(?=추가 옵션|사은품|관련용품|총 결제금액|$)/i)?.[0]||'';
      const sizeValues=[...sizeArea.matchAll(/(?:^|\s)(2[0-9]{2}|3[0-1][0-9])(?:\s|$)/gm)].map((match)=>match[1]);
      const uniqueSizes=[...new Set(sizeValues)];
      if(uniqueSizes.length)merged.push({name:'사이즈',values:uniqueSizes.map((label)=>({label,value:label,availability:'available',stock_quantity:null,source:'visible_text'})),source:'visible_text'});
    }
    // A single offer without size/color evidence is retained as a single item only
    // when the structured Product declares its own SKU and stock availability.
    const single=!!product?.sku&&!merged.length&&!variants.length&&!product?.hasVariant&&availability(offer.availability)!=='unknown';
    if(single)variants.push({source_variant_id:product.sku,attributes:{},availability:availability(offer.availability),stock_quantity:stock(offer.inventoryLevel?.value),price:offer.price,source:'structured_single_sku'});
    return normalize({url:base,name,brand,category:fact(product?.category)||breadcrumb,cost:cost||0,description,specs,images,option_groups:merged,variants,warnings,structured:!!product?.name&&cost>0});
  }
  const api={normalize,extract,availability,stock};root.NojobExtractor=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
