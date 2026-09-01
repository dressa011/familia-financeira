let db=null, me=null, profile=null, channel=null;
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const dateBR=s=>s?new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const esc=v=>String(v??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[m]));
const fmtDateTime=s=>new Date(s).toLocaleString('pt-BR');

async function start(){
 const ok=window.supabase&&window.SUPABASE_URL&&!window.SUPABASE_URL.startsWith('COLE_')&&window.SUPABASE_ANON_KEY&&!window.SUPABASE_ANON_KEY.startsWith('COLE_');
 if(!ok){$('#loginMsg').textContent='Configure a URL e a chave ANON do Supabase em config.js.';return;}
 db=window.supabase.createClient(window.SUPABASE_URL,window.SUPABASE_ANON_KEY);
 const {data,error}=await db.auth.getSession(); if(error){showError(error.message);return;} if(data.session){me=data.session.user;await openApp();}
}
async function login(){
 const email=$('#email').value.trim(), password=$('#password').value;
 if(!email||!password){$('#loginMsg').textContent='Informe e-mail e senha.';return;}
 $('#loginBtn').disabled=true;$('#loginBtn').textContent='Entrando...';
 const {data,error}=await db.auth.signInWithPassword({email,password});
 $('#loginBtn').disabled=false;$('#loginBtn').textContent='Entrar';
 if(error){$('#loginMsg').textContent=error.message.includes('Invalid login')?'E-mail ou senha incorretos.':error.message;return;}
 me=data.user;await openApp();
}
async function openApp(){
 $('#login').classList.add('hidden');$('#app').classList.remove('hidden');
 const {data:p,error}=await db.from('profiles').select('*').eq('id',me.id).maybeSingle();
 if(error){showError('Erro ao carregar seu perfil: '+error.message);return;}
 if(!p){$('#login').classList.remove('hidden');$('#app').classList.add('hidden');$('#loginMsg').textContent='Seu usuário foi criado no Auth, mas ainda não possui perfil na tabela profiles. Execute o cadastro indicado no README.';return;}
 profile=p; $('#userName').textContent=p.full_name; $('#profileName').textContent=p.full_name; $('#profileEmail').textContent=me.email||''; $('#profileRole').textContent=p.role==='admin'?'Administrador (ADM)':'Membro da família'; $('#avatarLetter').textContent=(p.full_name||'F').trim().charAt(0).toUpperCase(); $('#profileAvatar').textContent=(p.full_name||'F').trim().charAt(0).toUpperCase(); $('#roleMini').textContent=p.role==='admin'?'Administrador':'Membro da família';
 $('#month').textContent=new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'}); $('#calendarMonth').textContent=new Date().toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
 $$('.admin-only').forEach(x=>x.classList.toggle('hidden',p.role!=='admin'));
 await loadAll();
 if(channel)db.removeChannel(channel);
 channel=db.channel('family-dashboard').on('postgres_changes',{event:'*',schema:'public',table:'transactions'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'goals'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'financings'},loadAll).subscribe();
}
async function loadAll(){
  try {
  // Carrega cada conjunto de dados de forma independente para que um recurso
  // opcional (ex.: auditoria) não impeça Finanças/Calendário de aparecerem.
  const results = await Promise.all([
    db.from('transactions').select('id,type,amount,description,status,due_date,paid_at,created_at,created_by,responsible_profile_id').order('due_date',{ascending:true,nullsFirst:false}),
    db.from('goals').select('*').order('created_at',{ascending:false}),
    db.from('financings').select('*').order('created_at',{ascending:false}),
    profile?.role === 'admin'
      ? db.from('audit_logs').select('action,entity_type,details,created_at,actor_id').order('created_at',{ascending:false}).limit(8)
      : Promise.resolve({data:[],error:null})
  ]);

  const [t,g,f,l]=results;
  if(t.error){
    console.error('transactions:',t.error);
    setDataError('Não foi possível carregar os lançamentos: '+t.error.message);
  }
  if(g.error) console.error('goals:',g.error);
  if(f.error) console.error('financings:',f.error);
  if(l.error) console.error('audit_logs:',l.error);

  const tx=t.data||[], goals=g.data||[], fin=f.data||[], logs=l.data||[];

  // Busca os nomes separadamente, evitando dependência do nome interno de uma FK.
  const ids=[...new Set([
    ...tx.map(x=>x.created_by), ...tx.map(x=>x.responsible_profile_id), ...logs.map(x=>x.actor_id)
  ].filter(Boolean))];
  let names={};
  if(ids.length){
    const pr=await db.from('profiles').select('id,full_name').in('id',ids);
    if(!pr.error) (pr.data||[]).forEach(x=>names[x.id]=x.full_name);
  }
  tx.forEach(x=>x.profiles={full_name:names[x.created_by]||names[x.responsible_profile_id]||''});
  logs.forEach(x=>x.profiles={full_name:names[x.actor_id]||''});

  const inc=tx.filter(x=>x.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
  const exp=tx.filter(x=>x.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
  $('#income').textContent=money(inc);
  $('#expense').textContent=money(exp);
  $('#balance').textContent=money(inc-exp);
  $('#goalCount').textContent=goals.length;
  $('#finCount').textContent=fin.filter(x=>x.status!=='paid').length;
  const max=Math.max(inc,exp,1);
  $('#incomeBar').style.height=Math.max(8,inc/max*100)+'%';
  $('#expenseBar').style.height=Math.max(8,exp/max*100)+'%';
  $('#health').textContent=inc>exp?'Saudável':inc===exp?'Atenção':'Abaixo do esperado';
  $('#heroBalance').textContent=money(inc-exp);
  $('#chartIncome').textContent=money(inc);
  $('#chartExpense').textContent=money(exp);
  $('#analysisValue').textContent=money(Math.max(0,inc-exp));
  const pct=inc?Math.max(0,Math.min(100,((inc-exp)/inc)*100)):0;
  $('#economyPct').textContent=Math.round(pct)+'%';
  $('#economyRing').style.background=`conic-gradient(#18a96b 0 ${pct}%,#edf2f7 ${pct}% 100%)`;
  $('#analysisText').textContent=inc>exp?'Seu saldo está positivo. Continue acompanhando as despesas para manter esse ritmo.':'Registre suas receitas e despesas para acompanhar a evolução financeira da família.';

  const upcoming=tx.filter(x=>x.due_date).slice(0,6);
  $('#upcoming').innerHTML=upcoming.length?upcoming.map(txRow).join(''):'<div class="empty">Nenhum vencimento cadastrado.</div>';
  $('#goals').innerHTML=goals.slice(0,4).map(goalRow).join('')||'<div class="empty">Nenhuma meta cadastrada.</div>';
  $('#recentTransactions').innerHTML=tx.slice(0,5).map(x=>txRowRecent(x)).join('')||'<div class="empty">Nenhum lançamento cadastrado.</div>';
  $('#goalsFull').innerHTML=goals.map(goalRowFull).join('')||'<div class="empty">Nenhuma meta cadastrada.</div>';
  $('#transactions').innerHTML=tx.map(txRowFull).join('')||'<div class="empty">Nenhum lançamento cadastrado. Clique em “＋ Lançamento” para adicionar.</div>';
  $('#activity').innerHTML=logs.map(x=>`<div class="row"><div><b>${esc(x.profiles?.full_name||'Usuário')}</b><small>${esc(x.action)} · ${esc(x.entity_type||'')}</small></div><small>${fmtDateTime(x.created_at)}</small></div>`).join('')||'<div class="empty">Nenhuma atividade.</div>';
  renderCalendar(tx);
  applyTxFilter();
  } catch (err) {
    console.error('loadAll:', err);
    setDataError('Erro ao carregar o painel: '+(err?.message||err));
  }
}
function setDataError(message){
  const ids=['transactions','calendarList','recentTransactions','upcoming'];
  ids.forEach(id=>{const el=$('#'+id); if(el && !el.dataset.hasDataError){el.innerHTML='<div class="empty error-empty">'+esc(message)+'</div>';}});
}

function txRow(x){return `<div class="row ${x.type==='expense'?'expense-row':''}"><div><b>${esc(x.description)}</b><small>${dateBR(x.due_date)} · ${x.status==='paid'?'Pago':x.status==='overdue'?'Atrasado':'Pendente'}</small></div><span class="amount ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</span></div>`}
function txRowRecent(x){return `<div class="row ${x.type==='expense'?'expense-row':''}"><div><b>${esc(x.description)}</b><small>${x.type==='income'?'Receita':'Despesa'} · ${dateBR(x.due_date)}${x.profiles?.full_name?' · '+esc(x.profiles.full_name):''}</small></div><span class="amount ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</span></div>`}
function txRowFull(x){
  const isExpense=x.type==='expense';
  const status=x.status==='paid'?'Pago':x.status==='overdue'?'Atrasado':'Pendente';
  const payBtn=isExpense && x.status!=='paid'?`<button class="pay-btn" onclick="payTx('${x.id}')">✓ Pagar</button>`:'';
  const pdfBtn=`<button class="pdf-btn" onclick="manageDocs('${x.id}')">📎 PDF</button>`;
  return `<div class="row transaction-row"><div><b>${esc(x.description)}</b><small>${isExpense?'Despesa':'Receita'} · ${dateBR(x.due_date)} · <span class="tx-status ${x.status}">${status}</span>${x.profiles?.full_name?' · '+esc(x.profiles.full_name):''}</small></div><div class="row-actions transaction-actions"><span class="amount ${x.type}">${isExpense?'-':''}${money(x.amount)}</span>${payBtn}${pdfBtn}<button class="icon-btn" onclick="deleteTx('${x.id}')">🗑️</button></div></div>`
}
function goalRow(g){const p=g.target_amount?Math.min(100,Number(g.current_amount)/Number(g.target_amount)*100):0;return `<div class="row"><div style="width:100%"><b>${esc(g.name)} <span class="goal-percent">${Math.round(p)}%</span></b><small>${money(g.current_amount)} de ${money(g.target_amount)}${g.deadline?' · até '+dateBR(g.deadline):''}</small><div class="progress"><span style="width:${p}%"></span></div></div></div>`}
function goalRowFull(g){return `<div class="goal-card">${goalRow(g)}<div class="goal-actions"><button onclick="addToGoal('${g.id}')">Adicionar valor</button><button class="danger" onclick="deleteGoal('${g.id}')">Excluir</button></div></div>`}
function renderCalendar(tx){
  const now=new Date(), y=now.getFullYear(), m=now.getMonth();
  const first=new Date(y,m,1), last=new Date(y,m+1,0);
  // O calendário começa na segunda-feira e termina no domingo.
  // JavaScript retorna domingo=0; aqui convertemos para segunda=0 ... domingo=6.
  const start=(first.getDay()+6)%7;
  const daysInMonth=last.getDate();
  const monthKey=`${y}-${String(m+1).padStart(2,'0')}`;
  const todayKey=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const weekdays=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  let h=weekdays.map(d=>`<div class="cal-weekday">${d}</div>`).join('');
  for(let i=0;i<start;i++) h+='<div class="cal-empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const key=`${monthKey}-${String(d).padStart(2,'0')}`;
    const dayTx=tx.filter(x=>x.due_date===key);
    const count=dayTx.length;
    const income=dayTx.filter(x=>x.type==='income').length;
    const expense=dayTx.filter(x=>x.type==='expense').length;
    const classes=`cal-day ${count?'has':''} ${key===todayKey?'today':''}`;
    h+=`<div class="${classes}" title="${count?`${count} lançamento${count>1?'s':''}`:'Sem lançamentos'}">
      <div class="cal-day-top"><b>${d}</b>${key===todayKey?'<span>Hoje</span>':''}</div>
      ${count?`<div class="cal-events">
        ${income?`<i class="income-dot">${income}</i>`:''}
        ${expense?`<i class="expense-dot">${expense}</i>`:''}
      </div>`:''}
    </div>`;
  }
  // Completa a última semana para manter o calendário visualmente alinhado.
  const cells=(start+daysInMonth)%7;
  if(cells) for(let i=cells;i<7;i++) h+='<div class="cal-empty"></div>';
  $('#calendar').innerHTML=h;
  const monthTx=tx.filter(x=>x.due_date&&x.due_date.startsWith(monthKey));
  $('#calendarList').innerHTML=monthTx.map(txRow).join('')||'<div class="empty">Nenhum vencimento neste mês.</div>';
}
function applyTxFilter(){const f=$('#txFilter').value; $$('#transactions .row').forEach(r=>{const txt=r.textContent; r.style.display=f==='all'||(f==='income'&&txt.includes('Receita'))||(f==='expense'&&txt.includes('Despesa'))?'':'none';});}
function showView(name){$$('.view').forEach(v=>v.classList.add('hidden'));const target=$('#view-'+name);if(target)target.classList.remove('hidden');$$('.side-nav button,.mobile-nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));window.scrollTo({top:0,behavior:'smooth'});}
function openModal(type){let title='',html='';if(type==='transaction'){title='Novo lançamento';html=`<form id="txForm"><label>Tipo</label><select name="type"><option value="expense">Despesa</option><option value="income">Receita</option></select><label>Descrição</label><input name="description" required placeholder="Ex.: Supermercado"><label>Valor</label><input name="amount" type="number" step="0.01" min="0" required><label>Vencimento</label><input name="due_date" type="date"><label>Status</label><select name="status"><option value="pending">Pendente</option><option value="paid">Pago</option></select><button class="primary">Salvar lançamento</button></form>`}else{title='Nova meta';html=`<form id="goalForm"><label>Nome</label><input name="name" required placeholder="Ex.: Reserva de emergência"><label>Valor da meta</label><input name="target_amount" type="number" step="0.01" min="0.01" required><label>Valor já guardado</label><input name="current_amount" type="number" step="0.01" min="0" value="0"><label>Prazo</label><input name="deadline" type="date"><label>Descrição</label><textarea name="description" rows="3"></textarea><button class="primary">Salvar meta</button></form>`}$('#modalContent').innerHTML=`<h3>${title}</h3>${html}`;$('#modal').classList.remove('hidden');$('#txForm')?.addEventListener('submit',saveTransaction);$('#goalForm')?.addEventListener('submit',saveGoal)}
function closeModal(){$('#modal').classList.add('hidden')}
async function saveTransaction(e){e.preventDefault();const f=new FormData(e.target), payload={type:f.get('type'),description:f.get('description'),amount:Number(f.get('amount')),due_date:f.get('due_date')||null,status:f.get('status'),created_by:me.id,responsible_profile_id:me.id,paid_at:f.get('status')==='paid'?new Date().toISOString():null};const {error}=await db.from('transactions').insert(payload);if(error){alert(error.message);return;}closeModal();await loadAll();}
async function saveGoal(e){e.preventDefault();const f=new FormData(e.target),payload={name:f.get('name'),description:f.get('description')||null,target_amount:Number(f.get('target_amount')),current_amount:Number(f.get('current_amount')||0),deadline:f.get('deadline')||null,created_by:me.id};const {error}=await db.from('goals').insert(payload);if(error){alert(error.message);return;}closeModal();await loadAll();}

window.payTx=async id=>{
  if(!confirm('Marcar esta despesa como PAGA? Ela continuará no histórico.')) return;
  const {error}=await db.from('transactions').update({status:'paid',paid_at:new Date().toISOString(),updated_at:new Date().toISOString()}).eq('id',id).eq('type','expense');
  if(error) alert('Não foi possível marcar como paga: '+error.message); else await loadAll();
};
window.manageDocs=async id=>{
  const {data,error}=await db.from('documents').select('id,file_name,storage_path,created_at').eq('transaction_id',id).order('created_at',{ascending:false});
  if(error){alert('Não foi possível carregar os PDFs: '+error.message);return;}
  let html='<h3>PDF / Comprovante</h3><p class="doc-help">Escolha um PDF para anexar especificamente a este lançamento.</p><input id="docFile" type="file" accept="application/pdf,.pdf">';
  if((data||[]).length){html+='<div class="doc-list">'+data.map(d=>`<div class="doc-item"><span>📄 ${esc(d.file_name)}</span><button class="secondary" onclick="openDoc('${d.id}')">Abrir</button></div>`).join('')+'</div>';} else html+='<p class="empty">Nenhum PDF anexado.</p>';
  $('#modalContent').innerHTML=html; $('#modal').classList.remove('hidden');
  $('#docFile').addEventListener('change',e=>uploadDoc(id,e.target.files[0]));
};
window.uploadDoc=async (transactionId,file)=>{
  if(!file)return; if(file.type!=='application/pdf' && !file.name.toLowerCase().endsWith('.pdf')){alert('Selecione somente um arquivo PDF.');return;}
  if(file.size>10*1024*1024){alert('O PDF deve ter no máximo 10 MB.');return;}
  const path=`${me.id}/${transactionId}/${Date.now()}-${file.name.replace(/[^a-zA-Z0-9._-]/g,'_')}`;
  const up=await db.storage.from('documents').upload(path,file,{contentType:'application/pdf',upsert:false});
  if(up.error){alert('Não foi possível enviar o PDF. Verifique se o Storage do Supabase possui um bucket "documents" e as permissões de upload.

'+up.error.message);return;}
  const ins=await db.from('documents').insert({transaction_id:transactionId,file_name:file.name,storage_path:path,uploaded_by:me.id});
  if(ins.error){await db.storage.from('documents').remove([path]);alert('O PDF foi enviado, mas não foi possível registrar o comprovante: '+ins.error.message);return;}
  alert('PDF anexado com sucesso!'); await manageDocs(transactionId);
};
window.openDoc=async id=>{
  const {data,error}=await db.from('documents').select('storage_path,file_name').eq('id',id).single();
  if(error){alert(error.message);return;}
  const r=await db.storage.from('documents').createSignedUrl(data.storage_path,300);
  if(r.error){alert('Não foi possível abrir o PDF: '+r.error.message);return;}
  window.open(r.data.signedUrl,'_blank','noopener');
};

window.deleteTx=async id=>{if(!confirm('Excluir este lançamento?'))return;const {error}=await db.from('transactions').delete().eq('id',id);if(error)alert(error.message);else await loadAll()};
window.deleteGoal=async id=>{if(!confirm('Excluir esta meta?'))return;const {error}=await db.from('goals').delete().eq('id',id);if(error)alert(error.message);else await loadAll()};
window.addToGoal=async id=>{const v=prompt('Quanto deseja adicionar à meta?');if(v===null)return;const n=Number(v);if(!n||n<0)return alert('Informe um valor válido.');const {data,error}=await db.from('goals').select('current_amount').eq('id',id).single();if(error)return alert(error.message);const r=await db.from('goals').update({current_amount:Number(data.current_amount)+n,updated_at:new Date().toISOString()}).eq('id',id);if(r.error)alert(r.error.message);else await loadAll()};
function showError(m){console.error(m);alert(m)}
$('#loginBtn').onclick=login;$('#password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('#logoutBtn').onclick=async()=>{await db.auth.signOut();location.reload()}; $('#logoutSide').onclick=async()=>{await db.auth.signOut();location.reload()};$('#quickAdd').onclick=()=>openModal('transaction'); $('#quickAddTop').onclick=()=>openModal('transaction'); $('#mobileAdd').onclick=()=>openModal('transaction');$('#closeModal').onclick=closeModal;$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});$('#txFilter').addEventListener('change',applyTxFilter);$$('.nav button,.side-nav button,.mobile-nav button[data-view],.hero-button,[data-view]').forEach(b=>{if(b.dataset.view)b.onclick=()=>showView(b.dataset.view)});$$('[data-open]').forEach(b=>b.onclick=()=>openModal(b.dataset.open));start();
