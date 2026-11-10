/* SK매직 견적자동화 관리자 WEB V1.7.4
   계산기 원본 데이터(월별 제품/계약/프로모션/이미지)를 읽고,
   견적 및 수기 수정은 별도로 관리합니다. 기존 CUCKOO API와 연결하지 않습니다. */
(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const SOURCE_URL = 'https://kiuja78.github.io/skmagic-product-info/data.js';
  const SOURCE_BASE = 'https://kiuja78.github.io/skmagic-product-info/';
  const PHOTO_CACHE_MANIFEST_URL = './assets/product-images.json';
  let imageCacheManifest={byUrl:{},byModel:{}};
  const exportPhotoCache=new Map();
  const photoCaptureErrors=[];
  const KEY='sk_quote_admin_v1', HISTORY_KEY='sk_quote_admin_history_v1',URL_KEY='sk_quote_admin_source_url_v1', MANAGER_KEY='sk_quote_admin_managers_v1', SUPPLIER_KEY='sk_quote_admin_supplier_v1';
  const keys=['variant','size','management','plan','visitCycleMonths','contractYears'];
  const labels={variant:'제품 / 필터',size:'사이즈',management:'관리방식',plan:'케어 / 요금제',visitCycleMonths:'점검주기',contractYears:'의무사용기간'};
  const customerAliases={
    신규:['신규단품','신규'],크로스:['크로스','크로스/재구독/우대','재구독/우대'],패키지:['패키지','크로스/재구독/우대','재구독/우대'],
    재구독:['재구독단품','재구독/우대','크로스/재구독/우대'],재구독패키지:['재구독패키지','재구독패키지/우대패키지'],
    우대:['재구독단품','재구독/우대','크로스/재구독/우대'],우대패키지:['재구독패키지','재구독패키지/우대패키지'],
    타사보상:['타사보상'],기본최종:['기본최종','기본 최종구독료']};
  const customerOrder=['신규','크로스','패키지','재구독','재구독패키지','우대','우대패키지','타사보상','기본최종'];
  const escapeHtml=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const won=n=>Number(n||0).toLocaleString('ko-KR')+'원';
  const toNum=n=>{let x=Number(String(n??'').replace(/[^\d.-]/g,''));return Number.isFinite(x)?x:0};
  const uniq=a=>[...new Set((a||[]).filter(v=>v!==undefined&&v!==null&&String(v)!==''))];
  const valText=(k,v)=>k==='contractYears'?`${v}년`:k==='visitCycleMonths'?(Number(v)===0?'무방문':`${v}개월`):k==='size'?({'SS':'슈퍼싱글(SS)','Q':'퀸(Q)','K':'킹(K)'}[v]||String(v)):String(v);
  const dateText=()=>{const now=new Date();return [now.getFullYear(),String(now.getMonth()+1).padStart(2,'0'),String(now.getDate()).padStart(2,'0')].join('-')};
  const same=(a,b)=>String(a??'')===String(b??'');
  let archive={},currentSnap=null,products=[],quotes=[],history=[],selection={},chosenPromoIndex=-1,sourceReady=false;
  let managers=[];
  const supplierDefaults={name:'SK인텔리스(주)',number:'104-86-48203',ceo:'안무인',address:'서울특별시 종로구 청계천로 85, 18층(관철동, 삼일빌딩)',type:'도소매',category:'전자, 전기제품'};
  let supplier={...supplierDefaults};
  let imageOverrides=new Map(),activeCanvas=null,toastTimer=null,saveTimer=null;
  let form={customer:'',recipientKind:'auto',recipientSuffix:'',date:dateText(),manager:'',phone:'',managerId:'',month:'',category:'전체',search:'',productId:'',customerType:'신규',quantity:1,special:false,specialAmount:'',specialMonths:'',promoIndex:'',manualPromoName:'',manualPromoMode:'text',manualPromoMonths:'',manualPromoPrice:'',manualPromoNote:'',showMonthly:true,showCommit:true,showImages:true,showDetails:true,note:''};
  function notify(text){const node=$('toast');node.textContent=text;node.classList.add('active');clearTimeout(toastTimer);toastTimer=setTimeout(()=>node.classList.remove('active'),3000)}
  function alertBanner(text){$('globalAlert').textContent=text;$('globalAlert').classList.toggle('visible',!!text)}
  function store(){clearTimeout(saveTimer);saveTimer=setTimeout(()=>{try{localStorage.setItem(KEY,JSON.stringify({form,quotes}));localStorage.setItem(MANAGER_KEY,JSON.stringify(managers));localStorage.setItem(SUPPLIER_KEY,JSON.stringify(supplier));$('draftState').textContent='이 브라우저에 저장됨'}catch(e){$('draftState').textContent='저장 실패 · 백업 필요';console.warn(e)}},180)}
  function restore(){try{const d=JSON.parse(localStorage.getItem(KEY)||'null');if(d){form={...form,...d.form};quotes=Array.isArray(d.quotes)?d.quotes:[];}history=JSON.parse(localStorage.getItem(HISTORY_KEY)||'[]');if(!Array.isArray(history))history=[];
      managers=JSON.parse(localStorage.getItem(MANAGER_KEY)||'[]');if(!Array.isArray(managers))managers=[];
      const storedSupplier=JSON.parse(localStorage.getItem(SUPPLIER_KEY)||'null');if(storedSupplier&&typeof storedSupplier==='object')supplier={...supplierDefaults,...storedSupplier};
    }catch(e){console.warn('임시저장 복원 실패',e)}}
  function saveHistoryStorage(){try{localStorage.setItem(HISTORY_KEY,JSON.stringify(history))}catch(e){notify('이력 저장공간이 부족합니다. 백업을 해주세요.')}}
  function monthKeys(){return Object.keys(archive).sort().reverse()}
  function getProduct(id){return products.find(p=>String(p.apiId)===String(id))}
  function currentProduct(){return getProduct(form.productId)}
  function selectedMonth(){return form.month||monthKeys()[0]||''}
  function rowsOf(p){return (currentSnap?.finalRates?.[String(p.apiId)]||[]).filter(r=>r&&typeof r==='object')}
  function priceOfRate(rate,t){if(!rate||!t||t==='특판')return null;const obj=rate.pricesByCustomer||{};if(selectedMonth()==='2026-11'&&(t==='우대'||t==='우대패키지')&&!Object.prototype.hasOwnProperty.call(obj,t))return null;
    for(const key of [...(customerAliases[t]||[]),t]){if(obj[key]!=null&&Number(obj[key])>0)return Number(obj[key]);}return null;}
  // Calculator's mallBase() uses management-specific beforePrice, with source-matrix
  // normal price taking priority for November mattress rows.
  function normalSubscriptionOf(product,rate,month){
    if(!product) return 0;
    if(product.category==='매트리스' && month==='2026-11' && toNum(rate?.sheetNormalPrice)>0)
      return toNum(rate.sheetNormalPrice);
    const p=product.prices||{};
    let source=0;
    if(rate?.management==='방문형') source=toNum(p.beforePriceVisit)||toNum(p.beforePrice);
    else if(rate?.management==='셀프형') source=toNum(p.beforePriceSelf)||toNum(p.beforePrice);
    else source=toNum(p.beforePrice);
    return source || toNum(rate?.sheetBasePrice)||0;
  }
  function normalizeImageUrl(raw){
    const value=typeof raw==='string'?raw.trim():'';
    if(!value||/^(?:javascript|file):/i.test(value))return '';
    if(/^data:image\/(?:png|jpe?g|webp);base64,/i.test(value))return value;
    if(/^blob:/i.test(value))return value;
    try{return new URL(value,SOURCE_BASE).href}catch(e){return ''}
  }
  function cachedImageCandidates(month,model,originalUrls){
    const byUrl=imageCacheManifest.byUrl||{};
    const byModel=imageCacheManifest.byModel||{};
    const fromModel=byModel[String(month||'')+'|'+String(model||'')]||byModel[String(model||'')]||[];
    const cached=[...(Array.isArray(fromModel)?fromModel:[])];
    for(const u of originalUrls||[])if(byUrl[u])cached.push(byUrl[u]);
    // The cached paths are served by this same GitHub Pages site, not the vendor's image server.
    return uniq(cached.filter(v=>typeof v==='string'&&/^assets\/product-photos\/[a-f0-9]{16,64}\.(?:png|jpg|jpeg|webp|gif)$/i.test(v))
      .map(v=>new URL(v,document.baseURI).href));
  }
  async function loadPhotoCacheManifest(){
    try{
      const response=await fetch(PHOTO_CACHE_MANIFEST_URL+'?v='+Date.now(),{cache:'no-cache'});
      if(!response.ok)throw new Error('사진 캐시 정보 없음');
      const data=await response.json();
      if(!data||typeof data!=='object'||typeof data.byUrl!=='object'||typeof data.byModel!=='object')throw new Error('사진 캐시 형식 오류');
      imageCacheManifest={byUrl:data.byUrl,byModel:data.byModel};
    }catch(e){imageCacheManifest={byUrl:{},byModel:{}};}
  }
  function productImageCandidates(p){
    if(!p)return [];
    const imgs=uniq([p.cover,...(Array.isArray(p.galleryImages)?p.galleryImages:[]),p.imageUrl,p.image,p.thumbnail,p.photo]
      .map(normalizeImageUrl).filter(Boolean));
    return uniq([...cachedImageCandidates(form.month,p.model,imgs),...imgs]);
  }
  function selectedImageUrl(p){if(!p)return '';
    return imageOverrides.get(form.month+'|'+p.model)||productImageCandidates(p)[0]||'';
  }
  function getQuoteImageCandidates(q){
    if(!q)return [];
    const month=q.month||form.month;
    const fromOverride=imageOverrides.get(month+'|'+q.model);
    const original=(archive[q.month]?.products||products).find(p=>String(p.apiId)===String(q.apiId))||getProduct(q.apiId);
    const originals=uniq([q.image,...(Array.isArray(q.gallery)?q.gallery:[]),
      original?.cover,...(Array.isArray(original?.galleryImages)?original.galleryImages:[]),
      original?.imageUrl,original?.image,original?.thumbnail,original?.photo].map(normalizeImageUrl).filter(Boolean));
    return uniq([fromOverride,...cachedImageCandidates(month,q.model,originals),...originals].map(normalizeImageUrl).filter(Boolean));
  }
  function imageMarkup(urls,alt,cssClass){
    const candidates=uniq((urls||[]).filter(Boolean));
    if(!candidates.length)return '<div class="image-missing">제품 사진 없음<small>설정에서 이미지 등록 가능</small></div>';
    return `<img class="${escapeHtml(cssClass||'')}" src="${escapeHtml(candidates[0])}" data-image-candidates="${escapeHtml(encodeURIComponent(JSON.stringify(candidates)))}" alt="${escapeHtml(alt||'제품 이미지')}" referrerpolicy="no-referrer">`;
  }
  function wireImageFallbacks(root){
    if(!root)return;
    root.querySelectorAll('img[data-image-candidates]').forEach(img=>{
      if(img.dataset.imageWired==='1')return;
      img.dataset.imageWired='1';
      let urls=[];try{urls=JSON.parse(decodeURIComponent(img.dataset.imageCandidates||'[]'))}catch(e){}
      let current=0;
      const next=()=>{
        current++;
        if(urls[current]){img.src=urls[current];return;}
        img.style.display='none';
        const holder=img.closest('.detail-photo,.peek-photo,.catalog-photo');
        if(holder&&!holder.querySelector('.image-missing'))holder.insertAdjacentHTML('beforeend','<div class="image-missing">사진을 불러올 수 없습니다<small>설정 → 이미지 직접 선택</small></div>');
      };
      img.addEventListener('error',next);
      if(img.complete&&img.naturalWidth===0)next();
    });
  }
  function eligibleCustomers(rate){return customerOrder.filter(t=>priceOfRate(rate,t)!==null)}
  function selectedRows(){const p=currentProduct();return p?rowsOf(p):[]}
  function effectiveConditions(){const rows=selectedRows();const selectionKeys=keys.filter(k=>rows.some(r=>r[k]!=null&&String(r[k])!==''));let subset=rows;for(const k of selectionKeys){const available=uniq(subset.map(r=>r[k]));if(!available.length)continue;if(!available.some(v=>same(v,selection[k]))){let pref=available[0];if(k==='size'&&available.includes('SS'))pref='SS';if(k==='management'&&available.includes('셀프형'))pref='셀프형';if(k==='contractYears'&&available.includes(6))pref=6;selection[k]=pref;}subset=subset.filter(r=>same(r[k],selection[k]));}
    return {keys:selectionKeys,row:subset[0]||null};}
  function findRow(){return effectiveConditions().row}
  function sourceStatus(message,type=''){const e=$('sourceState');e.className='status-pill '+type;e.innerHTML=`<span class="spinner"></span> ${escapeHtml(message)}`}
  function loadSource(){sourceReady=false;sourceStatus('계산기 데이터 연결 중');alertBanner('');
    const url=($('dataUrlInput').value||SOURCE_URL).trim();
    if(!/^https:\/\//i.test(url)){sourceStatus('연결 주소 확인 필요','fail');alertBanner('HTTPS 주소를 입력해주세요.');return;}
    try{localStorage.setItem(URL_KEY,url)}catch(e){}
    window.SK_MONTH_ARCHIVE=undefined;window.SK_DEFAULT_MONTH=undefined;
    const prev=document.getElementById('sourceCatalogScript');if(prev)prev.remove();const script=document.createElement('script');script.id='sourceCatalogScript';
    const timer=setTimeout(()=>{if(!sourceReady){sourceStatus('연결 시간 초과','fail');alertBanner('계산기 데이터를 불러오지 못했습니다. 원본 사이트 접속 상태와 네트워크를 확인해주세요.')}} ,18000);
    script.onload=()=>{clearTimeout(timer);archive=window.SK_MONTH_ARCHIVE||{};
      if(!Object.keys(archive).length){sourceStatus('원본 데이터 없음','fail');alertBanner('계산기 data.js에 월별 데이터가 없습니다. 원본 배포 파일을 확인해주세요.');return;}
      sourceReady=true;if(!archive[form.month])form.month=window.SK_DEFAULT_MONTH&&archive[window.SK_DEFAULT_MONTH]?window.SK_DEFAULT_MONTH:monthKeys()[0];
      activateMonth(true);sourceStatus(`${form.month.replace('-', '.')} · ${products.length}개 제품 연동`,'ready');$('syncDetails').textContent=`원본 연동 완료 · ${monthKeys().length}개 기준월 · 선택월 ${form.month} · 제품 ${products.length}개 · ${new Date().toLocaleString('ko-KR')}`;notify('SK매직 계산기 원본 데이터 연결 완료');};
    script.onerror=()=>{clearTimeout(timer);sourceStatus('원본 연결 실패','fail');alertBanner('계산기 data.js 파일을 가져올 수 없습니다. 인터넷 연결과 사이트 주소를 확인해주세요.')};
    script.src=url+(url.includes('?')?'&':'?')+'_v='+Date.now();document.head.appendChild(script);
  }
  function activateMonth(first=false){const snap=archive[form.month]||archive[monthKeys()[0]];if(!snap)return;currentSnap=snap;products=Array.isArray(snap.products)?snap.products:[];form.month=selectedMonth();
    const months=monthKeys();for(const id of ['monthSelect','catalogMonth']){$(id).innerHTML=months.map(m=>`<option value="${escapeHtml(m)}" ${m===form.month?'selected':''}>${escapeHtml(m.replace('-','.'))}</option>`).join('')}
    if(!products.some(p=>String(p.apiId)===String(form.productId))){form.productId='';selection={};}
    renderCategories();renderProducts();renderCatalog();renderItems();renderPaper();renderOverrideSelect();store();}
  function renderCategories(){const values=['전체',...uniq(products.map(p=>p.category))];$('categorySelect').innerHTML=values.map(c=>`<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');if(!values.includes(form.category))form.category='전체';$('categorySelect').value=form.category;}
  function visibleProducts(){const q=String(form.search||'').trim().toLowerCase();return products.filter(p=>(form.category==='전체'||p.category===form.category)&&(!q||`${p.model} ${p.title} ${p.spec||''} ${p.features||''}`.toLowerCase().includes(q)))}
  function renderProducts(){const list=visibleProducts();$('catalogCount').textContent=`${list.length}개 제품`;$('productSelect').innerHTML='<option value="">제품을 선택하세요</option>'+list.map(p=>`<option value="${escapeHtml(p.apiId)}">${escapeHtml(p.model||'')} · ${escapeHtml(p.title||'')}</option>`).join('');if(list.some(p=>String(p.apiId)===String(form.productId)))$('productSelect').value=String(form.productId);else{$('productSelect').value='';form.productId='';selection={};}
    renderChosenProduct();}
  function renderChosenProduct(){const p=currentProduct();const el=$('productPeek');if(!p){el.className='product-peek empty';el.textContent='제품을 선택하면 원본 사진과 상세정보가 표시됩니다.';$('selectedPrice').textContent='-';$('selectedSource').textContent='계약조건을 선택해주세요.';renderConditions();return;}
    const images=[selectedImageUrl(p),...productImageCandidates(p)];el.className='product-peek';el.innerHTML=`<div class="peek-photo">${imageMarkup(images,p.title||p.model,'peek-product-image')}</div><div class="peek-copy"><b>${escapeHtml(p.title||p.model)}</b><small>${escapeHtml(p.model)} · ${escapeHtml(p.category||'')}</small><p>${escapeHtml(String(p.spec||p.features||'').slice(0,130))}</p></div>`;wireImageFallbacks(el);renderConditions();}
  function renderConditions(){const rows=selectedRows(),{keys:visible,row}=effectiveConditions();let subset=rows;
    for(const k of keys){const wrap=$('wrap-'+k),select=$('cond-'+k),has=visible.includes(k);wrap.classList.toggle('visible',has);if(!has){select.innerHTML='';continue;}const available=uniq(subset.map(r=>r[k]));select.innerHTML=available.map(v=>`<option value="${escapeHtml(v)}">${escapeHtml(valText(k,v))}</option>`).join('');select.value=String(selection[k]);subset=subset.filter(r=>same(r[k],selection[k]));}
    renderCustomerTypes(row);renderPrice();renderPromos();}
  function renderCustomerTypes(row){const choices=eligibleCustomers(row);$('customerTypeSelect').innerHTML=choices.map(t=>`<option value="${escapeHtml(t)}">${escapeHtml(t==='기본최종'?'구독료':t)} · ${won(priceOfRate(row,t))}</option>`).join('');$('customerTypeSelect').insertAdjacentHTML('beforeend','<option value="특판">특판 · 금액 직접 입력</option>');
    if(row&&!choices.includes(form.customerType)&&form.customerType!=='특판')form.customerType=choices.includes('신규')?'신규':choices[0]||'특판';$('customerTypeSelect').value=form.customerType;}
  function renderPrice(){const p=currentProduct(),row=findRow(),t=form.customerType,price=priceOfRate(row,t);const isSpecial=!!form.special||t==='특판';$('specialToggle').checked=isSpecial;
    $('specialAmountBox').classList.toggle('hidden',!isSpecial);$('specialAmount').value=form.specialAmount;$('specialMonths').value=form.specialMonths||'';
    $('selectedPrice').textContent=isSpecial?(toNum(form.specialAmount)>0?won(toNum(form.specialAmount)):'가격 입력 필요'):(price!==null?won(price):'가격 미확인');
    $('selectedSource').textContent=isSpecial?'특판 · 직접 입력 가격':(price!==null?`${form.month.replace('-','.')} · ${t}`:'이 계약조건에는 확인된 구독료가 없습니다.');
    $('addBtn').disabled=!p||(!row&&!isSpecial)||(!isSpecial&&price===null)||(isSpecial&&(!toNum(form.specialAmount)||(!row&&!toNum(form.specialMonths))));
    if(p&&!row)$('selectedSource').textContent=isSpecial?'원본 조건이 없어 의무기간도 직접 입력해야 합니다.':'원본에 선택 가능한 계약별 요금표가 없습니다.';
  }
  function promoMatches(p,rate,customer){if(!rate)return false;
    if(p.promoSize&&!same(rate.size,p.promoSize))return false;
    if(p.promoPlan&&!same(rate.plan,p.promoPlan))return false;
    if(p.contractYears!=null&&!same(rate.contractYears,p.contractYears))return false;
    const m=String(p.managementType||'');if(m.includes('무방문')){if(rate.management&&rate.management!=='셀프형')return false;if(rate.visitCycleMonths!=null&&Number(rate.visitCycleMonths)!==0)return false;}
    else if(m.includes('Lite')){if(rate.plan&&String(rate.plan).toLowerCase()!=='lite')return false;if(!rate.plan&&rate.management)return false;}
    else if(m.includes('셀프')){if(rate.management&&rate.management!=='셀프형')return false;}
    else if(m.includes('방문')){if(rate.management&&rate.management!=='방문형')return false;}
    const cycle=m.match(/(\d+)개월/);if(cycle&&rate.visitCycleMonths!=null&&Number(cycle[1])!==Number(rate.visitCycleMonths))return false;
    if(/슈퍼싱글|\bSS\b/.test(String(p.note||''))&&rate.size&&rate.size!=='SS')return false;
    const t=String(p.customerType||'');
    if(t){const aliases={신규:['신규'],재구독:['재구독','우대'],타사보상:['타사보상'],패키지:['패키지','재구독패키지','우대패키지'], '크로스/재구독':['크로스','재구독']};const expected=aliases[t]||[t];if(!expected.includes(customer)&&customer!=='특판')return false;}
    const base=priceOfRate(rate,customer);if(p.basePriceInPromo&&base&&Number(p.basePriceInPromo)!==Number(base))return false;
    return true;
  }
  function matchPromos(){const p=currentProduct(),rate=findRow();if(!p||!rate||form.special||form.customerType==='특판')return [];
    const promoData=currentSnap?.promotions;const list=Array.isArray(promoData?.entries)?promoData.entries:(Array.isArray(promoData)?promoData:[]);return list.filter(pr=>(pr.apiIds||[]).some(id=>same(id,p.apiId))&&promoMatches(pr,rate,form.customerType));}
  // V1.7: 계산기 등록 프로모션이 없어도 제품별 수기 혜택을 생성할 수 있습니다.
  function renderManualPromoFields(){
    const active=form.promoIndex==='manual';
    const details=$('manualPromoDetails');
    if(details && details.open!==active)details.open=active;
    // 입력 필드는 항상 DOM에 남기고, 접기/펼치기는 브라우저 기본 details로 처리합니다.
    const mode=['text','half','amount'].includes(form.manualPromoMode)?form.manualPromoMode:'text';
    $('manualPromoMode').value=mode;
    $('manualPromoMonthsWrap').classList.toggle('hidden',mode==='text');
    $('manualPromoPriceWrap').classList.toggle('hidden',mode!=='amount');
    $('manualPromoGuide').textContent=mode==='text'
      ? '견적서에 혜택 문구만 표시하며 구독료와 의무기간 총액은 변동되지 않습니다.'
      : mode==='half'
        ? '선택한 견적구독료의 50%를 할인기간 월 구독료로 계산하고, 이후에는 원래 견적구독료가 적용됩니다.'
        : '할인기간 월 구독료를 직접 입력하며, 이후에는 기존 견적구독료가 적용됩니다.';
  }
  function renderPromos(){
    const matches=matchPromos();
    $('promoSelect').innerHTML='<option value="">적용 안 함</option>'
      +matches.map((p,i)=>`<option value="${i}">${escapeHtml(p.promoName||p.group||'프로모션')} · ${p.discountMonths?`${p.discountMonths}개월 ${won(p.promoPrice)}`:`월 ${won(p.promoPrice)}`}</option>`).join('')
      +'<option value="manual">✎ 수기 할인프로모션 · 혜택 직접 입력</option>';
    if(form.promoIndex!==''&&form.promoIndex!=='manual'&&!(Number(form.promoIndex)>=0&&Number(form.promoIndex)<matches.length))form.promoIndex='';
    $('promoSelect').value=form.promoIndex;
    $('promoHelp').textContent=matches.length
      ? `등록된 혜택 ${matches.length}개 · 목록에 없는 혜택도 수기로 입력 가능`
      : '계산기에 등록된 혜택이 없어도 수기 프로모션을 작성할 수 있습니다.';
    renderManualPromoFields();
  }
  function manualPromotion(name,mode,months,price,note,basePrice,termMonths){
    const title=String(name||'').trim();
    const extra=String(note||'').trim();
    if(!title){notify('수기 프로모션명을 입력해주세요.');return null;}
    if(!['text','half','amount'].includes(mode)){notify('혜택 적용 방식을 선택해주세요.');return null;}
    const amount=Number(basePrice)||0;
    let duration=0,intro=amount;
    if(mode!=='text'){
      if(String(months??'').trim()===''||!Number.isInteger(Number(months))||Number(months)<1||Number(months)>240){notify('할인 적용기간을 1~240개월로 입력해주세요.');return null;}
      duration=Number(months);
      if(Number.isFinite(Number(termMonths))&&termMonths>0&&duration>termMonths){notify('할인기간이 의무기간보다 길 수 없습니다.');return null;}
      if(mode==='half')intro=Math.round(amount/2);
      else {
        if(String(price??'').trim()===''||!/^(?:0|[1-9]\d*)$/.test(String(price).trim())){notify('할인기간 월 구독료를 0원 이상으로 입력해주세요.');return null;}
        intro=Number(price);
        if(intro>amount){notify('할인기간 금액은 견적구독료보다 클 수 없습니다.');return null;}
      }
    }
    return {name:title.slice(0,80),months:duration,intro,after:amount,note:extra.slice(0,160),source:'manual',mode,informational:mode==='text'};
  }
  function getPromoSnapshot(basePrice,termMonths){
    if(form.promoIndex==='')return null;
    if(form.promoIndex==='manual')return manualPromotion(form.manualPromoName,form.manualPromoMode,form.manualPromoMonths,form.manualPromoPrice,form.manualPromoNote,basePrice,termMonths);
    const p=matchPromos()[Number(form.promoIndex)];if(!p)return null;
    return {name:p.promoName||p.group||'할인프로모션',months:Number(p.discountMonths||0),intro:toNum(p.promoPrice),after:toNum(p.priceAfterDiscount||p.basePriceInPromo||0),note:String(p.note||''),customerType:p.customerType||'',source:p.promoSourceId||''};
  }
  function addItem(){const product=currentProduct(),rate=findRow();const special=form.special||form.customerType==='특판';if(!product||(!rate&&!special)){notify('제품과 계약조건을 먼저 선택해주세요.');return;}const amount=special?toNum(form.specialAmount):priceOfRate(rate,form.customerType);
    if(!(amount>0)){notify('선택한 조건의 가격이 확인되지 않았습니다. 특판 금액을 입력해주세요.');return;}
    const count=Math.max(1,Math.floor(Number(form.quantity||1)));const termMonths=toNum(form.specialMonths)>0&&special?Math.floor(toNum(form.specialMonths)):Number(rate?.contractYears||0)*12;if(!termMonths){notify('특판 의무기간을 개월 단위로 입력해주세요.');return;}
    const promotion=getPromoSnapshot(amount,termMonths);
    if(form.promoIndex==='manual'&&!promotion)return;
    // 수기 혜택은 견적구독료(프로모션 종료 후 금액)를 절대 덮어쓰지 않습니다.
    const afterPrice=promotion?.source==='manual'?amount
      :(promotion&&promotion.months>0&&promotion.after>0?promotion.after:(promotion&&promotion.months===0&&promotion.intro>0?promotion.intro:amount));
    const imageKey=form.month+'|'+product.model;
    const data={id:crypto.randomUUID?crypto.randomUUID():'q'+Date.now()+Math.random().toString(16).slice(2),month:form.month,apiId:product.apiId,model:product.model,title:product.title,category:product.category,image:productImageCandidates(product)[0]||'',imageKey,detailUrl:product.officialDetailUrl||'',spec:product.spec||'',features:product.features||'',gallery:productImageCandidates(product).slice(0,5),normalPrice:normalSubscriptionOf(product,rate,form.month),basePrice:afterPrice,monthly:afterPrice,qty:count,years:termMonths/12,months:termMonths,management:rate?.management||'',cycle:rate?.visitCycleMonths==null?'':valText('visitCycleMonths',rate.visitCycleMonths),size:rate?.size||'',plan:rate?.plan||'',variant:rate?.variant||'',customerType:special?'특판':form.customerType,special,promo:promotion,promoOn:!!promotion,promoMonthlyOverride:null};
    quotes.push(data);renderItems();renderPaper();store();notify(`${product.model} 견적에 추가했습니다.`);}
  function promoFirstMonthly(q){
    if(!q.promo||!q.promoOn||q.promo.informational)return Number(q.monthly)||0;
    if(q.promoMonthlyOverride!==null&&q.promoMonthlyOverride!==undefined)return Math.max(0,Number(q.promoMonthlyOverride));
    if(q.promo.source==='manual'&&q.promo.mode==='half')return Math.round((Number(q.monthly)||0)/2);
    if(q.promo.source==='manual'&&q.promo.mode==='amount')return Math.min(Number(q.monthly)||0,Math.max(0,Number(q.promo.intro)||0));
    const intro=q.promo.intro;
    return Math.max(0,(intro!==null&&intro!==undefined&&Number.isFinite(Number(intro)))?Number(intro):Math.round(q.monthly/2));
  }
  function promoAfterMonthly(q){return Number(q.monthly)||0;}
  function normalOfQuote(q){if(Object.prototype.hasOwnProperty.call(q,'normalPrice'))return toNum(q.normalPrice);
    const source=archive[q.month];const product=(source?.products||[]).find(p=>String(p.apiId)===String(q.apiId));
    const rates=source?.finalRates?.[String(q.apiId)]||[];
    const rate=rates.find(r=>Number(r.contractYears)*12===Number(q.months)&&String(r.management||'')===String(q.management||''))||rates.find(r=>String(r.management||'')===String(q.management||''))||rates[0]||null;
    return normalSubscriptionOf(product,rate,q.month)||0;}
  function normalDisplay(q){const n=normalOfQuote(q);return n>0?won(n):'—'}
  function totalFor(q){const months=Math.max(0,Number(q.months)||0),qty=Math.max(1,Number(q.qty)||1);if(!(q.promo&&q.promoOn)||q.promo.informational)return months*Number(q.monthly||0)*qty;const n=Math.min(months,Math.max(0,Number(q.promo.months)||0));if(!n)return Number(q.promo.intro||q.monthly)*months*qty;
    return (promoFirstMonthly(q)*n+promoAfterMonthly(q)*(months-n))*qty;}
  function renderItems(){const box=$('addedItems');$('itemCount').textContent=`${quotes.length}개`;
    if(!quotes.length){box.innerHTML='<div class="empty-message">추가된 제품이 없습니다.</div>';return;}
    box.innerHTML=quotes.map((q,i)=>`<div class="added-card" data-index="${i}"><div class="added-card-top"><div><b>${i+1}. ${escapeHtml(q.title||q.model)}</b><small>${escapeHtml(q.model)} · ${escapeHtml(q.month)} · ${escapeHtml(q.customerType)}</small></div><button class="remove-btn" data-remove="${i}">삭제</button></div><div class="added-grid"><label>견적구독료<input data-edit="monthly" type="number" min="0" value="${Number(q.monthly)||0}"></label><label>의무기간(개월)<input data-edit="months" type="number" min="0" value="${Number(q.months)||0}"></label><label>수량<input data-edit="qty" type="number" min="1" value="${Number(q.qty)||1}"></label></div><div class="added-grid added-grid-four"><label>정상구독료<input data-edit="normalPrice" type="number" min="0" value="${normalOfQuote(q)||0}"></label><label>관리방식<input data-edit="management" value="${escapeHtml(q.management)}"></label><label>점검주기<input data-edit="cycle" value="${escapeHtml(q.cycle)}"></label><label>구독유형<input data-edit="customerType" value="${escapeHtml(q.customerType)}"></label></div>${q.promo?`<label class="mini-promo"><span>${escapeHtml(q.promo.name)}${q.promo.months?` · ${q.promo.months}개월`:''}${q.promo.source==='manual'?' · 직접 입력':''}</span><span><input type="checkbox" data-edit="promoOn" ${q.promoOn?'checked':''}> 적용</span></label>`:''}
      <details class="quote-manual-promo-editor"><summary>✎ 프로모션 수기 추가 · 수정</summary>
        <label>혜택명<input data-qp-field="name" type="text" maxlength="80" value="${escapeHtml(q.promo?.source==='manual'?q.promo.name:'')}" placeholder="예: 3개월 반값 / 필터 무상교체"></label>
        <label>적용 방식<select data-qp-field="mode"><option value="text" ${q.promo?.mode==='text'||q.promo?.source!=='manual'?'selected':''}>혜택 안내만</option><option value="half" ${q.promo?.mode==='half'?'selected':''}>일정기간 반값</option><option value="amount" ${q.promo?.mode==='amount'?'selected':''}>일정기간 구독료 직접 입력</option></select></label>
        <div class="quote-manual-promo-fields"><label>기간(개월)<input data-qp-field="months" type="number" min="1" max="240" step="1" value="${q.promo?.source==='manual'&&q.promo.mode!=='text'?Number(q.promo.months)||'':''}" placeholder="예: 3"></label>
        <label>할인기간 월 구독료<input data-qp-field="price" type="number" min="0" step="1" value="${q.promo?.source==='manual'&&q.promo.mode==='amount'?Number(q.promo.intro):''}" placeholder="예: 0"></label></div>
        <label>추가 안내<input data-qp-field="note" maxlength="160" value="${escapeHtml(q.promo?.source==='manual'?q.promo.note||'':'')}" placeholder="선택 입력"></label>
        <div class="quote-manual-promo-actions"><button type="button" class="secondary-btn" data-qp-save="${i}">수기 혜택 적용</button><button type="button" class="secondary-btn" data-qp-clear="${i}">혜택 제외</button></div>
      </details>
      </div>`).join('');}
  function calculateTotals(){const normalMonthly=quotes.reduce((sum,q)=>sum+q.monthly*q.qty,0),firstMonthly=quotes.reduce((sum,q)=>sum+promoFirstMonthly(q)*q.qty,0),obligation=quotes.reduce((sum,q)=>sum+q.monthly*q.months*q.qty,0),actual=quotes.reduce((sum,q)=>sum+totalFor(q),0);return {normalMonthly,firstMonthly,obligation,actual,discount:Math.max(0,obligation-actual)};}
  function detailSpecParts(q){
    const spec=String(q.spec||'').replace(/\s*\n\s*/g,' / ').trim();
    const sourceProduct=(archive[q.month]?.products||products).find(p=>String(p.apiId)===String(q.apiId));
    const sourceFeatures=q.features||sourceProduct?.features||'';
    const features=Array.isArray(sourceFeatures)?sourceFeatures.join(' / '):String(sourceFeatures||'').trim();
    const segments=spec.split(/\s*\/\s*/).map(x=>x.trim()).filter(Boolean);
    const group={size:[],capacity:[],functions:[],features:[],color:[],management:[]};
    const put=(key,val)=>{const s=String(val||'').trim();if(s&&!group[key].includes(s))group[key].push(s)};
    segments.forEach(text=>{
      const match=text.match(/^([^:：]{2,18})\s*[:：]\s*(.+)$/),label=match?match[1].trim():'';
      const value=match?match[2]:text;
      if(/색상|컬러/.test(label)){put('color',value);return}
      if(/사이즈|치수|크기/.test(label)||(/mm/i.test(text)&&/\d\s*[×x*]\s*\d/i.test(text))){put('size',value);return}
      if(/저장량|보관량|제빙량|출수량|용량/.test(label)){put('capacity',value);return}
      if(/관리방식|방문주기|관리주기/.test(label)){put('management',value);return}
      if(/기능|냉수|온수|정수|얼음|살균|필터/.test(label)||/^(?:냉수|온수|정수|얼음|냉온정)/.test(text)){put('functions',value);return}
      put('features',value);
    });
    // Product.feature data is a separate source of genuine product selling points.
    features.split(/\s*\/\s*|\s*[·•]\s*|\s*\n\s*/).map(x=>x.trim()).filter(Boolean).forEach(x=>put('features',x));
    if(q.size)put('size',q.size);
    if(q.management)put('management',[q.management,q.cycle].filter(Boolean).join(' · '));
    return group;
  }
  // Original calculator descriptions often mix different attributes in one long sentence.
  // Group the real source phrases into compact, readable chips without altering product photographs.
  function readableDetailPhrases(items, maxItems=7){
    const phrases=[];
    for(const entry of items||[]){
      String(entry||'').split(/\s*(?:\n|[·•\/]|[✓✔])\s*/).forEach(chunk=>{
        let value=chunk.replace(/^\s*(?:제품특징|특징|기능|주요기능)\s*[:：]\s*/,'').trim();
        if(!value||/^[\d\s.,%]+$/.test(value))return;
        // Keep original wording. Only split on explicit separators from the catalog.
        if(value.length>76){
          const parts=value.split(/\s*,\s*(?=[^,]{5,})/);
          if(parts.length>1){parts.forEach(t=>{if(t.trim())phrases.push(t.trim())});return;}
        }
        phrases.push(value);
      });
    }
    const clean=uniq(phrases).filter(p=>p.length>1);
    return {items:clean.slice(0,maxItems), omitted:Math.max(0,clean.length-maxItems)};
  }
  function detailCardsHtml(items=quotes, layout='single'){
    if(!form.showDetails||!items.length)return '';
    const listClass=items.length>1?'detail-list two-up':'detail-list single';
    const blocks=items.map((q,relativeIndex)=>{
      const group=detailSpecParts(q), candidates=getQuoteImageCandidates(q);
      const sourceProduct=(archive[q.month]?.products||products).find(p=>String(p.apiId)===String(q.apiId));
      const name=String(q.title||sourceProduct?.title||q.model||'').trim();
      const model=String(q.model||sourceProduct?.model||'-').trim();
      const features=readableDetailPhrases(group.features, items.length>1?5:8);
      const mainFunctions=readableDetailPhrases(group.functions, items.length>1?3:5);
      const rows=[];
      function row(label,values){
        const text=Array.isArray(values)?uniq(values).join(' · '):String(values||'');
        if(text.trim())rows.push(`<div class="sk-spec"><span class="sk-spec-label">${escapeHtml(label)}</span><span class="sk-spec-value">${escapeHtml(text)}</span></div>`);
      }
      row('제품 사이즈',group.size);
      row('제품 용량',group.capacity);
      row('주요 기능',mainFunctions.items);
      if(!rows.length) row('관리 조건',[q.management,q.cycle].filter(Boolean));
      const featureHtml=features.items.length?`<div class="sk-feature-section"><div class="sk-feature-label">제품 특징</div><div class="sk-feature-items">${features.items.map(t=>`<span class="sk-feature-item">${escapeHtml(t)}</span>`).join('')}${features.omitted?`<span class="sk-feature-more">외 ${features.omitted}개 특징</span>`:''}</div></div>`:'';
      return `<section class="detail-card sk-detail-card" data-detail-model="${escapeHtml(model)}">
        <div class="detail-card-head"><b>${escapeHtml(name)}</b><span>${escapeHtml(model)}</span></div>
        <div class="detail-card-body sk-detail-body">
          <div class="detail-photo sk-detail-photo">${form.showImages?imageMarkup(candidates,name||model,'original-product-image'):'<div class="detail-photo-fallback">사진 표시 끔</div>'}</div>
          <div class="detail-copy sk-detail-copy">${rows.join('')}${featureHtml}</div>
        </div>
      </section>`;
    });
    return `<div class="paper-section-title detail-heading"><span>제품 상세정보</span></div><div class="${listClass} sk-detail-list">${blocks.join('')}</div>`;
  }
  function paperRow(q,i){
    const months=Math.max(0,Number(q.months)||0),normal=normalOfQuote(q);
    const after=Number(q.monthly)||0;
    const saving=normal>0?Math.max(0,normal-after):null;
    const promotion=q.promo&&q.promoOn;
    const intro=promoFirstMonthly(q);
    return `<tr class="main-row">
      <td class="model-name"><b>${escapeHtml(q.model)}</b></td>
      <td><span class="p-editable" contenteditable="true" spellcheck="false" data-paper-edit="months" data-index="${i}" title="의무기간 수정">${months}</span>개월</td>
      <td><span class="p-editable" contenteditable="true" spellcheck="false" data-paper-edit="management" data-index="${i}" title="관리방식 수정">${escapeHtml(q.management||'-')}</span>${q.cycle?`<small class="cycle-value p-editable" contenteditable="true" spellcheck="false" data-paper-edit="cycle" data-index="${i}" title="점검주기 수정">${escapeHtml(q.cycle)}</small>`:''}</td>
      <td>${escapeHtml(q.install||'면제')}</td>
      <td class="money-normal"><span class="p-editable monetary" contenteditable="true" spellcheck="false" data-paper-edit="normalPrice" data-index="${i}" title="정상구독료 직접 수정">${normal>0?won(normal):'—'}</span></td>
      <td class="money-discount"><span class="p-editable monetary" contenteditable="true" spellcheck="false" data-paper-edit="discountPrice" data-index="${i}" title="할인구독료 직접 수정">${saving!==null?won(saving):'—'}</span></td>
      <td class="money-final"><b><span class="p-editable monetary" contenteditable="true" spellcheck="false" data-paper-edit="monthly" data-index="${i}" title="반값 종료 후 견적구독료 수정">${won(after)}</span></b></td>
    </tr>
    ${promotion?`<tr class="promo-row"><td colspan="7"><div class="promo-ribbon"><span class="promo-tag">${q.promo.informational?'추가 혜택':'할인프로모션'}</span><span class="promo-name">${escapeHtml(q.promo.name)}</span>${q.promo.informational?'':q.promo.months?`<span class="promo-term">${q.promo.months}개월간</span><span class="promo-amount">월 <b class="p-editable monetary" contenteditable="true" spellcheck="false" data-paper-edit="promoMonthlyOverride" data-index="${i}">${won(intro)}</b></span>`:''}${q.promo.informational?'':`<span class="promo-after">종료 후 월 <strong>${won(after)}</strong></span>`}${q.promo.note?`<span class="promo-additional-note">${escapeHtml(q.promo.note)}</span>`:''}</div></td></tr>`:''}`;
  }
  function fitPaperContent(){
    const paper=$('paper');if(!paper)return;
    const first=paper.querySelector('.first-page');
    const second=paper.querySelector('.details-page');
    // 제품이 세 개 이상이면 1장에 두 제품의 상세내용을 우선 보존합니다.
    // 요약표가 공간을 차지하는 경우에는 2장의 맨 위로 자동 이동합니다.
    if(first && second && quotes.length>=3){
      const body=first.querySelector('.paper-main-content');
      const available=first.clientHeight - 34 - 78 - 47 - 19 - 8;
      if(body && body.scrollHeight > available*1.05){
        const move=[...body.querySelectorAll(':scope > .monthly-summary, :scope > .commit-summary')];
        if(move.length){
          const nextBody=second.querySelector('.paper-main-content');
          const head=nextBody?.querySelector('.continuation-header');
          if(nextBody){
            const wrap=document.createElement('div');
            wrap.className='summary-on-following-page';
            wrap.innerHTML='<div class="paper-section-title"><span>구독료 요약</span></div>';
            move.forEach(n=>wrap.appendChild(n));
            if(head)head.insertAdjacentElement('afterend',wrap);else nextBody.prepend(wrap);
          }
        }
      }
    }
    paper.querySelectorAll('.paper-page').forEach(pg=>{
      const body=pg.querySelector('.paper-main-content');if(!body)return;
      body.style.zoom='1';
      const style=getComputedStyle(pg);
      const padTop=parseFloat(style.paddingTop)||0;
      const padBottom=parseFloat(style.paddingBottom)||0;
      // V1.6: footer is absolutely positioned *inside* the reserved bottom area.
      // Do not subtract both bottom padding and footer height again (it forced
      // unnecessary 20% font downscaling even when ample page space remained).
      const footer=pg.querySelector('.paper-footer');
      const footerBottom=footer ? (parseFloat(getComputedStyle(footer).bottom)||0) : 0;
      const footerSpace=footer ? footer.offsetHeight+footerBottom+10 : padBottom+8;
      const available=pg.clientHeight-padTop-footerSpace;
      const content=body.scrollHeight;
      if (content>available && available>0) {
        // 너무 작은 글씨가 되지 않도록 적정 범위만 축소합니다.
        body.style.zoom=String(Math.max(.76, Math.min(1, (available-8)/content)));
      }
      pg.classList.toggle('page-overflow-risk',content>available/.76);
    });
  }
  function updatePreviewScale(){
    const paper=$('paper'), host=paper?.closest('.preview-column');if(!paper||!host)return;
    paper.style.zoom=String(Math.min(1,Math.max(.45,(host.clientWidth-2)/794)));
  }
  // 수신인 호칭: 법인/단체 표시가 있는 고객명만 자동으로 '귀중' 처리합니다.
  // 자동 판별이 어려운 이름은 작성자가 받는 분 구분을 직접 바꿀 수 있습니다.
  const organizationNamePattern = /(?:주식회사|\(주\)|㈜|법인|재단|사단|협회|조합|연합회|위원회|공단|공사|관공서|시청|구청|군청|동사무소|행정복지센터|학교|대학교|대학|학원|어린이집|유치원|병원|의원|교회|성당|사찰|센터|기관|단체|총국|지국|본부|\b(?:inc\.?|corp\.?|ltd\.?|llc)\b)/i;
  function effectiveRecipientKind() {
    if(form.recipientKind==='organization'||form.recipientKind==='individual')return form.recipientKind;
    return organizationNamePattern.test(String(form.customer||''))?'organization':'individual';
  }
  function effectiveRecipientSuffix(){
    const manuallyEdited=String(form.recipientSuffix||'').trim();
    return manuallyEdited || (effectiveRecipientKind()==='organization'?'귀중':'귀하');
  }
  function syncRecipientSuffixInput(){
    const suffixInput=$('recipientSuffix');
    if(suffixInput && document.activeElement!==suffixInput) suffixInput.value=effectiveRecipientSuffix();
  }
  function recipientNameText(){
    let name=String(form.customer||'').trim().replace(/\s+(귀하|귀중)$/,'').trim();
    if(!name)name='고객님';
    return name;
  }
  function recipientDisplayText(){
    return `${recipientNameText()} ${effectiveRecipientSuffix()}`;
  }
  function renderPaper(){
    const paper=$('paper'),t=calculateTotals();
    const company=supplier;
    const recipientName=recipientNameText();
    const recipientSuffix=effectiveRecipientSuffix();
    const headerHtml = `
      <div class="p-top">
        <div class="p-heading-left"><div class="p-header-main"><div class="p-logo-crop"><img src="./assets/skmagic_logo_fitted.png" alt="SK magic 정식 로고"></div><span class="p-logo-divider"></span><h1>구독 견적서</h1></div></div>
        <div class="p-top-date">견적 작성일 <b>${escapeHtml(form.date||dateText())}</b></div>
      </div>
      <div class="p-intro-grid">
        <div class="p-recipient"><h2><span class="p-recipient-person">${escapeHtml(recipientName)}</span> <span class="p-recipient-suffix p-editable" contenteditable="true" role="textbox" aria-label="받는 분 호칭 직접 수정" spellcheck="false" data-recipient-preview-edit="suffix" title="클릭하여 귀하·귀중 등 직접 수정">${escapeHtml(recipientSuffix)}</span></h2><p>아래와 같이 견적합니다.<br>본 견적은 발행월 기준입니다.</p></div>
        <div class="p-business-box"><div class="biz-row"><b>사업자등록번호</b><span title="${escapeHtml(company.number||'-')}">${escapeHtml(company.number||'-')}</span><b>대표이사</b><span title="${escapeHtml(company.ceo||'-')}">${escapeHtml(company.ceo||'-')}</span></div><div class="biz-row full"><b>상호</b><span title="${escapeHtml(company.name||'-')}">${escapeHtml(company.name||'-')}</span></div><div class="biz-row full"><b>주소</b><span title="${escapeHtml(company.address||'-')}">${escapeHtml(company.address||'-')}</span></div><div class="biz-row"><b>업태</b><span title="${escapeHtml(company.type||'-')}">${escapeHtml(company.type||'-')}</span><b>종목</b><span title="${escapeHtml(company.category||'-')}">${escapeHtml(company.category||'-')}</span></div><div class="biz-row manager"><b>담당자</b><span title="${escapeHtml(form.manager||'-')}">${escapeHtml(form.manager||'-')}</span><b>연락처</b><span title="${escapeHtml(form.phone||'-')}">${escapeHtml(form.phone||'-')}</span></div></div>
      </div>`;
    const tableHtml = quotes.length?`<div class="quote-table-section"><table class="paper-table quote-prices"><colgroup><col style="width:16%"><col style="width:11%"><col style="width:17%"><col style="width:12%"><col style="width:14%"><col style="width:14%"><col style="width:16%"></colgroup><thead><tr><th>모델명</th><th>의무기간</th><th>점검조건</th><th>등록·설치비</th><th>정상구독료</th><th>할인구독료</th><th>견적구독료</th></tr></thead><tbody>${quotes.map(paperRow).join('')}</tbody></table></div>`:'<div class="empty-paper">왼쪽에서 제품과 계약조건을 선택해<br>견적에 추가해주세요.</div>';
    const monthlyHtml = quotes.length&&form.showMonthly?`<div class="monthly-summary"><div class="paper-section-title"><span>수량별 월 총 구독료</span></div><table class="paper-table qty-summary"><thead><tr><th>모델명</th><th>수량</th><th>월 구독료</th><th>월 합계</th></tr></thead><tbody>${quotes.map(q=>`<tr><td>${escapeHtml(q.model)}</td><td>${q.qty}대</td><td>${won(q.monthly)}</td><td>${won(q.monthly*q.qty)}</td></tr>`).join('')}<tr class="total-row"><td colspan="3">월 총 구독료 (프로모션 종료 후)</td><td>${won(t.normalMonthly)}</td></tr></tbody></table></div>`:'';
    const commitHtml = quotes.length&&form.showCommit?`<div class="commit-summary"><div class="commit-card"><small>의무기간 기준 총 구독료</small><b>${won(t.obligation)}</b></div><div class="commit-card accent"><small>프로모션 반영 예상 총액</small><b>${won(t.actual)}</b></div></div>`:'';
    // V1.6: 프로모션·혜택 등 특이사항을 견적표 바로 아래에서 강조합니다.
    // 문구를 임의로 가공하지 않고 입력 내용 그대로 표시합니다.
    const hasBenefitNote = /혜택|할인|무상|무료|면제|지원|교체|증정|반값|특가/.test(String(form.note||''));
    const noteHtml = String(form.note||'').trim()
      ? `<section class="paper-benefit-note" aria-label="혜택 및 특이사항">
          <span class="note-label">${hasBenefitNote?'혜택 · 특이사항':'특이사항'}</span>
          <div class="note-copy">${escapeHtml(String(form.note).trim())}</div>
        </section>` : '';
    const footerHtml = `<div class="paper-footer"><span>본 견적은 발행월 기준이며 프로모션 및 재고 상황에 따라 변경될 수 있습니다.</span><strong>문의 | ${escapeHtml(form.manager||'담당자')} ${escapeHtml(form.phone||'')}</strong></div>`;

    // 견적 금액 표는 1장에 모아서 보여주되, 상세정보는 1장부터 2개씩 배치합니다.
    // 3번째 제품부터 2장, 5번째부터 3장으로 넘어갑니다.
    const totalPages = form.showDetails ? Math.max(1, Math.ceil(quotes.length / 2)) : 1;
    const pageNumber = (n) => totalPages > 1 ? `<div class="paper-page-number" aria-label="${n}페이지 / 총 ${totalPages}페이지">${n} / ${totalPages}</div>` : '';
    const compactDetails = (items, onFirst) => form.showDetails && items.length
      ? `<div class="details-wrap ${onFirst?'first-details':'continued-details'}">${detailCardsHtml(items, items.length===1?'single':'two')}</div>` : '';
    const firstDetails = compactDetails(quotes.slice(0,2), true);
    const firstPage = `<div class="paper-page first-page"><div class="paper-main-content">${headerHtml}${tableHtml}${noteHtml}${monthlyHtml}${commitHtml}${firstDetails}</div>${footerHtml}${pageNumber(1)}</div>`;
    const continuations = [];
    if (form.showDetails && quotes.length > 2) {
      let pageNo=2;
      for(let k=2;k<quotes.length;k+=2){
        const group=quotes.slice(k,k+2);
        continuations.push(`<div class="paper-page details-page"><div class="paper-main-content"><div class="continuation-header"><img src="./assets/skmagic_logo_fitted.png" alt="SK magic"><div><b>제품 상세정보</b><span>구독 견적서 · 제품 ${k+1}${group.length>1?`–${k+group.length}`:''}</span></div></div>${compactDetails(group,false)}</div>${footerHtml}${pageNumber(pageNo)}</div>`);
        pageNo++;
      }
    }
    paper.innerHTML = firstPage+continuations.join('');
    wireImageFallbacks(paper);
    requestAnimationFrame(() => { fitPaperContent(); updatePreviewScale(); });
  }

  /* V1.3.1: restore catalog, manager, supplier and history helpers removed by V1.3 template refactor */
  function renderCatalog(){const q=($('catalogSearch').value||'').trim().toLowerCase();$('catalogMonth').value=form.month;
    const filtered=products.filter(p=>!q||`${p.title} ${p.model}`.toLowerCase().includes(q));$('catalogGrid').innerHTML=filtered.slice(0,150).map(p=>{const rows=rowsOf(p);const rate=rows.map(r=>Object.values(r.pricesByCustomer||{})).flat().map(Number).filter(n=>n>0);const range=rate.length?`${won(Math.min(...rate))}${Math.max(...rate)!==Math.min(...rate)?' ~ '+won(Math.max(...rate)):''}`:'가격 미확인';return `<article class="catalog-card">${imageMarkup([selectedImageUrl(p),...productImageCandidates(p)],p.title,'catalog-product-image')}<b>${escapeHtml(p.title||p.model)}</b><small>${escapeHtml(p.category)} · ${escapeHtml(p.model)}<br>조건 ${rows.length}개 · ${range}</small><button data-catalog-pick="${escapeHtml(p.apiId)}">이 모델로 견적 작성</button></article>`;}).join('')||'<div class="empty-message">해당 제품이 없습니다.</div>';wireImageFallbacks($('catalogGrid'));}
  function renderOverrideSelect(){$('imageOverrideModel').innerHTML=products.map(p=>`<option value="${escapeHtml(p.model)}">${escapeHtml(p.model)} · ${escapeHtml(p.title)}</option>`).join('');}
  const newId=()=>window.crypto&&crypto.randomUUID?crypto.randomUUID():'mgr_'+Date.now()+'_'+Math.random().toString(36).slice(2,9);
  const managerFullName=m=>[m?.name||'',m?.role||''].filter(Boolean).join(' ').trim();
  function renderManagerSelect(){const select=$('savedManagerSelect');if(!select)return;
    const previous=form.managerId||'';
    select.innerHTML='<option value="">직접 입력</option>'+managers.map(m=>`<option value="${escapeHtml(m.id)}">${escapeHtml(managerFullName(m))} · ${escapeHtml(m.phone)}</option>`).join('');
    select.value=managers.some(m=>m.id===previous)?previous:'';
  }
  function renderManagerList(){const box=$('managerList');if(!box)return;
    $('managerCount').textContent=`${managers.length}명`;
    box.innerHTML=managers.length?managers.map(m=>`<div class="manager-entry"><div><b>${escapeHtml(managerFullName(m))}</b><span>${escapeHtml(m.phone)}</span></div><div class="manager-entry-actions"><button data-manager-use="${escapeHtml(m.id)}">견적에 사용</button><button data-manager-edit="${escapeHtml(m.id)}">수정</button><button class="danger" data-manager-delete="${escapeHtml(m.id)}">삭제</button></div></div>`).join(''):'<div class="empty-message">등록된 담당자가 없습니다. 왼쪽에서 신규 등록해주세요.</div>';
  }
  function resetManagerEditor(){for(const id of ['managerEditId','managerEditName','managerEditRole','managerEditPhone'])$(id).value='';$('managerEditorTitle').textContent='새 담당자 등록';$('managerFormStatus').textContent='등록 후 견적 작성 화면에서 선택할 수 있습니다.'}
  function editSavedManager(id){const m=managers.find(x=>x.id===id);if(!m)return;$('managerEditId').value=m.id;$('managerEditName').value=m.name;$('managerEditRole').value=m.role;$('managerEditPhone').value=m.phone;$('managerEditorTitle').textContent='담당자 정보 수정';$('managerEditName').focus();}
  function useSavedManager(id){const m=managers.find(x=>x.id===id);if(!m)return;form.managerId=m.id;form.manager=managerFullName(m);form.phone=m.phone;$('managerName').value=form.manager;$('managerPhone').value=form.phone;renderManagerSelect();renderPaper();store();}
  function saveManagerFromEditor(){const id=$('managerEditId').value;const name=$('managerEditName').value.trim();const role=$('managerEditRole').value.trim();const phone=$('managerEditPhone').value.trim();
    if(!name){$('managerFormStatus').textContent='담당자 이름을 입력해주세요.';$('managerEditName').focus();return;}
    if(!phone){$('managerFormStatus').textContent='연락처를 입력해주세요.';$('managerEditPhone').focus();return;}
    const m={id:id||newId(),name,role,phone};const index=managers.findIndex(x=>x.id===m.id);
    if(index>=0)managers[index]=m;else managers.push(m);
    if(form.managerId===m.id)useSavedManager(m.id);
    renderManagerSelect();renderManagerList();store();resetManagerEditor();notify(index>=0?'담당자 정보 수정 완료':'담당자 등록 완료');
  }
  function deleteSavedManager(id){const m=managers.find(x=>x.id===id);if(!m||!confirm(`${managerFullName(m)} 담당자를 삭제할까요?`))return;
    managers=managers.filter(x=>x.id!==id);
    if(form.managerId===id){form.managerId='';renderManagerSelect();}
    renderManagerSelect();renderManagerList();resetManagerEditor();store();notify('담당자가 목록에서 삭제되었습니다. 기존 견적 내용은 유지됩니다.');
  }
  function syncSupplierInputs(){const mapping={supplierName:'name',supplierNo:'number',supplierCeo:'ceo',supplierAddress:'address',supplierType:'type',supplierCategory:'category'};for(const [id,key] of Object.entries(mapping)){const el=$(id);if(el)el.value=supplier[key]||''}}
  function renderSavedManagerUI(){renderManagerSelect();renderManagerList();syncSupplierInputs();}
  function renderHistory(){$('historyList').innerHTML=history.length?history.map((h,i)=>`<div class="history-entry"><div><b>${escapeHtml(h.customer||'고객님')} · ${escapeHtml(h.date||'')} · ${h.quotes?.length||0}개 모델</b><small>${escapeHtml(h.savedAt||'')} · 담당자 ${escapeHtml(h.manager||'')}</small></div><div><button data-history-load="${i}">불러오기</button> <button data-history-delete="${i}">삭제</button></div></div>`).join(''):'<div class="empty-message">저장된 견적 이력이 없습니다.</div>'}

  function syncFormInputs(){const ids={customerName:'customer',quoteDate:'date',managerName:'manager',managerPhone:'phone',searchInput:'search',quantityInput:'quantity',specialAmount:'specialAmount',specialMonths:'specialMonths',manualPromoName:'manualPromoName',manualPromoMonths:'manualPromoMonths',manualPromoPrice:'manualPromoPrice',manualPromoNote:'manualPromoNote',customNote:'note'};for(const [id,key] of Object.entries(ids)){$(id).value=form[key]??'';}
    $('recipientKind').value=form.recipientKind||'auto';syncRecipientSuffixInput();
    $('showMonthly').checked=!!form.showMonthly;$('showCommit').checked=!!form.showCommit;$('showImages').checked=!!form.showImages;$('showDetails').checked=!!form.showDetails;$('specialToggle').checked=!!form.special;$('manualPromoMode').value=form.manualPromoMode||'text';}
  function setupEditorAccordions(){
    const panels=[...document.querySelectorAll('#page-write .editor-column > .panel')];
    panels.forEach((panel,i)=>{
      if(panel.dataset.accordionReady==='1')return;
      const header=panel.querySelector(':scope > .panel-head');
      if(!header)return;
      panel.dataset.accordionReady='1';
      panel.classList.add('editor-step');
      const body=document.createElement('div');body.className='panel-body';
      let node=header.nextSibling;
      while(node){const next=node.nextSibling;body.appendChild(node);node=next;}
      panel.appendChild(body);
      const btn=document.createElement('button');
      btn.type='button';btn.className='panel-toggle';btn.innerHTML='<span class="toggle-text">접기</span><span class="chevron" aria-hidden="true">⌄</span>';
      btn.setAttribute('aria-label','이 영역 접기 또는 펼치기');
      const key='sk_quote_ui_panel_'+i;
      let closed=false;try{closed=localStorage.getItem(key)==='closed'}catch(e){}
      const apply=()=>{panel.classList.toggle('is-collapsed',closed);btn.setAttribute('aria-expanded',String(!closed));btn.querySelector('.toggle-text').textContent=closed?'펼치기':'접기';};
      btn.addEventListener('click',()=>{closed=!closed;apply();try{localStorage.setItem(key,closed?'closed':'open')}catch(e){}});
      header.appendChild(btn);apply();
    });
  }
  function switchPage(name){document.querySelectorAll('.nav-btn').forEach(b=>b.classList.toggle('active',b.dataset.page===name));document.querySelectorAll('.page').forEach(p=>p.classList.toggle('active',p.id==='page-'+name));if(name==='products')renderCatalog();if(name==='history')renderHistory();if(name==='managers')renderManagerList();if(name==='settings'){renderOverrideSelect();syncSupplierInputs();}if(name!=='write'){const page=$('page-'+name);if(page)page.scrollTop=0;}}
  function bind(){document.querySelectorAll('.nav-btn').forEach(b=>b.addEventListener('click',()=>switchPage(b.dataset.page)));
    const inputToForm={customerName:'customer',quoteDate:'date',managerName:'manager',managerPhone:'phone',customNote:'note'};
    for(const [id,key] of Object.entries(inputToForm)){$(id).addEventListener('input',e=>{form[key]=e.target.value;if(id==='customerName')syncRecipientSuffixInput();if(id==='managerName'||id==='managerPhone'){form.managerId='';renderManagerSelect();}renderPaper();store()});}
    $('recipientKind').addEventListener('change',e=>{form.recipientKind=e.target.value;form.recipientSuffix='';syncRecipientSuffixInput();renderPaper();store()});
    $('recipientSuffix').addEventListener('input',e=>{form.recipientSuffix=e.target.value.trim();renderPaper();store()});
    $('recipientSuffix').addEventListener('blur',()=>syncRecipientSuffixInput());
    for(const [id,key] of [['showMonthly','showMonthly'],['showCommit','showCommit'],['showImages','showImages'],['showDetails','showDetails']]){$(id).addEventListener('change',e=>{form[key]=e.target.checked;renderPaper();store()});}
    $('openManagerMenu').addEventListener('click',()=>switchPage('managers'));
    $('savedManagerSelect').addEventListener('change',e=>{if(e.target.value)useSavedManager(e.target.value);else{form.managerId='';store()}});
    $('managerNewBtn').addEventListener('click',resetManagerEditor);
    $('managerCancelBtn').addEventListener('click',resetManagerEditor);
    $('managerSaveBtn').addEventListener('click',saveManagerFromEditor);
    $('managerList').addEventListener('click',e=>{
      const use=e.target.closest('[data-manager-use]'),edit=e.target.closest('[data-manager-edit]'),del=e.target.closest('[data-manager-delete]');
      if(use){useSavedManager(use.dataset.managerUse);switchPage('write');notify('담당자를 견적서에 적용했습니다.');}
      else if(edit)editSavedManager(edit.dataset.managerEdit);
      else if(del)deleteSavedManager(del.dataset.managerDelete);
    });
    const supplierFields={supplierName:'name',supplierNo:'number',supplierCeo:'ceo',supplierAddress:'address',supplierType:'type',supplierCategory:'category'};
    for(const [id,key] of Object.entries(supplierFields)){$(id).addEventListener('input',e=>{supplier[key]=e.target.value;renderPaper();store()});}
    $('monthSelect').addEventListener('change',e=>{form.month=e.target.value;form.productId='';selection={};form.promoIndex='';activateMonth();});
    $('categorySelect').addEventListener('change',e=>{form.category=e.target.value;renderProducts();store()});
    $('searchInput').addEventListener('input',e=>{form.search=e.target.value;renderProducts();store()});
    $('productSelect').addEventListener('change',e=>{form.productId=e.target.value;form.promoIndex='';selection={};renderChosenProduct();store()});
    keys.forEach(k=>$('cond-'+k).addEventListener('change',e=>{selection[k]=e.target.value;const idx=keys.indexOf(k);for(const kk of keys.slice(idx+1))delete selection[kk];form.promoIndex='';renderConditions();store()}));
    $('customerTypeSelect').addEventListener('change',e=>{form.customerType=e.target.value;form.promoIndex='';renderPrice();renderPromos();store()});
    $('quantityInput').addEventListener('input',e=>{form.quantity=Math.min(999,Math.max(1,Number(e.target.value)||1));store()});
    $('specialToggle').addEventListener('change',e=>{form.special=e.target.checked;renderPrice();store()});
    $('specialAmount').addEventListener('input',e=>{form.specialAmount=e.target.value;renderPrice();store()});$('specialMonths').addEventListener('input',e=>{form.specialMonths=e.target.value;renderPrice();store()});
    $('promoSelect').addEventListener('change',e=>{form.promoIndex=e.target.value;renderManualPromoFields();store()});
    // 수기 혜택은 드롭다운에 의존하지 않고 항상 보이는 접기/펼치기 영역으로도 접근합니다.
    $('manualPromoDetails').addEventListener('toggle',e=>{
      const open=e.currentTarget.open;
      if(open && form.promoIndex!=='manual'){
        form.promoIndex='manual';
        const select=$('promoSelect');
        if(!select.querySelector('option[value="manual"]')){
          select.insertAdjacentHTML('beforeend','<option value="manual">✎ 수기 할인프로모션 · 혜택 직접 입력</option>');
        }
        select.value='manual';
        store();
      }else if(!open && form.promoIndex==='manual'){
        form.promoIndex='';
        $('promoSelect').value='';
        store();
      }
    });
    $('manualPromoMode').addEventListener('change',e=>{form.manualPromoMode=e.target.value;renderManualPromoFields();store()});
    for(const [id,key] of [['manualPromoName','manualPromoName'],['manualPromoMonths','manualPromoMonths'],['manualPromoPrice','manualPromoPrice'],['manualPromoNote','manualPromoNote']]){
      $(id).addEventListener('input',e=>{form[key]=e.target.value;store()});
    }
    $('addBtn').addEventListener('click',addItem);
    $('clearBtn').addEventListener('click',()=>{if(!quotes.length||confirm('현재 견적의 모든 모델을 삭제할까요?')){quotes=[];renderItems();renderPaper();store()}});
    $('addedItems').addEventListener('click',e=>{
      const save=e.target.closest('[data-qp-save]');
      const clear=e.target.closest('[data-qp-clear]');
      if(save){
        const i=Number(save.dataset.qpSave),q=quotes[i],card=save.closest('[data-index]');if(!q||!card)return;
        const value=key=>card.querySelector(`[data-qp-field="${key}"]`)?.value||'';
        const custom=manualPromotion(value('name'),value('mode'),value('months'),value('price'),value('note'),Number(q.monthly)||0,Number(q.months)||0);
        if(!custom)return;
        q.promo=custom;q.promoOn=true;q.promoMonthlyOverride=null;
        renderItems();renderPaper();store();notify('선택 제품의 수기 프로모션을 적용했습니다.');return;
      }
      if(clear){const q=quotes[Number(clear.dataset.qpClear)];if(!q)return;q.promo=null;q.promoOn=false;q.promoMonthlyOverride=null;renderItems();renderPaper();store();notify('선택 제품의 프로모션을 제외했습니다.');return;}
      const b=e.target.closest('[data-remove]');if(!b)return;quotes.splice(Number(b.dataset.remove),1);renderItems();renderPaper();store();
    });
    $('addedItems').addEventListener('change',e=>{const el=e.target.closest('[data-edit]');if(!el)return;const container=el.closest('[data-index]');if(!container)return;editQuote(Number(container.dataset.index),el.dataset.edit,el.type==='checkbox'?el.checked:el.value);});
    $('paper').addEventListener('focusin',e=>{const el=e.target.closest('[data-paper-edit], [data-recipient-preview-edit]');if(!el)return;const range=document.createRange();range.selectNodeContents(el);const selection=window.getSelection();selection.removeAllRanges();selection.addRange(range);});
    $('paper').addEventListener('keydown',e=>{if(!e.target.closest('[data-paper-edit], [data-recipient-preview-edit]'))return;if(e.key==='Enter'){e.preventDefault();e.target.blur()}if(e.key==='Escape'){e.preventDefault();renderPaper()}});
    $('paper').addEventListener('blur',e=>{
      const suffix=e.target.closest('[data-recipient-preview-edit="suffix"]');
      if(suffix){
        const value=String(suffix.textContent||'').replace(/\s+/g,' ').trim().slice(0,20);
        form.recipientSuffix=value;
        syncRecipientSuffixInput();
        renderPaper();store();
        return;
      }
      const el=e.target.closest('[data-paper-edit]');
      if(!el)return;
      editQuote(Number(el.dataset.index),el.dataset.paperEdit,el.textContent);
    },true);
    $('catalogSearch').addEventListener('input',renderCatalog);
    $('catalogMonth').addEventListener('change',e=>{form.month=e.target.value;form.productId='';selection={};activateMonth()});
    $('catalogGrid').addEventListener('click',e=>{const b=e.target.closest('[data-catalog-pick]');if(!b)return;form.category='전체';form.search='';form.productId=b.dataset.catalogPick;selection={};$('searchInput').value='';renderCategories();renderProducts();switchPage('write');store()});
    $('saveHistoryBtn').addEventListener('click',()=>{if(!quotes.length){notify('저장할 견적 모델이 없습니다.');return;}const h={customer:form.customer,date:form.date,manager:form.manager,savedAt:new Date().toLocaleString('ko-KR'),form:JSON.parse(JSON.stringify(form)),quotes:JSON.parse(JSON.stringify(quotes))};history.unshift(h);history=history.slice(0,150);saveHistoryStorage();renderHistory();notify('현재 브라우저의 견적 이력에 저장했습니다.')});
    $('historyList').addEventListener('click',e=>{const load=e.target.closest('[data-history-load]'),del=e.target.closest('[data-history-delete]');if(load){const h=history[Number(load.dataset.historyLoad)];if(!h)return;form={...form,...h.form};quotes=JSON.parse(JSON.stringify(h.quotes||[]));syncFormInputs();if(sourceReady)activateMonth();renderItems();renderPaper();switchPage('write');store();notify('견적 이력을 불러왔습니다.')}else if(del&&confirm('이 견적 이력을 삭제할까요?')){history.splice(Number(del.dataset.historyDelete),1);saveHistoryStorage();renderHistory()}});
    $('historyExportBtn').addEventListener('click',()=>downloadJSON('skmagic_quote_history.json',history));
    $('backupBtn').addEventListener('click',()=>downloadJSON('skmagic_quote_admin_backup_'+dateText()+'.json',{version:'1.7',savedAt:new Date().toISOString(),form,quotes,history,managers,supplier,imageOverrides:Object.fromEntries(imageOverrides)}));
    $('restoreBtn').addEventListener('click',()=>$('restoreFile').click());
    $('restoreFile').addEventListener('change',async e=>{const f=e.target.files?.[0];if(!f)return;try{const obj=JSON.parse(await f.text());if(!obj||!Array.isArray(obj.quotes))throw new Error('견적 백업 형식이 아닙니다.');if(!confirm('현재 작성 중인 견적과 이력을 백업 파일로 교체할까요?'))return;form={...form,...obj.form};quotes=obj.quotes;history=Array.isArray(obj.history)?obj.history:[];if(Array.isArray(obj.managers))managers=obj.managers.filter(m=>m&&typeof m.name==='string'&&typeof m.phone==='string');if(obj.supplier&&typeof obj.supplier==='object')supplier={...supplierDefaults,...obj.supplier};renderSavedManagerUI();if(obj.imageOverrides&&typeof obj.imageOverrides==='object'){for(const [k,v] of Object.entries(obj.imageOverrides)){if(typeof v==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/.test(v)){await saveImageToDB(k,v);imageOverrides.set(k,v);}}}syncFormInputs();if(sourceReady)activateMonth();renderItems();renderPaper();saveHistoryStorage();store();notify('백업 복원 완료')}catch(err){notify('백업 불러오기 실패: '+err.message)}finally{e.target.value=''}});
    $('reloadDataBtn').addEventListener('click',loadSource);
    $('imageOverrideInput').addEventListener('change',handleImageOverride);
    $('removeImageOverride').addEventListener('click',async()=>{const key=form.month+'|'+$('imageOverrideModel').value;if(!key||!$('imageOverrideModel').value)return;await deleteImageFromDB(key);imageOverrides.delete(key);$('imageStatus').textContent='이 모델의 이미지를 계산기 원본으로 복원했습니다.';renderChosenProduct();renderCatalog();renderPaper();});
    $('openImageBtn').addEventListener('click',openImageModal);$('closeModal').addEventListener('click',closeModal);$('imageModal').addEventListener('click',e=>{if(e.target===$('imageModal'))closeModal()});
    $('copyImageBtn').addEventListener('click',copyImage);$('downloadImageBtn').addEventListener('click',downloadImage);
    $('imagePrevPage')?.addEventListener('click',()=>showImageModalPage(activePageIndex-1));
    $('imageNextPage')?.addEventListener('click',()=>showImageModalPage(activePageIndex+1));
    $('savePdfBtn').addEventListener('click',savePdf);$('printBtn').addEventListener('click',()=>window.print());
  }
  function editQuote(i,key,value){
    const q=quotes[i];if(!q)return;
    const numeric=['normalPrice','discountPrice','monthly','months','qty','promoMonthlyOverride'];
    if(numeric.includes(key)){
      const n=Math.max(0,toNum(value));
      if(key==='qty')q.qty=Math.max(1,Math.floor(n||1));
      else if(key==='months'){q.months=Math.floor(n);q.years=q.months/12;}
      else if(key==='normalPrice')q.normalPrice=n;
      else if(key==='discountPrice'){
        const base=normalOfQuote(q);
        if(base>0){q.monthly=Math.max(0,base-n);q.basePrice=q.monthly;q.manualPrice=true;}
        else {notify('먼저 정상구독료를 입력해주세요.');}
      }
      else if(key==='monthly'){q.monthly=n;q.basePrice=n;q.manualPrice=true;}
      else q.promoMonthlyOverride=n;
    }else if(key==='promoOn')q.promoOn=!!value;
    else if(['management','cycle','customerType'].includes(key))q[key]=String(value||'').trim();
    store();renderItems();renderPaper();
  }
  function downloadJSON(name,obj){const data=JSON.stringify(obj,null,2);downloadBlob(new Blob([data],{type:'application/json;charset=utf-8'}),name)}
  function downloadBlob(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),1000)}
  // V1.7.4: canvas cannot access a normal cross-origin <img> without CORS.
  // Convert reachable originals to data URLs BEFORE html2canvas; use same-origin
  // image mirrors or a photo uploaded by the user for vendors that block CORS.
  function readImageCandidates(img){
    let values=[];
    try{values=JSON.parse(decodeURIComponent(img.dataset.imageCandidates||'[]'))}catch(e){}
    return uniq([img.currentSrc,img.getAttribute('src'),...values].map(normalizeImageUrl).filter(Boolean));
  }
  function dataUrlFromBlob(blob){return new Promise((resolve,reject)=>{
    const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('이미지 파일을 읽을 수 없습니다.'));reader.readAsDataURL(blob);
  })}
  function timeoutSignal(ms){
    if(typeof AbortSignal!=='undefined'&&AbortSignal.timeout)return AbortSignal.timeout(ms);
    return undefined;
  }
  async function convertImageToSafeDataUrl(url){
    if(/^data:image\/(?:png|jpe?g|webp|gif);base64,/i.test(url))return url;
    if(exportPhotoCache.has(url))return exportPhotoCache.get(url);
    const task=(async()=>{
      const response=await fetch(url,{mode:'cors',credentials:'omit',cache:'force-cache',signal:timeoutSignal(11000)});
      if(!response.ok)throw new Error('HTTP '+response.status);
      const blob=await response.blob();
      if(!blob.size || blob.size>15*1024*1024)throw new Error('사진 파일 크기가 올바르지 않습니다.');
      // Only preserve original image bytes. Do not redraw or transform product photographs.
      if(!/^image\/(?:png|jpeg|webp|gif)$/i.test(blob.type))throw new Error('지원되지 않는 이미지 형식');
      return dataUrlFromBlob(blob);
    })();
    exportPhotoCache.set(url,task);
    // Do not permanently cache failures; a later upload or photo mirror may fix them.
    task.catch(()=>exportPhotoCache.delete(url));
    if(exportPhotoCache.size>65)exportPhotoCache.delete(exportPhotoCache.keys().next().value);
    return task;
  }
  async function waitSafePhotoLoad(img){
    if(img.decode){try{await img.decode();return img.naturalWidth>0}catch(e){}}
    return new Promise(resolve=>{
      if(img.complete){resolve(img.naturalWidth>0);return;}
      const timeout=setTimeout(()=>resolve(false),5500);
      img.onload=()=>{clearTimeout(timeout);resolve(img.naturalWidth>0)};
      img.onerror=()=>{clearTimeout(timeout);resolve(false)};
    });
  }
  async function preparePagePhotosForCanvas(page){
    if(!form.showImages || !form.showDetails)return;
    const entries=[...page.querySelectorAll('.detail-photo')];
    const errors=[];
    for(const holder of entries){
      const img=holder.querySelector('img');
      const model=holder.closest('.detail-card')?.querySelector('.detail-card-head span')?.textContent?.trim()||img?.alt||'제품';
      if(!img){errors.push(model+' (원본 사진 없음)');continue;}
      const candidates=readImageCandidates(img);
      let safeImage='',reason='';
      for(const url of candidates){
        try{
          const dataUrl=await convertImageToSafeDataUrl(url);
          img.src=dataUrl;
          img.style.display='block';
          if(await waitSafePhotoLoad(img)){safeImage=dataUrl;break;}
        }catch(e){reason=e.message||String(e);}
      }
      if(!safeImage){errors.push(model+(reason?' ('+reason+')':''));continue;}
      img.removeAttribute('data-image-candidates');
      img.removeAttribute('data-image-wired');
      holder.querySelectorAll('.image-missing').forEach(el=>el.remove());
    }
    if(errors.length){
      const e=new Error('출력용 제품사진을 불러오지 못했습니다: '+uniq(errors).join(', ')+'\n설정 → 제품 이미지 직접 선택에서 해당 모델의 원본 사진을 등록하거나, GitHub Actions의 제품사진 캐시를 실행해주세요.');
      e.photoErrors=errors;
      throw e;
    }
  }
  async function capturePaperPage(sourcePage){
    if(typeof window.html2canvas!=='function') throw new Error('이미지 라이브러리를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.');
    if(!sourcePage) throw new Error('견적서 페이지가 없습니다.');
    const container=document.createElement('div');
    container.className='paper export-paper';
    // Export at the fixed A4 design width, never at the user's zoomed preview width.
    container.style.cssText='position:fixed;left:-10000px;top:0;width:794px;max-width:794px;padding:0;zoom:1;box-shadow:none;border:0;background:white;z-index:-1';
    const page=sourcePage.cloneNode(true);
    page.querySelectorAll('[contenteditable]').forEach(el=>{el.removeAttribute('contenteditable');el.classList.remove('p-editable')});
    container.appendChild(page);document.body.appendChild(container);
    try{
      await preparePagePhotosForCanvas(page);
      const images=[...page.querySelectorAll('img')];
      await Promise.all(images.map(async img=>{
        if(!img.complete||img.naturalWidth===0)await waitSafePhotoLoad(img);
      }));
      if(document.fonts?.ready){try{await document.fonts.ready}catch(e){}}
      return await html2canvas(page,{backgroundColor:'#fff',scale:2,useCORS:true,allowTaint:false,logging:false,scrollX:0,scrollY:0,windowWidth:1100});
    }finally{container.remove();}
  }
  async function renderCanvas(){return capturePaperPage($('paper').querySelector('.paper-page'));}
  let activeCanvases=[],activePageIndex=0;
  function showImageModalPage(index){
    if(!activeCanvases.length)return;
    activePageIndex=Math.max(0,Math.min(activeCanvases.length-1,index));
    activeCanvas=activeCanvases[activePageIndex];
    const img=document.createElement('img');img.src=activeCanvas.toDataURL('image/png');img.alt=`견적서 ${activePageIndex+1}페이지`;
    $('modalImageWrap').replaceChildren(img);
    const controls=$('imagePageControls');
    if(controls)controls.classList.toggle('hidden',activeCanvases.length<2);
    if($('imagePageLabel'))$('imagePageLabel').textContent=`${activePageIndex+1} / ${activeCanvases.length}`;
    if($('imagePrevPage'))$('imagePrevPage').disabled=activePageIndex===0;
    if($('imageNextPage'))$('imageNextPage').disabled=activePageIndex===activeCanvases.length-1;
    $('imageCopyStatus').textContent=activeCanvases.length>1?'페이지를 선택해 이미지를 복사하거나 저장할 수 있습니다.':'이미지를 확인하고 복사해서 카카오톡에 붙여넣으세요.';
  }
  function closeModal(){$('imageModal').classList.add('hidden');activeCanvas=null;activeCanvases=[];activePageIndex=0}
  async function openImageModal(){
    $('imageModal').classList.remove('hidden');$('modalImageWrap').innerHTML='<div class="loading-box">실제 견적서 이미지 생성 중…</div>';
    if($('imagePageControls'))$('imagePageControls').classList.add('hidden');
    $('imageCopyStatus').textContent='이미지 생성 중입니다.';
    try{
      const pages=[...$('paper').querySelectorAll('.paper-page')];
      activeCanvases=[];
      for(const page of pages)activeCanvases.push(await capturePaperPage(page));
      showImageModalPage(0);
    }catch(e){activeCanvas=null;activeCanvases=[];
      $('modalImageWrap').innerHTML='<div class="loading-box export-image-error"><b>이미지 생성이 중단되었습니다.</b><p>'+escapeHtml(e.message).replace(/\n/g,'<br>')+'</p><button type="button" class="secondary-btn" id="openImageSettingsNow">제품사진 등록 화면 열기</button></div>';
      $('imageCopyStatus').textContent='사진이 빠진 견적서는 복사·저장하지 않습니다.';
      const button=$('openImageSettingsNow');if(button)button.addEventListener('click',()=>{closeModal();switchPage('settings');$('imageOverrideInput')?.scrollIntoView({behavior:'smooth',block:'center'});});
      notify('출력용 제품사진을 확인해주세요.');
    }
  }
  async function copyImage(){if(!activeCanvas){notify('먼저 견적서 이미지를 생성해주세요.');return;}try{const blob=await new Promise((resolve,reject)=>activeCanvas.toBlob(b=>b?resolve(b):reject(new Error('Blob 생성 실패')),'image/png'));
      if(!navigator.clipboard||!window.ClipboardItem)throw new Error('보안 브라우저 환경에서만 복사할 수 있습니다.');await navigator.clipboard.write([new ClipboardItem({'image/png':blob})]);$('imageCopyStatus').textContent=`${activePageIndex+1}페이지를 복사했습니다. 카카오톡에서 Ctrl+V로 붙여넣으세요.`;notify('견적서 이미지 복사 완료');
    }catch(e){notify('클립보드 복사 실패: PNG 저장으로 첨부해주세요.');$('imageCopyStatus').textContent=e.message;}}
  function downloadImage(){if(!activeCanvas){notify('미리보기 이미지가 없습니다.');return;}activeCanvas.toBlob(blob=>{if(blob)downloadBlob(blob,`SK매직_견적서_${dateText()}_${activePageIndex+1}페이지.png`)},'image/png')}
  async function savePdf(){
    try{
      if(!window.jspdf?.jsPDF)throw new Error('PDF 라이브러리를 불러오지 못했습니다.');
      notify('견적서 PDF 페이지를 생성 중입니다.');
      const pdf=new window.jspdf.jsPDF('p','mm','a4');
      const pages=[...$('paper').querySelectorAll('.paper-page')];
      for(let i=0;i<pages.length;i++){
        const canvas=await capturePaperPage(pages[i]);
        if(i>0)pdf.addPage();
        pdf.addImage(canvas.toDataURL('image/png'),'PNG',0,0,210,297);
      }
      pdf.save(`SK매직_견적서_${dateText()}.pdf`);notify('PDF 저장 완료');
    }catch(e){notify('PDF 저장 중단 · 출력용 사진을 확인해주세요.');console.warn(e);
      alert('PDF 저장을 중단했습니다.\n\n'+e.message+'\n\n사진이 빠진 PDF는 저장하지 않았습니다.');}
  }
  function openImageDB(){return new Promise((resolve,reject)=>{const req=indexedDB.open('SKMagicQuoteImages',1);req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains('images'))db.createObjectStore('images')};req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error)})}
  async function saveImageToDB(k,data){const db=await openImageDB();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').put(data,k);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
  async function deleteImageFromDB(k){const db=await openImageDB();return new Promise((resolve,reject)=>{const tx=db.transaction('images','readwrite');tx.objectStore('images').delete(k);tx.oncomplete=()=>{db.close();resolve()};tx.onerror=()=>{db.close();reject(tx.error)}})}
  async function restoreImages(){
    let db;
    try{
      db=await openImageDB();
      const tx=db.transaction('images','readonly');const store=tx.objectStore('images');
      // Queue BOTH requests within the same active IndexedDB transaction.
      // Awaiting the first one before creating the second can close the transaction.
      const keyReq=store.getAllKeys();const valReq=store.getAll();
      const records=await Promise.all([new Promise((resolve,reject)=>{keyReq.onsuccess=()=>resolve(keyReq.result);keyReq.onerror=()=>reject(keyReq.error)}),new Promise((resolve,reject)=>{valReq.onsuccess=()=>resolve(valReq.result);valReq.onerror=()=>reject(valReq.error)})]);
      records[0].forEach((key,index)=>{if(typeof records[1][index]==='string'&&/^data:image\/(?:png|jpeg|webp);base64,/i.test(records[1][index]))imageOverrides.set(key,records[1][index])});
    }catch(e){console.warn('브라우저 제품사진 저장소 복원 실패',e)}
    finally{try{db?.close()}catch(e){}}
  }
  async function handleImageOverride(e){const file=e.target.files?.[0],model=$('imageOverrideModel').value;if(!file||!model)return;
    if(!['image/png','image/jpeg','image/webp'].includes(file.type)){notify('PNG/JPG/WEBP 이미지만 등록할 수 있습니다.');return;}
    if(file.size>12*1024*1024){notify('이미지는 12MB 이하로 선택해주세요.');return;}
    const key=form.month+'|'+model;try{const data=await new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsDataURL(file)});await saveImageToDB(key,data);const db=await openImageDB();const verify=await new Promise((resolve,reject)=>{const r=db.transaction('images','readonly').objectStore('images').get(key);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});db.close();if(verify!==data)throw new Error('업로드 이미지 저장 검증 실패');imageOverrides.set(key,data);$('imageStatus').textContent=`${model} · 원본 화질 그대로 브라우저 저장 완료`;if(currentProduct()?.model===model)renderChosenProduct();quotes.forEach(q=>{if(q.month===form.month&&q.model===model)q.imageKey=key});renderPaper();renderCatalog();store();notify('이미지 저장 검증 완료');}
    catch(err){$('imageStatus').textContent='업로드 실패: '+err.message;notify('이미지 저장 실패');}finally{e.target.value=''}}
  async function init(){
    try {
      restore();
      renderSavedManagerUI();
      let savedUrl='';try{savedUrl=localStorage.getItem(URL_KEY)||''}catch(e){}
      $('dataUrlInput').value=savedUrl||SOURCE_URL;
      syncFormInputs();
      setupEditorAccordions();
      renderItems();
      renderPaper();
      bind();
      await restoreImages();
      await loadPhotoCacheManifest();
      loadSource();
    } catch(e) {
      console.error('SK Magic quote initialization failure', e);
      sourceStatus('화면 초기화 오류', 'fail');
      alertBanner('견적서 화면을 시작하는 중 오류가 발생했습니다. F12 콘솔을 확인하거나 파일을 다시 설치해주세요. 오류: '+e.message);
      try { if ($('paper') && !$('paper').children.length) $('paper').innerHTML='<div class="empty-paper">견적서 초기화 중 오류가 발생했습니다. 파일 재설치를 확인해주세요.</div>'; }catch(_){}
    }
  }
  window.addEventListener('resize',updatePreviewScale);
  document.addEventListener('DOMContentLoaded',init);
})();
