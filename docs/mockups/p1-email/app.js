/* Offline P1-D1. All dynamic values enter the DOM through textContent/value. */
(() => {
  'use strict';
  const labels = { unknown: 'Chưa xác minh', pending: 'Chờ người phụ trách', recorded: 'Đã ghi nhận thiết lập', blocked: 'Bị chặn' };
  const owners = ['Người phụ trách A', 'Người phụ trách B'];
  const seed = [
    ['e1','a***@example.com','Gmail cá nhân','Cá nhân',owners[0],'pending','2026-11-25'],
    ['e2','b***@example.com','Microsoft','Chưa biết',owners[1],'unknown',''],
    ['e3','c***@example.com','Microsoft','Chưa biết',owners[0],'blocked','2026-11-26'],
    ['e4','d***@example.com','Gmail cá nhân','Cá nhân',owners[1],'recorded','2026-12-03']
  ].map(([id,label,provider,type,owner,state,due]) => ({id,label,provider,type,owner,state,due,reason:state === 'blocked' ? 'Chờ bổ sung bằng chứng thủ công minh họa' : '',source:'Người phụ trách tự xác nhận (fixture)',time:'2026-11-26 09:00 (giả lập)',history:['Fixture khởi tạo · 2026-11-26 09:00 (giả lập)']}));
  let records, draft = null, scenario = 'normal', page = 1, route = ['registry'], saving = false, readback = false;
  const filters = { search:'', provider:'', ownerFilter:'', stateFilter:'', dueFilter:'' };
  const $ = id => document.getElementById(id);
  const main = $('main');
  const node = (tag, text, cls) => { const el = document.createElement(tag); if(text !== undefined) el.textContent = text; if(cls) el.className = cls; return el; };
  const button = (text, action, disabled = false) => { const el = node('button',text); el.type='button'; el.disabled=disabled; el.addEventListener('click',action); return el; };
  const stateOptions = (el, all = false) => { if(all) el.add(new Option('Tất cả','')); Object.entries(labels).forEach(([key,value]) => el.add(new Option(value,key))); };
  const dueStatus = r => !r.due ? 'unknown' : r.due < '2026-11-26' ? 'overdue' : r.due === '2026-11-26' ? 'today' : 'future';
  const dueLabels = {unknown:'Chưa biết',overdue:'Quá hạn',today:'Đến hạn hôm nay',future:'Chưa đến hạn'};
  const current = () => records.find(r => r.id === route[1]);
  function go(name,id) { const hash = '#'+name+(id ? '/'+id : ''); if(location.hash === hash) render(); else location.hash=hash; }
  function reset() { records=structuredClone(seed); draft=null; scenario='normal'; page=1; saving=false; readback=false; Object.keys(filters).forEach(k => filters[k]=''); $('scenario').value='normal'; go('registry'); }
  function table(headers, rows, cards=false) { const wrap=node('div',undefined,'ds-table-wrap'), t=node('table',undefined,'ds-table'); if(cards) t.dataset.cards='true'; t.append(node('caption','Dữ liệu hư cấu · ghi nhận thủ công')); const head=node('thead'), tr=node('tr'); headers.forEach(h => { const th=node('th',h); th.scope='col'; tr.append(th); }); head.append(tr); t.append(head); const body=node('tbody'); rows.forEach(values => { const row=node('tr'); values.forEach((v,i) => { const td=node('td'); td.dataset.label=headers[i]; td.append(v instanceof Node ? v : node('span',v)); row.append(td); }); body.append(row); }); t.append(body); wrap.append(t); return wrap; }
  function registryResults() {
    const out=$('results'); out.replaceChildren();
    if(scenario==='error') { out.append(node('p','Không đọc được dữ liệu minh họa. Bộ lọc được giữ nguyên.','ds-error'),button('Thử lại',() => { scenario='normal'; $('scenario').value=scenario; render(); })); return; }
    if(scenario==='loading') { out.setAttribute('aria-busy','true'); out.append(node('p','Đang tải dữ liệu minh họa…')); const skeleton=table(['Email che','Nhà cung cấp','Người phụ trách','Trạng thái'],Array.from({length:3},() => Array.from({length:4},() => node('div','…','ds-skeleton')))); skeleton.setAttribute('aria-hidden','true'); out.append(skeleton,button('Hoàn tất tải minh họa',() => { scenario='normal'; $('scenario').value=scenario; render(); })); return; }
    out.removeAttribute('aria-busy');
    if(scenario==='empty') { out.append(node('p','Chưa có email minh họa. Đây là trạng thái chưa có bản ghi.')); return; }
    if(scenario==='partial') out.append(node('p','Dữ liệu một phần: loại Microsoft, nguồn và thời gian chưa biết; không suy đoán.','ds-notice'));
    const matches=records.filter(r => (!filters.provider || r.provider===filters.provider) && (!filters.ownerFilter || r.owner===filters.ownerFilter) && (!filters.stateFilter || r.state===filters.stateFilter) && (!filters.dueFilter || dueStatus(r)===filters.dueFilter) && [r.label,r.provider,r.owner,r.state,labels[r.state]].join(' ').toLocaleLowerCase('vi').includes(filters.search.toLocaleLowerCase('vi')));
    if(!matches.length) { out.append(node('p','Không có kết quả phù hợp bộ lọc.'),button('Xóa bộ lọc',() => { Object.keys(filters).forEach(k => filters[k]=''); page=1; render(); })); return; }
    const pages=Math.ceil(matches.length/2); page=Math.min(page,pages);
    out.append(table(['Email che','Nhà cung cấp / loại','Người phụ trách','Ghi nhận thủ công','Nguồn / thời điểm','Hạn xem lại','Tiếp theo'],matches.slice((page-1)*2,page*2).map(r => { const badge=node('span',labels[r.state],'ds-badge'); badge.dataset.state=r.state; return [r.label,r.provider+' / '+r.type,r.owner,badge,scenario==='partial' ? 'Chưa biết' : r.source+' · '+r.time,(r.due || 'Chưa biết')+' · '+dueLabels[dueStatus(r)],button('Chi tiết',() => go('detail',r.id))]; }),true));
    const pager=node('nav',undefined,'ds-pager'); pager.setAttribute('aria-label','Phân trang'); pager.append(button('Trang trước',() => {page--; registryResults();},page===1),node('span',`Trang ${page} / ${pages}`),button('Trang sau',() => {page++; registryResults();},page===pages)); out.append(pager);
  }
  function metadata(r) { const dl=node('dl',undefined,'ds-definition'); const fields={'Email che':r.label,'Nhà cung cấp':r.provider,'Loại tài khoản':r.type,'Người phụ trách':r.owner,'Ghi nhận thủ công':labels[r.state],'Nguồn':scenario==='partial'?'Chưa biết':r.source,'Thời điểm':scenario==='partial'?'Chưa biết':r.time,'Hạn xem lại':r.due || 'Chưa biết','Lý do':r.reason || 'Chưa có','Hành động tiếp theo':'Người phụ trách xem lại bằng chứng thủ công; hạn do người dùng chọn, không cam kết mở khóa.','Tài sản minh họa':'ASSET-DEMO-01 · Tham chiếu hư cấu, không kết nối tài sản thật'}; Object.entries(fields).forEach(([k,v]) => dl.append(node('dt',k),node('dd',v))); return dl; }
  function capture() { for(const key of ['owner','state','due','reason']) draft[key]=$(key).value; }
  function edit(r) {
    if(!draft || draft.id!==r.id) draft={...r};
    stateOptions($('state')); for(const key of ['owner','state','due','reason']) $(key).value=draft[key];
    $('editForm').addEventListener('input',capture); $('editForm').addEventListener('change',capture);
    $('editForm').addEventListener('submit',event => {
      event.preventDefault(); capture(); const errors=[];
      if(!owners.includes(draft.owner)) errors.push(['owner','Chọn người phụ trách.']);
      if(draft.state==='blocked' && !draft.reason.trim()) errors.push(['reason','Nhập lý do bị chặn; không nhập bí mật.']);
      if(draft.due && (!/^\d{4}-\d{2}-\d{2}$/.test(draft.due) || !Number.isFinite(Date.parse(draft.due)) || new Date(draft.due).toISOString().slice(0,10)!==draft.due)) errors.push(['due','Nhập ngày ISO hợp lệ YYYY-MM-DD hoặc để trống.']);
      $('errors').replaceChildren(); ['owner','due','reason'].forEach(k => { $(k).removeAttribute('aria-invalid'); $(k+'Error').textContent=''; });
      if(errors.length) { $('errors').append(node('p','Chưa thể xem lại: kiểm tra các trường sau.')); const ul=node('ul'); errors.forEach(([key,message]) => { $(key).setAttribute('aria-invalid','true'); $(key+'Error').textContent=message; const li=node('li'),a=node('a',message); a.href='#'+key; a.addEventListener('click',e => {e.preventDefault(); $(key).focus();}); li.append(a); ul.append(li); }); $('errors').append(ul); $(errors[0][0]).focus(); return; }
      go('review',r.id);
    });
  }
  function render() {
    route=location.hash.slice(1).split('/'); if(!route[0]) route=['registry'];
    main.replaceChildren();
    if(scenario==='no-permission') { draft=null; main.append(node('h2','Không có quyền xem email'),node('p','Không hiển thị danh sách hoặc chi tiết trong trạng thái này.'),button('Danh sách',()=>{},true),button('Sửa metadata',()=>{},true)); main.focus(); return; }
    if(!['registry','detail','edit','review'].includes(route[0]) || (route[0]!=='registry' && (!current() || route.length!==2)) || (route[0]==='registry' && route.length!==1)) { draft=null; main.append(node('h2','Không tìm thấy màn hoặc bản ghi minh họa'),button('Về danh sách',() => go('registry'))); main.focus(); return; }
    if(route[0]==='review' && (!draft || draft.id!==route[1])) { main.append(node('h2','Không có bản nháp để xem lại'),button('Về chi tiết',()=>go('detail',route[1]))); main.focus(); return; }
    main.innerHTML=window.P1_SCREENS[route[0]]; // Trusted generated static fragments only.
    const r=current();
    if(route[0]==='registry') { stateOptions($('stateFilter'),true); Object.entries(filters).forEach(([key,value]) => { $(key).value=value; $(key).addEventListener(key==='search'?'input':'change',() => { filters[key]=$(key).value; page=1; registryResults(); }); }); registryResults(); }
    if(route[0]==='detail') { if(readback) { $('metadata').append(node('p','Lưu minh họa đã thực hiện, nhưng đọc lại bị lỗi. Không bấm lưu lại.','ds-error'),button('Thử đọc lại',()=>{readback=false; render();})); } else { $('metadata').append(metadata(r)); r.history.forEach(h => $('history').append(node('li',h))); } }
    if(route[0]==='edit') edit(r);
    if(route[0]==='review') $('comparison').append(table(['Trường','Trước','Sau'],['owner','state','due','reason'].map((key,i) => [['Người phụ trách','Ghi nhận thủ công','Hạn xem lại','Lý do'][i],key==='state'?labels[r[key]]:r[key] || 'Chưa biết',key==='state'?labels[draft[key]]:draft[key] || 'Chưa biết'])));
    main.querySelectorAll('[data-action]').forEach(el => el.addEventListener('click',() => {
      const action=el.dataset.action;
      if(saving) return;
      if(action==='registry') { draft=null; go('registry'); }
      if(action==='edit' || action==='backEdit') go('edit',r.id);
      if(action==='cancel') { draft=null; go('detail',r.id); }
      if(action==='save') {
        const fail=$('saveMode').value==='fail'; saving=true; $('saveStatus').textContent='Đang lưu minh họa…'; main.querySelectorAll('button,select').forEach(b=>b.disabled=true);
        setTimeout(() => { if(scenario==='no-permission' || !draft) {saving=false; return;} for(const key of ['owner','state','due','reason']) r[key]=draft[key]; r.history.push('Lưu metadata fixture · 2026-11-26 (giả lập) · '+r.owner+' · '+labels[r.state]); draft=null; saving=false; readback=fail; go('detail',r.id); },150);
      }
    }));
    (main.querySelector('h2') || main).focus();
  }
  document.querySelector('.ds-skip').addEventListener('click', event => { event.preventDefault(); main.focus(); });
  $('scenario').addEventListener('change',() => {scenario=$('scenario').value; render();});
  $('theme').addEventListener('click',() => {const dark=document.documentElement.classList.toggle('dark'); document.documentElement.classList.toggle('light',!dark); $('theme').setAttribute('aria-pressed',String(dark)); $('theme').textContent=dark?'Giao diện sáng':'Giao diện tối';});
  $('reset').addEventListener('click',reset);
  window.addEventListener('hashchange',render);
  records=structuredClone(seed); render();
})();
