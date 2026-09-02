let db=null, me=null, profile=null, channel=null, reportTransactions=[], reportDocs=new Set(), allTransactions=[];
const $=s=>document.querySelector(s); const $$=s=>[...document.querySelectorAll(s)];
const money=n=>new Intl.NumberFormat('pt-BR',{style:'currency',currency:'BRL'}).format(Number(n||0));
const dateBR=s=>s?new Date(`${s}T12:00:00`).toLocaleDateString('pt-BR'):'—';
const todayISO=()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`};
const effectiveStatus=x=>{
  if(x.status==='paid') return 'paid';
  if(x.due_date && x.due_date < todayISO()) return 'overdue';
  return 'pending';
};
const statusLabel=s=>s==='paid'?'Pago':s==='overdue'?'Atrasado':'Pendente';
const categoryFor=x=>{
  const d=(x.description||'').toLowerCase();
  if(/mercad|supermerc|feira|açougue/.test(d)) return 'Mercado';
  if(/remed|farmac|médic|medic|dent|saúde|consulta/.test(d)) return 'Saúde';
  if(/faculd|curso|escola|livro/.test(d)) return 'Educação';
  if(/aluguel|condom|luz|água|agua|internet|telefone|conta/.test(d)) return 'Casa';
  if(/cartão|cartao|fatura/.test(d)) return 'Cartão';
  if(/combust|uber|99|ônibus|onibus|transporte/.test(d)) return 'Transporte';
  if(/restaur|lanche|ifood|comida|padaria/.test(d)) return 'Alimentação';
  if(/viagem|hotel|passagem/.test(d)) return 'Viagem';
  if(/roupa|vestido|sapato|tênis|tenis/.test(d)) return 'Roupas';
  return 'Outros';
};
const monthOf=x=>(x.due_date||x.created_at||'').slice(0,7);
let calendarCursor=new Date(new Date().getFullYear(),new Date().getMonth(),1);

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
 renderLocalModules();
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
   allTransactions=tx;
   reportTransactions=tx;

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

  const now=new Date();
  const currentMonth=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`;
  const monthTx=tx.filter(x=>monthOf(x)===currentMonth);
  const received=monthTx.filter(x=>x.type==='income'&&effectiveStatus(x)==='paid').reduce((s,x)=>s+Number(x.amount||0),0);
  const spent=monthTx.filter(x=>x.type==='expense'&&effectiveStatus(x)==='paid').reduce((s,x)=>s+Number(x.amount||0),0);
  const pendingIncome=monthTx.filter(x=>x.type==='income'&&effectiveStatus(x)!=='paid').reduce((s,x)=>s+Number(x.amount||0),0);
  const pendingExpense=monthTx.filter(x=>x.type==='expense'&&effectiveStatus(x)!=='paid').reduce((s,x)=>s+Number(x.amount||0),0);
  const projected=received+pendingIncome-spent-pendingExpense;
  const incAll=monthTx.filter(x=>x.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
  const expAll=monthTx.filter(x=>x.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
  $('#income').textContent=money(received);
  $('#expense').textContent=money(spent);
  $('#balance').textContent=money(received-spent);
  $('#pendingExpense').textContent=money(pendingExpense);
  $('#pendingIncome').textContent=money(pendingIncome);
  $('#goalCount').textContent=goals.length;
  $('#finCount').textContent=fin.filter(x=>x.status!=='paid').length;
  const max=Math.max(incAll,expAll,1);
  $('#incomeBar').style.height=Math.max(8,incAll/max*100)+'%';
  $('#expenseBar').style.height=Math.max(8,expAll/max*100)+'%';
  $('#health').textContent=projected>=0?'Saldo projetado positivo':'Abaixo do esperado';
  $('#heroBalance').textContent=money(received-spent);
  $('#projectedBalance').textContent=money(projected);
  $('#chartIncome').textContent=money(incAll);
  $('#chartExpense').textContent=money(expAll);
  $('#analysisValue').textContent=money(Math.max(0,received-spent));
  const pct=incAll?Math.max(0,Math.min(100,((incAll-expAll)/incAll)*100)):0;
  $('#economyPct').textContent=Math.round(pct)+'%';
  $('#economyRing').style.background=`conic-gradient(#18a96b 0 ${pct}%,#edf2f7 ${pct}% 100%)`;
  $('#analysisText').textContent=pendingExpense>0
    ? `Você tem ${money(pendingExpense)} em despesas a pagar${pendingIncome?` e ${money(pendingIncome)} a receber`:''}.`
    : received>spent?'Seu saldo realizado está positivo. Continue acompanhando as despesas.':'Registre receitas e despesas para acompanhar a evolução financeira.';
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

function txRow(x){
  const st=effectiveStatus(x);
  return `<div class="row ${x.type==='expense'?'expense-row':''}" data-id="${esc(x.id)}"><div><b>${esc(x.description)}</b><small>${dateBR(x.due_date)} · ${statusLabel(st)} · ${categoryFor(x)}</small></div><span class="amount ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</span></div>`
}
function txRowRecent(x){
  const st=effectiveStatus(x);
  return `<div class="row ${x.type==='expense'?'expense-row':''}"><div><b>${esc(x.description)}</b><small>${x.type==='income'?'Receita':'Despesa'} · ${dateBR(x.due_date)} · ${statusLabel(st)}${x.profiles?.full_name?' · '+esc(x.profiles.full_name):''}</small></div><span class="amount ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</span></div>`
}
function txRowFull(x){
  const isExpense=x.type==='expense';
  const st=effectiveStatus(x);
  const payBtn=isExpense && st!=='paid'?`<button class="pay-btn" onclick="payTx('${x.id}')">✓ Pagar</button>`:'';
  const pdfBtn=`<button class="pdf-btn" onclick="manageDocs('${x.id}')">📎 PDF</button>`;
  return `<div class="row transaction-row" data-type="${x.type}" data-status="${st}" data-search="${esc((x.description||'').toLowerCase())}">
    <div class="tx-main"><b>${esc(x.description)}</b><small>${isExpense?'Despesa':'Receita'} · ${dateBR(x.due_date)} · <span class="tx-status ${st}">${statusLabel(st)}</span>${x.profiles?.full_name?' · '+esc(x.profiles.full_name):''} · <span class="tx-category">${categoryFor(x)}</span></small></div>
    <div class="row-actions transaction-actions"><span class="amount ${x.type}">${isExpense?'-':''}${money(x.amount)}</span>${payBtn}<button class="edit-btn" onclick="editTx('${x.id}')">✏️ Editar</button>${pdfBtn}<button class="icon-btn" onclick="deleteTx('${x.id}')">🗑️</button></div>
  </div>`
}
function goalRow(g){const p=g.target_amount?Math.min(100,Number(g.current_amount)/Number(g.target_amount)*100):0;return `<div class="row"><div style="width:100%"><b>${esc(g.name)} <span class="goal-percent">${Math.round(p)}%</span></b><small>${money(g.current_amount)} de ${money(g.target_amount)}${g.deadline?' · até '+dateBR(g.deadline):''}</small><div class="progress"><span style="width:${p}%"></span></div></div></div>`}
function goalRowFull(g){return `<div class="goal-card">${goalRow(g)}<div class="goal-actions"><button onclick="addToGoal('${g.id}')">Adicionar valor</button><button class="danger" onclick="deleteGoal('${g.id}')">Excluir</button></div></div>`}
function renderCalendar(tx){
  const y=calendarCursor.getFullYear(), m=calendarCursor.getMonth();
  const first=new Date(y,m,1), last=new Date(y,m+1,0);
  const start=(first.getDay()+6)%7, daysInMonth=last.getDate();
  const monthKey=`${y}-${String(m+1).padStart(2,'0')}`;
  const todayKey=todayISO();
  const weekdays=['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'];
  $('#calendarMonth').textContent=new Date(y,m,1).toLocaleDateString('pt-BR',{month:'long',year:'numeric'});
  let h=weekdays.map(d=>`<div class="cal-weekday">${d}</div>`).join('');
  for(let i=0;i<start;i++) h+='<div class="cal-empty"></div>';
  for(let d=1;d<=daysInMonth;d++){
    const key=`${monthKey}-${String(d).padStart(2,'0')}`;
    const dayTx=tx.filter(x=>x.due_date===key);
    const income=dayTx.filter(x=>x.type==='income').length;
    const expense=dayTx.filter(x=>x.type==='expense').length;
    const total=dayTx.reduce((s,x)=>s+(x.type==='expense'?-1:1)*Number(x.amount||0),0);
    const classes=`cal-day ${dayTx.length?'has':''} ${key===todayKey?'today':''}`;
    h+=`<button class="${classes}" onclick="showCalendarDay('${key}')">
      <div class="cal-day-top"><b>${d}</b>${key===todayKey?'<span>Hoje</span>':''}</div>
      ${dayTx.length?`<div class="cal-events">${income?`<i class="income-dot">${income}</i>`:''}${expense?`<i class="expense-dot">${expense}</i>`:''}</div><small class="cal-total">${money(total)}</small>`:''}
    </button>`;
  }
  const cells=(start+daysInMonth)%7;if(cells)for(let i=cells;i<7;i++)h+='<div class="cal-empty"></div>';
  $('#calendar').innerHTML=h;
  const monthTx=tx.filter(x=>x.due_date&&x.due_date.startsWith(monthKey));
  $('#calendarList').innerHTML=monthTx.map(txRow).join('')||'<div class="empty">Nenhum vencimento neste mês.</div>';
}
window.showCalendarDay=key=>{
  const list=allTransactions.filter(x=>x.due_date===key);
  if(!list.length)return;
  const total=list.reduce((s,x)=>s+(x.type==='expense'?-1:1)*Number(x.amount||0),0);
  $('#modalContent').innerHTML=`<h3>${dateBR(key)}</h3><p class="doc-help">${list.length} lançamento(s) · saldo do dia ${money(total)}</p><div class="day-details">${list.map(x=>`<div class="day-detail"><div><b>${esc(x.description)}</b><small>${x.type==='expense'?'Despesa':'Receita'} · ${statusLabel(effectiveStatus(x))} · ${categoryFor(x)}</small></div><strong class="${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</strong></div>`).join('')}</div>`;
  $('#modal').classList.remove('hidden');
};
function applyTxFilter(){
  const type=$('#txFilter')?.value||'all';
  const status=$('#txStatusFilter')?.value||'all';
  const search=($('#txSearch')?.value||'').trim().toLowerCase();
  $$('#transactions .transaction-row').forEach(r=>{
    const okType=type==='all'||r.dataset.type===type;
    const okStatus=status==='all'||r.dataset.status===status;
    const okSearch=!search||(r.dataset.search||'').includes(search);
    r.style.display=okType&&okStatus&&okSearch?'':'none';
  });
}
async function loadReport(){
  // O Dashboard já carregou os lançamentos com sucesso. O relatório usa essa mesma lista,
  // evitando uma segunda consulta que pode ficar vazia por causa de permissões/RLS.
  reportTransactions=allTransactions||[];
  if(!reportTransactions.length){
    const {data,error}=await db.from('transactions').select('id,type,amount,description,status,due_date,paid_at,created_at').order('due_date',{ascending:false,nullsFirst:false});
    if(error){alert('Não foi possível carregar o relatório: '+error.message);return;}
    reportTransactions=data||[];
  }
  const dr=await db.from('documents').select('transaction_id');
  reportDocs=new Set((dr.data||[]).map(x=>x.transaction_id));
  // Ao abrir o relatório, mostrar tudo. O usuário pode escolher um mês no filtro.
  const monthInput=$('#reportMonth');
  if(monthInput && !monthInput.dataset.userChanged) monthInput.value='';
  renderReport();
}
function renderReport(){
  const month=$('#reportMonth')?.value||'';
  let tx=month?reportTransactions.filter(x=>(x.due_date||x.created_at||'').startsWith(month)):reportTransactions;
  const reportStatus=$('#reportStatus')?.value||'all';
  if(reportStatus!=='all') tx=tx.filter(x=>effectiveStatus(x)===reportStatus);
  const inc=tx.filter(x=>x.type==='income').reduce((s,x)=>s+Number(x.amount||0),0);
  const exp=tx.filter(x=>x.type==='expense').reduce((s,x)=>s+Number(x.amount||0),0);
  $('#reportIncome').textContent=money(inc);
  $('#reportExpense').textContent=money(exp);
  $('#reportBalance').textContent=money(inc-exp);
  $('#reportPaid').textContent=tx.filter(x=>effectiveStatus(x)==='paid').length;
  $('#reportPending').textContent=tx.filter(x=>effectiveStatus(x)==='pending').length;
  $('#reportOverdue').textContent=tx.filter(x=>effectiveStatus(x)==='overdue').length;
  $('#reportPeriodLabel').textContent=month?new Date(month+'-01T12:00:00').toLocaleDateString('pt-BR',{month:'long',year:'numeric'}):'Todos os períodos';
  $('#reportRows').innerHTML=tx.length?tx.map(x=>{
    const type=x.type==='income'?'Receita':'Despesa';
    const status=statusLabel(effectiveStatus(x));
    const pdf=reportDocs.has(x.id)?'📎 Sim':'—';
    return `<tr><td>${dateBR(x.due_date)}</td><td>${esc(x.description)}</td><td>${type}</td><td class="report-value ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</td><td><span class="tx-status ${effectiveStatus(x)}">${status}</span></td><td>${pdf}</td></tr>`;
  }).join(''):'<tr><td colspan="6" class="report-empty">Nenhum lançamento encontrado para o período.</td></tr>';
}
function printReport(){
  const report=$('#view-report');
  if(!report)return;
  const w=window.open('','_blank');
  if(!w){alert('Permita pop-ups no navegador para imprimir o relatório.');return;}
  w.document.write(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>Relatório Completo - Família Financeira</title><style>body{font-family:Arial,sans-serif;padding:28px;color:#172033}h1{margin:0 0 6px}p{color:#667085}.cards{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:20px 0}.card{border:1px solid #ddd;border-radius:10px;padding:12px}.card b{display:block;font-size:20px;margin-top:6px}table{width:100%;border-collapse:collapse;margin-top:18px}th,td{border:1px solid #ddd;padding:8px;text-align:left;font-size:12px}th{background:#f4f6f8}.num{text-align:right}@media print{button{display:none}}</style></head><body><h1>Relatório Completo</h1><p>Família Financeira · ${esc($('#reportPeriodLabel').textContent)}</p><div class="cards"><div class="card">Receitas<b>${esc($('#reportIncome').textContent)}</b></div><div class="card">Despesas<b>${esc($('#reportExpense').textContent)}</b></div><div class="card">Saldo<b>${esc($('#reportBalance').textContent)}</b></div><div class="card">Pagas<b>${esc($('#reportPaid').textContent)}</b></div><div class="card">Pendentes<b>${esc($('#reportPending').textContent)}</b></div><div class="card">Atrasadas<b>${esc($('#reportOverdue').textContent)}</b></div></div>${$('#view-report .report-table').outerHTML}</body></html>`);
  w.document.close();w.focus();setTimeout(()=>w.print(),300);
}
function showView(name){if(name==='accounts'||name==='cards'||name==='recurrences')renderLocalModules();$$('.view').forEach(v=>v.classList.add('hidden'));const target=$('#view-'+name);if(target)target.classList.remove('hidden');$$('.side-nav button,.mobile-nav button[data-view]').forEach(b=>b.classList.toggle('active',b.dataset.view===name));if(name==='report')loadReport();window.scrollTo({top:0,behavior:'smooth'});}
function openModal(type){
 if(type==='account') return openLocalEdit('account');
 if(type==='card') return openLocalEdit('card');
 if(type==='recurrence') return openLocalEdit('recurrence');
 let title='',html='';
 if(type==='transaction'){
  title='Novo lançamento';
  html=`<form id="txForm"><label>Tipo</label><select name="type"><option value="expense">Despesa</option><option value="income">Receita</option></select><label>Descrição</label><input name="description" required placeholder="Ex.: Supermercado"><label>Valor</label><input name="amount" type="number" step="0.01" min="0" required><label>Vencimento</label><input name="due_date" type="date"><label>Status</label><select name="status"><option value="pending">Pendente</option><option value="paid">Pago</option></select><p class="form-note">A categoria é identificada automaticamente pelo nome do lançamento. Você poderá editar o lançamento depois.</p><button class="primary">Salvar lançamento</button></form>`;
 }else{
  title='Nova meta';html=`<form id="goalForm"><label>Nome</label><input name="name" required placeholder="Ex.: Reserva de emergência"><label>Valor da meta</label><input name="target_amount" type="number" step="0.01" min="0.01" required><label>Valor já guardado</label><input name="current_amount" type="number" step="0.01" min="0" value="0"><label>Prazo</label><input name="deadline" type="date"><label>Descrição</label><textarea name="description" rows="3"></textarea><button class="primary">Salvar meta</button></form>`;
 }
 $('#modalContent').innerHTML=`<h3>${title}</h3>${html}`;$('#modal').classList.remove('hidden');$('#txForm')?.addEventListener('submit',saveTransaction);$('#goalForm')?.addEventListener('submit',saveGoal);
}
function closeModal(){$('#modal').classList.add('hidden')}
async function saveTransaction(e){
 e.preventDefault();
 const f=new FormData(e.target), payload={type:f.get('type'),description:f.get('description'),amount:Number(f.get('amount')),due_date:f.get('due_date')||null,status:f.get('status'),created_by:me.id,responsible_profile_id:me.id,paid_at:f.get('status')==='paid'?new Date().toISOString():null};
 const {error}=await db.from('transactions').insert(payload);if(error){alert(error.message);return;}closeModal();await loadAll();
}
window.editTx=async id=>{
 const x=allTransactions.find(t=>t.id===id); if(!x)return;
 $('#modalContent').innerHTML=`<h3>Editar lançamento</h3><form id="editTxForm">
 <label>Tipo</label><select name="type"><option value="expense" ${x.type==='expense'?'selected':''}>Despesa</option><option value="income" ${x.type==='income'?'selected':''}>Receita</option></select>
 <label>Descrição</label><input name="description" required value="${esc(x.description)}">
 <label>Valor</label><input name="amount" type="number" step="0.01" min="0" required value="${Number(x.amount||0)}">
 <label>Vencimento</label><input name="due_date" type="date" value="${x.due_date||''}">
 <label>Status</label><select name="status"><option value="pending" ${x.status==='pending'?'selected':''}>Pendente</option><option value="paid" ${x.status==='paid'?'selected':''}>Pago</option></select>
 <p class="form-note">Categoria identificada: <b>${esc(categoryFor(x))}</b></p>
 <button class="primary">Salvar alterações</button></form>`;
 $('#modal').classList.remove('hidden');
 $('#editTxForm').addEventListener('submit',async e=>{
   e.preventDefault();const f=new FormData(e.target);
   const payload={type:f.get('type'),description:f.get('description'),amount:Number(f.get('amount')),due_date:f.get('due_date')||null,status:f.get('status'),paid_at:f.get('status')==='paid'?(x.paid_at||new Date().toISOString()):null,updated_at:new Date().toISOString()};
   const {error}=await db.from('transactions').update(payload).eq('id',id);
   if(error){alert('Não foi possível editar: '+error.message);return;}closeModal();await loadAll();
 });
};
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
  if(up.error){alert('Não foi possível enviar o PDF. Verifique se o Storage do Supabase possui um bucket "documents" e as permissões de upload.\n'+up.error.message);return;}
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

/* =========================
   VERSÃO 2.2 — CONTAS, CARTÕES E RECORRÊNCIAS
   Persistência local: NÃO altera o Supabase.
========================= */
const localKey=()=>`ff22:${me?.id||'guest'}`;
const localState=()=>{try{return JSON.parse(localStorage.getItem(localKey())||'{}')}catch{return {}}};
function saveLocalState(st){st.version=2.2;localStorage.setItem(localKey(),JSON.stringify(st));}
function getLocal(){const st=localState();return {version:st.version||2.2,accounts:Array.isArray(st.accounts)?st.accounts:[],cards:Array.isArray(st.cards)?st.cards:[],recurrences:Array.isArray(st.recurrences)?st.recurrences:[],cardPurchases:Array.isArray(st.cardPurchases)?st.cardPurchases:[]}}
function escAttr(v){return esc(v).replace(/`/g,'&#096;')}
function localMoney(n){return money(Number(n||0))}
function installmentForMonth(p, month){
 const base=p.date||todayISO(), start=new Date(base+'T12:00:00');
 const target=new Date(month+'-01T12:00:00');
 const diff=(target.getFullYear()-start.getFullYear())*12+(target.getMonth()-start.getMonth());
 if(diff<0 || diff>=Number(p.installments||1)) return null;
 return {number:diff+1, amount:Number(p.installmentAmount||p.amount||0)};
}
function renderLocalModules(){
 const st=getLocal();
 const accountTotal=st.accounts.reduce((a,x)=>a+Number(x.balance||0),0);
 const limitTotal=st.cards.reduce((a,x)=>a+Number(x.limit||0),0);
 const currentMonth=todayISO().slice(0,7);
 const bills=st.cardPurchases.reduce((a,x)=>a+(installmentForMonth(x,currentMonth)?.amount||0),0);
 const dueSoon=st.recurrences.filter(r=>r.nextDate&&r.nextDate<=todayISO()).length;
 $('#accountsTotal').textContent=localMoney(accountTotal);
 $('#cardsLimitTotal').textContent=localMoney(limitTotal);
 $('#cardsBillsTotal').textContent=localMoney(bills);
 $('#recurrenceCount').textContent=st.recurrences.length;
 const accountList=$('#accountsList');
 if(accountList) accountList.innerHTML=st.accounts.length?st.accounts.map(a=>`<article class="local-card account-card"><div class="local-card-head"><span class="local-icon">${a.kind==='poupanca'?'🐷':a.kind==='dinheiro'?'💵':a.kind==='investimento'?'📈':'🏦'}</span><div><b>${esc(a.name)}</b><small>${esc(a.kindLabel||'Conta')}</small></div></div><strong>${localMoney(a.balance)}</strong><div class="local-actions"><button onclick="adjustAccount('${escAttr(a.id)}')">↕ Ajustar saldo</button><button onclick="editAccount('${escAttr(a.id)}')">✏️ Editar</button><button class="danger" onclick="deleteAccount('${escAttr(a.id)}')">Excluir</button></div></article>`).join(''):'<div class="empty">Nenhuma conta cadastrada. Adicione conta corrente, poupança, dinheiro ou investimento.</div>';
 const cardsList=$('#cardsList');
 if(cardsList) cardsList.innerHTML=st.cards.length?st.cards.map(c=>{
   const purchases=st.cardPurchases.filter(x=>x.cardId===c.id);
   const inst=purchases.map(x=>({x,inst:installmentForMonth(x,currentMonth)})).filter(v=>v.inst);
   const bill=inst.reduce((a,v)=>a+v.inst.amount,0); const limit=Number(c.limit||0); const avail=Math.max(0,limit-bill); const pct=limit?Math.min(100,bill/limit*100):0;
   return `<article class="local-card credit-card"><div class="credit-top"><div><span>${esc(c.name)}</span><small class="credit-owner">Fatura atual · ${dateBR((currentMonth+'-01'))}</small></div><b>💳</b></div><div class="credit-number">•••• ${esc(c.last4||'0000')}</div><div class="credit-values"><div><small>Limite</small><strong>${localMoney(limit)}</strong></div><div><small>Fatura</small><strong>${localMoney(bill)}</strong></div></div><div class="limit-bar"><span style="width:${pct}%"></span></div><small class="limit-help">Disponível: ${localMoney(avail)} · Venc. dia ${esc(c.dueDay||'—')}${c.closeDay?' · Fecha dia '+esc(c.closeDay):''}</small><div class="local-actions"><button onclick="addCardPurchase('${escAttr(c.id)}')">＋ Compra</button><button onclick="editCard('${escAttr(c.id)}')">✏️ Editar</button><button class="danger" onclick="deleteCard('${escAttr(c.id)}')">Excluir</button></div>${inst.length?`<div class="purchase-list"><b class="purchase-title">Compras na fatura</b>${inst.slice(0,8).map(v=>`<div><span>${esc(v.x.description)}${Number(v.x.installments||1)>1?` · ${v.inst.number}/${v.x.installments}`:''}</span><b>${localMoney(v.inst.amount)}</b></div>`).join('')}</div>`:'<div class="purchase-empty">Nenhuma compra nesta fatura.</div>'}</article>`;
 }).join(''):'<div class="empty">Nenhum cartão cadastrado. Cadastre um cartão para acompanhar limite, fatura e parcelas.</div>';
 const recList=$('#recurrencesList');
 if(recList) recList.innerHTML=st.recurrences.length?st.recurrences.map(r=>{const due=r.nextDate&&r.nextDate<=todayISO();return `<div class="row local-row"><div><b>${esc(r.description)} ${due?'<span class="due-badge">Gerar agora</span>':''}</b><small>${r.type==='income'?'Receita':'Despesa'} · ${localMoney(r.amount)} · ${frequencyLabel(r.frequency)} · próximo: ${dateBR(r.nextDate)||'—'}</small></div><div class="local-actions"><button class="generate-btn" onclick="generateRecurrence('${escAttr(r.id)}')">＋ Gerar</button><button onclick="editRecurrence('${escAttr(r.id)}')">✏️</button><button class="danger" onclick="deleteRecurrence('${escAttr(r.id)}')">🗑️</button></div></div>`}).join(''):'<div class="empty">Nenhuma recorrência cadastrada. Exemplos: aluguel, internet, salário ou assinatura.</div>';
 const hint=$('#recurrenceHint'); if(hint) hint.textContent=dueSoon?`${dueSoon} recorrência(s) pronta(s) para gerar.`:'As regras ficam somente neste navegador.';
}
function frequencyLabel(f){return f==='weekly'?'Toda semana':f==='yearly'?'Todo ano':'Todo mês'}
function localModal(title,form){$('#modalContent').innerHTML=`<h3>${title}</h3>${form}`;$('#modal').classList.remove('hidden')}
function openLocalEdit(type,obj){
 if(type==='account'){localModal(obj?'Editar conta':'Nova conta',`<form id="localAccountForm"><label>Nome</label><input name="name" required value="${escAttr(obj?.name||'')}"><label>Tipo</label><select name="kind"><option value="corrente" ${obj?.kind==='corrente'?'selected':''}>Conta corrente</option><option value="poupanca" ${obj?.kind==='poupanca'?'selected':''}>Poupança</option><option value="dinheiro" ${obj?.kind==='dinheiro'?'selected':''}>Dinheiro</option><option value="investimento" ${obj?.kind==='investimento'?'selected':''}>Investimento</option><option value="outro" ${obj?.kind==='outro'?'selected':''}>Outra</option></select><label>Saldo atual</label><input name="balance" type="number" step="0.01" value="${Number(obj?.balance||0)}"><button class="primary">Salvar conta</button></form>`);$('#localAccountForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),st=getLocal();const item={id:obj?.id||crypto.randomUUID(),name:f.get('name'),kind:f.get('kind'),kindLabel:{corrente:'Conta corrente',poupanca:'Poupança',dinheiro:'Dinheiro',investimento:'Investimento',outro:'Outra'}[f.get('kind')],balance:Number(f.get('balance')||0)};if(obj)st.accounts=st.accounts.map(x=>x.id===obj.id?item:x);else st.accounts.unshift(item);saveLocalState(st);closeModal();renderLocalModules()}}
 if(type==='card'){localModal(obj?'Editar cartão':'Novo cartão',`<form id="localCardForm"><label>Nome do cartão</label><input name="name" required placeholder="Ex.: Nubank" value="${escAttr(obj?.name||'')}"><label>Últimos 4 dígitos</label><input name="last4" maxlength="4" inputmode="numeric" value="${escAttr(obj?.last4||'')}"><label>Limite</label><input name="limit" type="number" step="0.01" min="0" required value="${Number(obj?.limit||0)}"><label>Dia do vencimento</label><input name="dueDay" type="number" min="1" max="31" value="${escAttr(obj?.dueDay||'10')}"><label>Dia do fechamento</label><input name="closeDay" type="number" min="1" max="31" value="${escAttr(obj?.closeDay||'')}"><button class="primary">Salvar cartão</button></form>`);$('#localCardForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),st=getLocal();const item={id:obj?.id||crypto.randomUUID(),name:f.get('name'),last4:f.get('last4'),limit:Number(f.get('limit')||0),dueDay:f.get('dueDay'),closeDay:f.get('closeDay')};if(obj)st.cards=st.cards.map(x=>x.id===obj.id?item:x);else st.cards.unshift(item);saveLocalState(st);closeModal();renderLocalModules()}}
 if(type==='recurrence'){localModal(obj?'Editar recorrência':'Nova recorrência',`<form id="localRecForm"><label>Tipo</label><select name="type"><option value="expense" ${obj?.type!=='income'?'selected':''}>Despesa</option><option value="income" ${obj?.type==='income'?'selected':''}>Receita</option></select><label>Descrição</label><input name="description" required placeholder="Ex.: Aluguel" value="${escAttr(obj?.description||'')}"><label>Valor</label><input name="amount" type="number" step="0.01" min="0" required value="${Number(obj?.amount||0)}"><label>Frequência</label><select name="frequency"><option value="monthly" ${obj?.frequency!=='weekly'&&obj?.frequency!=='yearly'?'selected':''}>Todo mês</option><option value="weekly" ${obj?.frequency==='weekly'?'selected':''}>Toda semana</option><option value="yearly" ${obj?.frequency==='yearly'?'selected':''}>Todo ano</option></select><label>Próxima data</label><input name="nextDate" type="date" value="${escAttr(obj?.nextDate||todayISO())}"><p class="form-note">A regra fica salva apenas neste navegador. “Gerar” cria um lançamento real na tabela <b>transactions</b> do Supabase.</p><button class="primary">Salvar recorrência</button></form>`);$('#localRecForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),st=getLocal();const item={id:obj?.id||crypto.randomUUID(),type:f.get('type'),description:f.get('description'),amount:Number(f.get('amount')||0),frequency:f.get('frequency'),nextDate:f.get('nextDate')||todayISO()};if(obj)st.recurrences=st.recurrences.map(x=>x.id===obj.id?item:x);else st.recurrences.unshift(item);saveLocalState(st);closeModal();renderLocalModules()}}
}
window.adjustAccount=id=>{const st=getLocal(),x=st.accounts.find(x=>x.id===id);if(!x)return;const v=prompt(`Novo saldo para ${x.name}:`,Number(x.balance||0).toFixed(2));if(v===null)return;const n=Number(String(v).replace(',','.'));if(!Number.isFinite(n))return alert('Informe um saldo válido.');x.balance=n;saveLocalState(st);renderLocalModules()};
window.editAccount=id=>{const x=getLocal().accounts.find(x=>x.id===id);if(x)openLocalEdit('account',x)};
window.deleteAccount=id=>{if(!confirm('Excluir esta conta local?'))return;const st=getLocal();st.accounts=st.accounts.filter(x=>x.id!==id);saveLocalState(st);renderLocalModules()};
window.editCard=id=>{const x=getLocal().cards.find(x=>x.id===id);if(x)openLocalEdit('card',x)};
window.deleteCard=id=>{if(!confirm('Excluir este cartão local e suas compras locais?'))return;const st=getLocal();st.cards=st.cards.filter(x=>x.id!==id);st.cardPurchases=st.cardPurchases.filter(x=>x.cardId!==id);saveLocalState(st);renderLocalModules()};
window.addCardPurchase=id=>{const c=getLocal().cards.find(x=>x.id===id);if(!c)return;localModal('Nova compra no cartão',`<form id="purchaseForm"><label>Descrição</label><input name="description" required placeholder="Ex.: Mercado"><label>Valor total da compra</label><input name="amount" type="number" step="0.01" min="0.01" required><label>Data da compra</label><input name="date" type="date" value="${todayISO()}"><label>Parcelas</label><input name="installments" type="number" min="1" max="60" value="1"><div class="installment-preview" id="installmentPreview">1x de R$ 0,00</div><p class="form-note">A compra e as parcelas ficam somente neste navegador. Nenhuma tabela do Supabase é criada ou alterada.</p><button class="primary">Adicionar compra</button></form>`);const updateInstallmentPreview=()=>{const total=Number($('#purchaseForm [name=amount]')?.value||0),n=Math.max(1,Number($('#purchaseForm [name=installments]')?.value||1));$('#installmentPreview').textContent=`${n}x de ${localMoney(total/n)}`};$('#purchaseForm [name=amount]')?.addEventListener('input',updateInstallmentPreview);$('#purchaseForm [name=installments]')?.addEventListener('input',updateInstallmentPreview);updateInstallmentPreview();$('#purchaseForm').onsubmit=e=>{e.preventDefault();const f=new FormData(e.target),total=Number(f.get('amount')),n=Math.max(1,Number(f.get('installments')||1)),st=getLocal();st.cardPurchases.unshift({id:crypto.randomUUID(),cardId:id,description:f.get('description'),amount:total,installmentAmount:total/n,date:f.get('date')||todayISO(),installments:n});saveLocalState(st);closeModal();renderLocalModules()}}
window.generateCardTx=async id=>{};
window.generateRecurrence=async id=>{const r=getLocal().recurrences.find(x=>x.id===id);if(!r)return;if(!confirm(`Gerar ${r.type==='income'?'a receita':'a despesa'} “${r.description}” de ${localMoney(r.amount)} no financeiro?`))return;const payload={type:r.type,description:r.description,amount:Number(r.amount),due_date:r.nextDate||todayISO(),status:'pending',created_by:me.id,responsible_profile_id:me.id};const {error}=await db.from('transactions').insert(payload);if(error){alert('Não foi possível gerar o lançamento: '+error.message);return;}const d=new Date(`${r.nextDate||todayISO()}T12:00:00`);if(r.frequency==='weekly')d.setDate(d.getDate()+7);else if(r.frequency==='yearly')d.setFullYear(d.getFullYear()+1);else d.setMonth(d.getMonth()+1);const st=getLocal();st.recurrences=st.recurrences.map(x=>x.id===id?{...x,nextDate:`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}:x);saveLocalState(st);await loadAll();renderLocalModules();alert('Lançamento criado com sucesso.')};
window.editRecurrence=id=>{const x=getLocal().recurrences.find(x=>x.id===id);if(x)openLocalEdit('recurrence',x)};
window.deleteRecurrence=id=>{if(!confirm('Excluir esta recorrência local?'))return;const st=getLocal();st.recurrences=st.recurrences.filter(x=>x.id!==id);saveLocalState(st);renderLocalModules()};
window.openAccountModal=()=>openLocalEdit('account');window.openCardModal=()=>openLocalEdit('card');window.openRecurrenceModal=()=>openLocalEdit('recurrence');
window.openCardDetails=id=>{const st=getLocal(),c=st.cards.find(x=>x.id===id);if(!c)return;const purchases=st.cardPurchases.filter(x=>x.cardId===id);localModal(`Detalhes · ${esc(c.name)}`,`<div class="card-detail-summary"><b>Limite</b><strong>${localMoney(c.limit)}</strong><b>Vencimento</b><strong>Dia ${esc(c.dueDay||'—')}</strong></div><div class="purchase-list light">${purchases.length?purchases.map(p=>`<div><span>${esc(p.description)} · ${p.installments}x</span><b>${localMoney(p.amount)}</b></div>`).join(''):'<div class="empty">Nenhuma compra cadastrada.</div>'}</div>`)};

window.mobileMore=()=>{localModal('Mais opções',`<div class="more-menu"><button onclick="closeModal();showView('calendar')">📅 Calendário</button><button onclick="closeModal();showView('goals')">🎯 Metas</button><button onclick="closeModal();showView('report')">📊 Relatório completo</button><button onclick="closeModal();showView('recurrences')">↻ Recorrências</button><button onclick="closeModal();showView('profile')">👤 Perfil</button></div>`)};

function showError(m){console.error(m);alert(m)}
$('#loginBtn').onclick=login;$('#password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('#logoutBtn').onclick=async()=>{await db.auth.signOut();location.reload()}; $('#logoutSide').onclick=async()=>{await db.auth.signOut();location.reload()};$('#quickAdd').onclick=()=>openModal('transaction'); $('#quickAddTop').onclick=()=>openModal('transaction'); $('#mobileAdd').onclick=()=>openModal('transaction');$('#mobileMore')?.addEventListener('click',mobileMore);$('#closeModal').onclick=closeModal;$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});$('#txFilter').addEventListener('change',applyTxFilter);$('#txStatusFilter')?.addEventListener('change',applyTxFilter);$('#txSearch')?.addEventListener('input',applyTxFilter);$('#reportMonth')?.addEventListener('change',e=>{e.target.dataset.userChanged='1';renderReport();});$('#reportStatus')?.addEventListener('change',renderReport);$('#reportAllBtn')?.addEventListener('click',()=>{ $('#reportMonth').value=''; renderReport(); });$('#reportPrintBtn')?.addEventListener('click',printReport);$('#prevMonth')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar(allTransactions);});$('#nextMonth')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar(allTransactions);});$$('.nav button,.side-nav button,.mobile-nav button[data-view],.hero-button,[data-view]').forEach(b=>{if(b.dataset.view)b.onclick=()=>showView(b.dataset.view)});$$('[data-open]').forEach(b=>b.onclick=()=>openModal(b.dataset.open));start();
