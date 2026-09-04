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
const statusLabel=(s,x)=>x?.type==='income'&&s==='paid'?'Recebido':s==='paid'?'Pago':s==='overdue'?'Atrasado':'Pendente';
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
 channel=db.channel('family-dashboard').on('postgres_changes',{event:'*',schema:'public',table:'transactions'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'goals'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'financings'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'accounts'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'cards'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'card_purchases'},loadAll).on('postgres_changes',{event:'*',schema:'public',table:'recurrences'},loadAll).subscribe();
}
async function loadAll(){
  try {
  // Carrega cada conjunto de dados de forma independente para que um recurso
  // opcional (ex.: auditoria) não impeça Finanças/Calendário de aparecerem.
  const results = await Promise.all([
    db.from('transactions').select('id,type,amount,description,status,due_date,paid_at,created_at,created_by,responsible_profile_id,account_id,card_id,card_purchase_id,recurrence_id,installment_number,installments').eq('created_by',me.id).order('due_date',{ascending:true,nullsFirst:false}),
    db.from('goals').select('*').eq('created_by',me.id).order('created_at',{ascending:false}),
    db.from('financings').select('*').eq('created_by',me.id).order('created_at',{ascending:false}),
    db.from('accounts').select('*').eq('created_by',me.id).order('created_at',{ascending:false}),
    db.from('cards').select('*').eq('created_by',me.id).order('created_at',{ascending:false}),
    db.from('card_purchases').select('*').eq('created_by',me.id).order('purchase_date',{ascending:false}),
    db.from('recurrences').select('*').eq('created_by',me.id).order('next_date',{ascending:true}),
    profile?.role === 'admin'
      ? db.from('audit_logs').select('action,entity_type,details,created_at,actor_id').eq('actor_id',me.id).order('created_at',{ascending:false}).limit(8)
      : Promise.resolve({data:[],error:null})
  ]);

  const [t,g,f,a,c,cp,r,l]=results;
  if(t.error){
    console.error('transactions:',t.error);
    setDataError('Não foi possível carregar os lançamentos: '+t.error.message);
  }
  if(g.error) console.error('goals:',g.error);
  if(f.error) console.error('financings:',f.error);
  if(a.error) console.error('accounts:',a.error);
  if(c.error) console.error('cards:',c.error);
  if(cp.error) console.error('card_purchases:',cp.error);
  if(r.error) console.error('recurrences:',r.error);
  allAccounts=a.data||[]; allCards=c.data||[]; allCardPurchases=cp.data||[]; allRecurrences=r.data||[];
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
  renderDashboardExtras(tx);
  applyTxFilter();
  } catch (err) {
    console.error('loadAll:', err);
    setDataError('Erro ao carregar o painel: '+(err?.message||err));
  }
}
function renderDashboardExtras(tx){
  const currentMonth=todayISO().slice(0,7);
  const pending=tx.filter(x=>x.type==='expense'&&effectiveStatus(x)!=='paid'&&monthOf(x)===currentMonth)
    .sort((a,b)=>(a.due_date||'9999').localeCompare(b.due_date||'9999'));
  const payTotal=pending.reduce((s,x)=>s+Number(x.amount||0),0);
  const payTotalEl=$('#dashboardPayTotal'); if(payTotalEl) payTotalEl.textContent=money(payTotal);
  const payList=$('#dashboardPayList');
  if(payList) payList.innerHTML=pending.slice(0,4).map(x=>`<div class="dashboard-mini-row"><div><b>${esc(x.description)}</b><small>${dateBR(x.due_date)} · ${statusLabel(effectiveStatus(x),x)}</small></div><strong class="mini-negative">- ${money(x.amount)}</strong></div>`).join('')||'<div class="dashboard-empty">Nenhuma despesa pendente 🎉</div>';

  const investments=(allAccounts||[]).filter(a=>a.kind==='investimento');
  const investTotal=investments.reduce((s,a)=>s+Number(a.balance||0),0);
  const investMetricEl=$('#investmentMetric'); if(investMetricEl) investMetricEl.textContent=money(investTotal);
  const investTotalEl=$('#dashboardInvestTotal'); if(investTotalEl) investTotalEl.textContent=money(investTotal);
  const investList=$('#dashboardInvestList');
  if(investList) investList.innerHTML=investments.slice(0,4).map(a=>`<div class="dashboard-mini-row"><div><b>${esc(a.name)}</b><small>Investimento</small></div><strong class="mini-positive">${money(a.balance)}</strong></div>`).join('')||'<div class="dashboard-empty">Nenhum investimento cadastrado.</div>';
}
function setDataError(message){
  const ids=['transactions','calendarList','recentTransactions','upcoming'];
  ids.forEach(id=>{const el=$('#'+id); if(el && !el.dataset.hasDataError){el.innerHTML='<div class="empty error-empty">'+esc(message)+'</div>';}});
}


function smartIcon(text, fallback='•'){
  const v=String(text||'').toLowerCase();
  if(/mercad|supermerc|feira|compras/.test(v)) return '🛒';
  if(/remed|farmác|farmac|saúde|consulta|médic|medic/.test(v)) return '💊';
  if(/dent|odont/.test(v)) return '🦷';
  if(/internet|wifi|wi-fi|telefone|celular/.test(v)) return '📶';
  if(/aluguel|aluga|casa|condom/.test(v)) return '🏠';
  if(/escola|faculdade|curso|estud|mensalidade/.test(v)) return '🎓';
  if(/luz|energia|elétr/.test(v)) return '💡';
  if(/água|agua/.test(v)) return '💧';
  if(/gas|gás|botijão|botijao/.test(v)) return '🔥';
  if(/combust|gasolina|posto|uber|99|transporte/.test(v)) return '🚗';
  if(/salário|salario|pagamento|receita/.test(v)) return '💰';
  if(/livro|livraria/.test(v)) return '📚';
  if(/viagem|viajar|férias|ferias|passagem/.test(v)) return '✈️';
  if(/tv|televis/.test(v)) return '📺';
  if(/emergência|emergencia|reserva/.test(v)) return '🛡️';
  return fallback;
}
function goalIcon(name){
  const v=String(name||'').toLowerCase();
  if(/viagem|viajar|férias|ferias|praia|turismo/.test(v)) return '🏝️';
  if(/tv|televis/.test(v)) return '📺';
  if(/carro|moto|veículo|veiculo/.test(v)) return '🚗';
  if(/casa|imóvel|imovel/.test(v)) return '🏠';
  if(/emergência|emergencia|reserva/.test(v)) return '🛡️';
  if(/faculdade|curso|estudo/.test(v)) return '🎓';
  if(/celular|iphone|telefone/.test(v)) return '📱';
  if(/computador|notebook|pc/.test(v)) return '💻';
  return '🎯';
}
function cardBrandIcon(name){
  const v=String(name||'').toLowerCase();
  if(v.includes('nubank')) return '<span class="card-brand-icon nubank">nu</span>';
  if(v.includes('itau')||v.includes('itaú')) return '<span class="card-brand-icon itau">itaú</span>';
  if(v.includes('inter')) return '<span class="card-brand-icon inter">B</span>';
  if(v.includes('caixa')) return '<span class="card-brand-icon caixa">X</span>';
  if(v.includes('bradesco')) return '<span class="card-brand-icon bradesco">B</span>';
  if(v.includes('santander')) return '<span class="card-brand-icon santander">S</span>';
  if(v.includes('shopee')) return '<span class="card-brand-icon shopee">S</span>';
  return '<span class="card-brand-icon generic">💳</span>';
}

function txRow(x){
  const st=effectiveStatus(x);
  return `<div class="row agenda-row ${x.type==='expense'?'expense-row':''}" data-id="${esc(x.id)}"><div class="agenda-main"><span class="agenda-icon">${smartIcon(x.description,x.type==='income'?'💰':'📌')}</span><div><b>${esc(x.description)}</b><small>${dateBR(x.due_date)} · ${statusLabel(st,x)} · ${categoryFor(x)}</small></div></div><span class="amount ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</span></div>`
}
function txRowRecent(x){
  const st=effectiveStatus(x);
  return `<div class="row ${x.type==='expense'?'expense-row':''}"><div><b>${esc(x.description)}</b><small>${x.type==='income'?'Receita':'Despesa'} · ${dateBR(x.due_date)} · ${statusLabel(st,x)}${x.profiles?.full_name?' · '+esc(x.profiles.full_name):''}</small></div><span class="amount ${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</span></div>`
}
function txRowFull(x){
  const isExpense=x.type==='expense';
  const st=effectiveStatus(x);
  const payBtn=isExpense && st!=='paid'?`<button class="pay-btn" onclick="payTx('${x.id}')">✓ Pagar</button>`:'';
  const pdfBtn=`<button class="pdf-btn" onclick="manageDocs('${x.id}')">📎 PDF</button>`;
  return `<div class="row transaction-row" data-type="${x.type}" data-status="${st}" data-search="${esc((x.description||'').toLowerCase())}">
    <div class="tx-main"><b>${esc(x.description)}</b><small>${isExpense?'Despesa':'Receita'} · ${dateBR(x.due_date)} · <span class="tx-status ${st}">${statusLabel(st,x)}</span>${x.profiles?.full_name?' · '+esc(x.profiles.full_name):''} · <span class="tx-category">${categoryFor(x)}</span></small></div>
    <div class="row-actions transaction-actions"><span class="amount ${x.type}">${isExpense?'-':''}${money(x.amount)}</span>${payBtn}<button class="edit-btn" onclick="editTx('${x.id}')">✏️ Editar</button>${pdfBtn}<button class="icon-btn" onclick="deleteTx('${x.id}')">🗑️</button></div>
  </div>`
}
function goalRow(g){const p=g.target_amount?Math.min(100,Number(g.current_amount)/Number(g.target_amount)*100):0;return `<div class="row goal-row"><span class="goal-icon">${goalIcon(g.name)}</span><div style="width:100%"><b>${esc(g.name)} <span class="goal-percent">${Math.round(p)}%</span></b><small>${money(g.current_amount)} de ${money(g.target_amount)}${g.deadline?' · até '+dateBR(g.deadline):''}</small><div class="progress"><span style="width:${p}%"></span></div></div></div>`}
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
  $('#modalContent').innerHTML=`<h3>${dateBR(key)}</h3><p class="doc-help">${list.length} lançamento(s) · saldo do dia ${money(total)}</p><div class="day-details">${list.map(x=>`<div class="day-detail"><div><b>${esc(x.description)}</b><small>${x.type==='expense'?'Despesa':'Receita'} · ${statusLabel(effectiveStatus(x),x)} · ${categoryFor(x)}</small></div><strong class="${x.type}">${x.type==='expense'?'-':''}${money(x.amount)}</strong></div>`).join('')}</div>`;
  $('#modal').classList.remove('hidden');
};
function applyTxFilter(){ const type=$('#txFilter')?.value||'all'; const status=$('#txStatusFilter')?.value||'all'; const search=($('#txSearch')?.value||'').trim().toLowerCase(); $$('#transactions .transaction-row').forEach(r=>{ const okType=type==='all'||r.dataset.type===type; const okStatus=status==='all'||(status==='paid_expense'&&r.dataset.type==='expense'&&r.dataset.status==='paid')||(status==='paid_income'&&r.dataset.type==='income'&&r.dataset.status==='paid')||(status!=='paid_expense'&&status!=='paid_income'&&r.dataset.status===status); const okSearch=!search||(r.dataset.search||'').includes(search); r.style.display=okType&&okStatus&&okSearch?'':'none'; }); });
}
async function loadReport(){
  // O Dashboard já carregou os lançamentos com sucesso. O relatório usa essa mesma lista,
  // evitando uma segunda consulta que pode ficar vazia por causa de permissões/RLS.
  reportTransactions=allTransactions||[];
  if(!reportTransactions.length){
    const {data,error}=await db.from('transactions').select('id,type,amount,description,status,due_date,paid_at,created_at').eq('created_by',me.id).order('due_date',{ascending:false,nullsFirst:false});
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
    const status=statusLabel(effectiveStatus(x),x);
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
  const accountOptions=allAccounts.map(a=>`<option value="${dbEscAttr(a.id)}">${esc(a.name)}</option>`).join('');
  const cardOptions=allCards.map(c=>`<option value="${dbEscAttr(c.id)}">${esc(c.name)}${c.last4?' · •••• '+esc(c.last4):''}</option>`).join('');
  html=`<form id="txForm"><label>Tipo</label><select name="type"><option value="expense">Despesa</option><option value="income">Receita</option></select><label>Descrição</label><input name="description" required placeholder="Ex.: Supermercado"><label>Valor</label><input name="amount" type="number" step="0.01" min="0" required><label>Vencimento</label><input name="due_date" type="date"><label>Status</label><select name="status" id="txStatusSelect"><option value="pending">Pendente</option><option value="paid">Pago</option></select><label>Conta</label><select name="account_id" id="txAccountSelect"><option value="">Nenhuma</option>${accountOptions}</select><label>Cartão</label><select name="card_id"><option value="">Nenhum</option>${cardOptions}</select><p class="form-note">Para lançamentos Pagos/Recebidos, escolha a conta movimentada. O saldo será atualizado automaticamente. Compras parceladas feitas pela tela Cartões já entram automaticamente em Finanças.</p><button class="primary">Salvar lançamento</button></form>`;
 }else{
  title='Nova meta';html=`<form id="goalForm"><label>Nome</label><input name="name" required placeholder="Ex.: Reserva de emergência"><label>Valor da meta</label><input name="target_amount" type="number" step="0.01" min="0.01" required><label>Valor já guardado</label><input name="current_amount" type="number" step="0.01" min="0" value="0"><label>Prazo</label><input name="deadline" type="date"><label>Descrição</label><textarea name="description" rows="3"></textarea><button class="primary">Salvar meta</button></form>`;
 }
 $('#modalContent').innerHTML=`<h3>${title}</h3>${html}`;$('#modal').classList.remove('hidden');$('#txForm')?.addEventListener('submit',saveTransaction);
$('#txForm')?.querySelector('[name="type"]')?.addEventListener('change',e=>{ const status=$('#txStatusSelect'); const isIncome=e.target.value==='income'; if(status){ const paid=status.querySelector('option[value="paid"]'); if(paid) paid.textContent=isIncome?'Recebido':'Pago'; } }); $('#txStatusSelect')?.addEventListener('change',e=>{ const type=$('#txForm')?.querySelector('[name="type"]')?.value; const paid=e.target.querySelector('option[value="paid"]'); if(paid) paid.textContent=type==='income'?'Recebido':'Pago'; }); $('#goalForm')?.addEventListener('submit',saveGoal);
}
function closeModal(){$('#modal').classList.add('hidden')}
async function saveTransaction(e){
 e.preventDefault();
 const f=new FormData(e.target);
 const type=f.get('type'), status=f.get('status'), amount=Number(f.get('amount'));
 const accountId=f.get('account_id')||null;
 if(status==='paid' && !accountId){
   alert(type==='income' ? 'Para registrar uma receita como Recebida, escolha a conta onde o dinheiro entrou.' : 'Para registrar uma despesa como Paga, escolha a conta de onde o dinheiro saiu.');
   return;
 }
 const payload={
   type,
   description:f.get('description'),
   amount,
   due_date:f.get('due_date')||null,
   status,
   created_by:me.id,
   responsible_profile_id:me.id,
   paid_at:status==='paid'?new Date().toISOString():null,
   account_id:accountId,
   card_id:f.get('card_id')||null
 };
 const {data:created,error}=await db.from('transactions').insert(payload).select('id').single();
 if(error){alert(error.message);return;}

 // Lançamentos concluídos movimentam a conta escolhida: receita entra, despesa sai.
 if(status==='paid'){
   const account=allAccounts.find(a=>a.id===accountId);
   if(!account){ await db.from('transactions').delete().eq('id',created.id).eq('created_by',me.id); alert('Para um lançamento já concluído, escolha a conta movimentada.'); return; }
   const before=Number(account.balance||0), after=type==='income'?before+amount:before-amount;
   if(type==='expense' && after<0){ await db.from('transactions').delete().eq('id',created.id).eq('created_by',me.id); alert(`Saldo insuficiente na conta "${account.name}".\n\nSaldo atual: ${dbMoney(before)}\nDespesa: ${dbMoney(amount)}\nFalta: ${dbMoney(amount-before)}`); return; }
   const {error:accountError}=await db.from('accounts').update({balance:after,updated_at:new Date().toISOString()}).eq('id',accountId).eq('created_by',me.id);
   if(accountError){ await db.from('transactions').delete().eq('id',created.id).eq('created_by',me.id); alert('Não foi possível atualizar o saldo da conta: '+accountError.message); return; }
 }
 closeModal();await loadAll();
}
window.editTx=async id=>{
 const x=allTransactions.find(t=>t.id===id); if(!x)return;
 const accountOptions=allAccounts.map(a=>`<option value="${dbEscAttr(a.id)}" ${x.account_id===a.id?'selected':''}>${esc(a.name)} · saldo ${dbMoney(a.balance)}</option>`).join('');
 $('#modalContent').innerHTML=`<h3>Editar lançamento</h3><form id="editTxForm">
 <label>Tipo</label><select name="type"><option value="expense" ${x.type==='expense'?'selected':''}>Despesa</option><option value="income" ${x.type==='income'?'selected':''}>Receita</option></select>
 <label>Descrição</label><input name="description" required value="${esc(x.description)}">
 <label>Valor</label><input name="amount" type="number" step="0.01" min="0" required value="${Number(x.amount||0)}">
 <label>Vencimento</label><input name="due_date" type="date" value="${x.due_date||''}">
 <label>Status</label><select name="status"><option value="pending" ${x.status==='pending'?'selected':''}>Pendente</option><option value="paid" ${x.status==='paid'?'selected':''}>${x.type==='income'?'Recebido':'Pago'}</option></select>
 <label>Conta</label><select name="account_id"><option value="">Nenhuma</option>${accountOptions}</select>
 <p class="form-note">Receitas marcadas como <b>Recebidas</b> entram no saldo da conta escolhida. Despesas continuam sendo descontadas quando forem pagas.</p>
 <button class="primary">Salvar alterações</button></form>`;
 $('#modal').classList.remove('hidden');
 $('#editTxForm').addEventListener('submit',async e=>{
   e.preventDefault();
   const f=new FormData(e.target);
   const newType=f.get('type'), newStatus=f.get('status'), newAmount=Number(f.get('amount'));
   const newAccountId=f.get('account_id')||null;
   if(newType==='income' && newStatus==='paid' && !newAccountId){
     alert('Para registrar uma receita como Recebida, escolha a conta onde o dinheiro entrou.');
     return;
   }

   // Ajusta somente o que mudou, evitando creditar duas vezes ao salvar novamente.
   const oldIncomeReceived=x.type==='income' && effectiveStatus(x)==='paid';
   const newIncomeReceived=newType==='income' && newStatus==='paid';
   const oldAccountId=x.account_id||null;
   const oldAmount=Number(x.amount||0);

   if(oldIncomeReceived && oldAccountId){
     const oldAccount=allAccounts.find(a=>a.id===oldAccountId);
     if(oldAccount){
       const oldAfter=Math.max(0,Number(oldAccount.balance||0)-oldAmount);
       const {error:oldErr}=await db.from('accounts').update({balance:oldAfter,updated_at:new Date().toISOString()}).eq('id',oldAccount.id).eq('created_by',me.id);
       if(oldErr){alert('Não foi possível ajustar o saldo da conta anterior: '+oldErr.message);return;}
     }
   }

   const payload={
     type:newType,
     description:f.get('description'),
     amount:newAmount,
     due_date:f.get('due_date')||null,
     status:newStatus,
     paid_at:newStatus==='paid'?(x.paid_at||new Date().toISOString()):null,
     account_id:newAccountId,
     updated_at:new Date().toISOString()
   };
   const {error}=await db.from('transactions').update(payload).eq('id',id).eq('created_by',me.id);
   if(error){
     // Tenta restaurar o saldo retirado acima.
     if(oldIncomeReceived && oldAccountId){
       const oldAccount=allAccounts.find(a=>a.id===oldAccountId);
       if(oldAccount) await db.from('accounts').update({balance:Number(oldAccount.balance||0),updated_at:new Date().toISOString()}).eq('id',oldAccount.id).eq('created_by',me.id);
     }
     alert('Não foi possível editar: '+error.message);return;
   }

   if(newIncomeReceived && newAccountId){
     const newAccount=allAccounts.find(a=>a.id===newAccountId);
     if(!newAccount){alert('A conta escolhida não foi encontrada.');return;}
     const before=Number(newAccount.balance||0), after=before+newAmount;
     const {error:accountError}=await db.from('accounts').update({balance:after,updated_at:new Date().toISOString()}).eq('id',newAccount.id).eq('created_by',me.id);
     if(accountError){alert('O lançamento foi salvo, mas não foi possível atualizar o saldo da conta: '+accountError.message);return;}
   }
   closeModal();await loadAll();
 });
};
async function saveGoal(e){e.preventDefault();const f=new FormData(e.target),payload={name:f.get('name'),description:f.get('description')||null,target_amount:Number(f.get('target_amount')),current_amount:Number(f.get('current_amount')||0),deadline:f.get('deadline')||null,created_by:me.id};const {error}=await db.from('goals').insert(payload);if(error){alert(error.message);return;}closeModal();await loadAll();}

window.payTx=async id=>{
  const x=allTransactions.find(t=>t.id===id);
  if(!x || x.type!=='expense') return;
  if(effectiveStatus(x)==='paid') return;
  if(!allAccounts.length){
    alert('Antes de pagar, cadastre pelo menos uma conta em Contas.');
    return;
  }
  const options=allAccounts.map(a=>`<option value="${dbEscAttr(a.id)}" ${x.account_id===a.id?'selected':''}>${esc(a.name)} · saldo ${dbMoney(a.balance)}</option>`).join('');
  $('#modalContent').innerHTML=`<h3>💳 Pagar despesa</h3>
    <p class="doc-help"><b>${esc(x.description)}</b> · ${dbMoney(x.amount)}</p>
    <form id="payTxForm">
      <label>Por qual conta você vai pagar?</label>
      <select name="account_id" id="payAccountSelect" required>${options}</select>
      <div id="payPreview" class="pay-preview"></div>
      <p class="form-note">Ao confirmar, a despesa será marcada como <b>Paga</b> e o valor será descontado automaticamente do saldo da conta escolhida.</p>
      <button class="primary" type="submit">✓ Confirmar pagamento</button>
    </form>`;
  $('#modal').classList.remove('hidden');
  const select=$('#payAccountSelect'), preview=$('#payPreview');
  const updatePreview=()=>{
    const a=allAccounts.find(a=>a.id===select.value);
    if(!a)return;
    const before=Number(a.balance||0), after=before-Number(x.amount||0);
    preview.innerHTML=`<div><span>Saldo atual</span><b>${dbMoney(before)}</b></div><div><span>Depois do pagamento</span><b class="${after<0?'negative':''}">${dbMoney(after)}</b></div>`;
  };
  select.addEventListener('change',updatePreview);
  updatePreview();
  $('#payTxForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const accountId=select.value;
    const account=allAccounts.find(a=>a.id===accountId);
    if(!account)return;
    const amount=Number(x.amount||0), beforeBalance=Number(account.balance||0), newBalance=beforeBalance-amount;
    if(newBalance<0){
      const missing=amount-beforeBalance;
      alert(`🔴 SALDO INSUFICIENTE!\n\nConta: ${account.name}\nSaldo atual: ${dbMoney(beforeBalance)}\nValor da despesa: ${dbMoney(amount)}\nFalta: ${dbMoney(missing)}\n\nEscolha outra conta ou coloque dinheiro nesta conta.`);
      updatePreview();
      return;
    }
    if(!confirm(`Confirmar pagamento de ${dbMoney(amount)} pela conta "${account.name}"?\n\nNovo saldo: ${dbMoney(newBalance)}`)) return;
    const now=new Date().toISOString();
    const accountUpdate=await db.from('accounts').update({balance:newBalance,updated_at:now}).eq('id',account.id).eq('created_by',me.id);
    if(accountUpdate.error){alert('Não foi possível atualizar o saldo da conta: '+accountUpdate.error.message);return;}
    const txUpdate=await db.from('transactions').update({status:'paid',paid_at:now,updated_at:now,account_id:account.id}).eq('id',id).eq('type','expense').eq('created_by',me.id);
    if(txUpdate.error){
      await db.from('accounts').update({balance:Number(account.balance||0),updated_at:new Date().toISOString()}).eq('id',account.id).eq('created_by',me.id);
      alert('Não foi possível marcar a despesa como paga: '+txUpdate.error.message);
      return;
    }
    closeModal();
    await loadAll();
  });
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

window.deleteTx=async id=>{if(!confirm('Excluir este lançamento?'))return;const x=allTransactions.find(t=>t.id===id);if(!x)return;if(effectiveStatus(x)==='paid'&&x.account_id){const a=allAccounts.find(a=>a.id===x.account_id);if(a){const before=Number(a.balance||0),delta=x.type==='income'?-Number(x.amount||0):Number(x.amount||0);const r=await db.from('accounts').update({balance:before+delta,updated_at:new Date().toISOString()}).eq('id',a.id).eq('created_by',me.id);if(r.error){alert('Não foi possível ajustar o saldo da conta antes de excluir: '+r.error.message);return;}}}const {error}=await db.from('transactions').delete().eq('id',id).eq('created_by',me.id);if(error)alert(error.message);else await loadAll()};
window.deleteGoal=async id=>{if(!confirm('Excluir esta meta?'))return;const {error}=await db.from('goals').delete().eq('id',id).eq('created_by',me.id);if(error)alert(error.message);else await loadAll()};
window.addToGoal=async id=>{
  const g=allGoals.find(x=>x.id===id);
  if(!g)return;
  const amountText=prompt(`Quanto deseja colocar na meta “${g.name}”?`);
  if(amountText===null)return;
  const n=Number(amountText);
  if(!Number.isFinite(n)||n<=0)return alert('Informe um valor válido.');
  if(!allAccounts.length)return alert('Antes de adicionar dinheiro à meta, cadastre pelo menos uma conta em Contas.');
  const options=allAccounts.map(a=>`<option value="${dbEscAttr(a.id)}">${esc(a.name)} · saldo ${dbMoney(a.balance)}</option>`).join('');
  $('#modalContent').innerHTML=`<h3>🎯 Colocar dinheiro na meta</h3>
    <p class="doc-help"><b>${esc(g.name)}</b> · adicionar ${dbMoney(n)}</p>
    <form id="goalPayForm">
      <label>De qual conta você vai tirar o dinheiro?</label>
      <select name="account_id" id="goalAccountSelect" required>${options}</select>
      <div id="goalPayPreview" class="pay-preview"></div>
      <p class="form-note">O valor será descontado da conta escolhida e acrescentado à meta.</p>
      <button class="primary" type="submit">✓ Confirmar aporte</button>
    </form>`;
  $('#modal').classList.remove('hidden');
  const select=$('#goalAccountSelect'),preview=$('#goalPayPreview');
  const updatePreview=()=>{const a=allAccounts.find(a=>a.id===select.value);if(!a)return;const before=Number(a.balance||0),after=before-n;preview.innerHTML=`<div><span>Saldo atual</span><b>${dbMoney(before)}</b></div><div><span>Depois do aporte</span><b class="${after<0?'negative':''}">${dbMoney(after)}</b></div>`};
  select.addEventListener('change',updatePreview);updatePreview();
  $('#goalPayForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const account=allAccounts.find(a=>a.id===select.value);if(!account)return;
    const before=Number(account.balance||0),after=before-n;
    if(after<0){alert(`🔴 SALDO INSUFICIENTE!\n\nConta: ${account.name}\nSaldo atual: ${dbMoney(before)}\nValor para a meta: ${dbMoney(n)}\nFalta: ${dbMoney(n-before)}`);return;}
    if(!confirm(`Adicionar ${dbMoney(n)} à meta “${g.name}” usando a conta “${account.name}”?\n\nNovo saldo da conta: ${dbMoney(after)}`))return;
    const now=new Date().toISOString();
    const accountUpdate=await db.from('accounts').update({balance:after,updated_at:now}).eq('id',account.id).eq('created_by',me.id);
    if(accountUpdate.error){alert('Não foi possível atualizar o saldo da conta: '+accountUpdate.error.message);return;}
    const goalUpdate=await db.from('goals').update({current_amount:Number(g.current_amount||0)+n,updated_at:now}).eq('id',g.id).eq('created_by',me.id);
    if(goalUpdate.error){await db.from('accounts').update({balance:before,updated_at:new Date().toISOString()}).eq('id',account.id).eq('created_by',me.id);alert('Não foi possível atualizar a meta: '+goalUpdate.error.message);return;}
    closeModal();await loadAll();
  });
};

/* =========================
   VERSÃO 2.3 — CONTAS, CARTÕES E RECORRÊNCIAS NO SUPABASE
   Os cadastros e compras ficam no banco e são compartilhados entre dispositivos.
========================= */
function dbMoney(n){return money(Number(n||0))}
function dbEscAttr(v){return esc(v).replace(/`/g,'&#096;')}
function accountKindLabel(k){return ({corrente:'Conta corrente',poupanca:'Poupança',dinheiro:'Dinheiro',investimento:'Investimento',outro:'Outra'})[k]||'Conta'}
function accountIcon(k){return k==='poupanca'?'🐷':k==='dinheiro'?'💵':k==='investimento'?'📈':'🏦'}
function accountInitial(name){const s=String(name||'').trim();return s?s.charAt(0).toUpperCase():'C'}
function frequencyLabel(f){return f==='weekly'?'Toda semana':f==='yearly'?'Todo ano':'Todo mês'}
function addMonthsISO(base,n,day){
 const d=new Date(`${base}T12:00:00`); d.setMonth(d.getMonth()+n); if(day){const y=d.getFullYear(),m=d.getMonth();const last=new Date(y,m+1,0).getDate();d.setDate(Math.min(Number(day),last));}
 return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function renderLocalModules(){
 const accountTotal=allAccounts.reduce((a,x)=>a+Number(x.balance||0),0);
 const limitTotal=allCards.reduce((a,x)=>a+Number(x.limit_amount||0),0);
 const currentMonth=todayISO().slice(0,7);
 const bills=allCardPurchases.reduce((a,p)=>a+allTransactions.filter(t=>t.card_purchase_id===p.id&&monthOf(t)===currentMonth).reduce((s,t)=>s+Number(t.amount||0),0),0);
 const dueSoon=allRecurrences.filter(r=>r.next_date&&r.next_date<=todayISO()).length;
 $('#accountsTotal').textContent=dbMoney(accountTotal);
 $('#cardsLimitTotal').textContent=dbMoney(limitTotal);
 $('#cardsBillsTotal').textContent=dbMoney(bills);
 $('#recurrenceCount').textContent=allRecurrences.length;
 const accountList=$('#accountsList');
 if(accountList) accountList.innerHTML=allAccounts.length?allAccounts.map(a=>`<article class="local-card account-card"><div class="local-card-head"><span class="local-icon account-initial">${esc(accountInitial(a.name))}</span><div><b>${esc(a.name)}</b><small>${esc(accountKindLabel(a.kind))}</small></div></div><strong>${dbMoney(a.balance)}</strong><div class="local-actions"><button onclick="adjustAccount('${dbEscAttr(a.id)}')">↕ Ajustar saldo</button><button onclick="editAccount('${dbEscAttr(a.id)}')">✏️ Editar</button><button class="danger" onclick="deleteAccount('${dbEscAttr(a.id)}')">Excluir</button></div></article>`).join(''):'<div class="empty">Nenhuma conta cadastrada. Adicione conta corrente, poupança, dinheiro ou investimento.</div>';
 const cardsList=$('#cardsList');
 if(cardsList) cardsList.innerHTML=allCards.length?allCards.map(c=>{
   const purchases=allCardPurchases.filter(x=>x.card_id===c.id);
   const inst=allTransactions.filter(t=>t.card_id===c.id&&monthOf(t)===currentMonth);
   const bill=inst.reduce((a,t)=>a+Number(t.amount||0),0); const limit=Number(c.limit_amount||0); const avail=Math.max(0,limit-bill); const pct=limit?Math.min(100,bill/limit*100):0;
   return `<article class="local-card credit-card"><div class="credit-top"><div class="credit-brand"><div class="credit-brand-icon">${cardBrandIcon(c.name)}</div><div><span>${esc(c.name)}</span><small class="credit-owner">Fatura atual · ${dateBR(currentMonth+'-01')}</small></div></div><b class="card-top-symbol">✦</b></div><div class="credit-number">•••• ${esc(c.last4||'0000')}</div><div class="credit-values"><div><small>Limite</small><strong>${dbMoney(limit)}</strong></div><div><small>Fatura</small><strong>${dbMoney(bill)}</strong></div></div><div class="limit-bar"><span style="width:${pct}%"></span></div><small class="limit-help">Disponível: ${dbMoney(avail)} · Venc. dia ${esc(c.due_day||'—')}${c.close_day?' · Fecha dia '+esc(c.close_day):''}</small><div class="local-actions"><button onclick="addCardPurchase('${dbEscAttr(c.id)}')">＋ Compra</button><button onclick="openCardDetails('${dbEscAttr(c.id)}')">👁️ Detalhes</button><button onclick="editCard('${dbEscAttr(c.id)}')">✏️ Editar</button><button class="danger" onclick="deleteCard('${dbEscAttr(c.id)}')">Excluir</button></div>${inst.length?`<div class="purchase-list"><b class="purchase-title">Lançamentos da fatura</b>${inst.slice(0,8).map(v=>`<div><span>${esc(v.description)}${Number(v.installments||1)>1?` · ${v.installment_number}/${v.installments}`:''}</span><b>${dbMoney(v.amount)}</b></div>`).join('')}</div>`:'<div class="purchase-empty">Nenhuma compra nesta fatura.</div>'}</article>`;
 }).join(''):'<div class="empty">Nenhum cartão cadastrado. Cadastre um cartão para acompanhar limite, fatura e parcelas.</div>';
 const recList=$('#recurrencesList');
 if(recList) recList.innerHTML=allRecurrences.length?allRecurrences.map(r=>{const due=r.next_date&&r.next_date<=todayISO();return `<div class="row local-row"><div><b>${esc(r.description)} ${due?'<span class="due-badge">Gerar agora</span>':''}</b><small>${r.type==='income'?'Receita':'Despesa'} · ${dbMoney(r.amount)} · ${frequencyLabel(r.frequency)} · próximo: ${dateBR(r.next_date)||'—'}</small></div><div class="local-actions"><button class="generate-btn" onclick="generateRecurrence('${dbEscAttr(r.id)}')">＋ Gerar</button><button onclick="editRecurrence('${dbEscAttr(r.id)}')">✏️</button><button class="danger" onclick="deleteRecurrence('${dbEscAttr(r.id)}')">🗑️</button></div></div>`}).join(''):'<div class="empty">Nenhuma recorrência cadastrada. Exemplos: aluguel, internet, salário ou assinatura.</div>';
 const hint=$('#recurrenceHint'); if(hint) hint.textContent=dueSoon?`${dueSoon} recorrência(s) pronta(s) para gerar.`:'As regras ficam salvas no Supabase e aparecem em todos os dispositivos.';
}
function localModal(title,form){$('#modalContent').innerHTML=`<h3>${title}</h3>${form}`;$('#modal').classList.remove('hidden')}
function openLocalEdit(type,obj){
 if(type==='account'){localModal(obj?'Editar conta':'Nova conta',`<form id="localAccountForm"><label>Nome</label><input name="name" required value="${dbEscAttr(obj?.name||'')}"><label>Tipo</label><select name="kind"><option value="corrente" ${obj?.kind==='corrente'?'selected':''}>Conta corrente</option><option value="poupanca" ${obj?.kind==='poupanca'?'selected':''}>Poupança</option><option value="dinheiro" ${obj?.kind==='dinheiro'?'selected':''}>Dinheiro</option><option value="investimento" ${obj?.kind==='investimento'?'selected':''}>Investimento</option><option value="outro" ${obj?.kind==='outro'?'selected':''}>Outra</option></select><label>Saldo atual</label><input name="balance" type="number" step="0.01" value="${Number(obj?.balance||0)}"><button class="primary">Salvar conta</button></form>`);$('#localAccountForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const payload={name:f.get('name'),kind:f.get('kind'),balance:Number(f.get('balance')||0),created_by:obj?.created_by||me.id};const q=obj?db.from('accounts').update(payload).eq('id',obj.id).eq('created_by',me.id):db.from('accounts').insert(payload);const {error}=await q;if(error){alert('Não foi possível salvar a conta: '+error.message);return;}closeModal();await loadAll();renderLocalModules();}}
 if(type==='card'){localModal(obj?'Editar cartão':'Novo cartão',`<form id="localCardForm"><label>Nome do cartão</label><input name="name" required placeholder="Ex.: Nubank" value="${dbEscAttr(obj?.name||'')}"><label>Últimos 4 dígitos</label><input name="last4" maxlength="4" inputmode="numeric" value="${dbEscAttr(obj?.last4||'')}"><label>Limite</label><input name="limit_amount" type="number" step="0.01" min="0" required value="${Number(obj?.limit_amount||0)}"><label>Dia do vencimento</label><input name="due_day" type="number" min="1" max="31" value="${dbEscAttr(obj?.due_day||'10')}"><label>Dia do fechamento</label><input name="close_day" type="number" min="1" max="31" value="${dbEscAttr(obj?.close_day||'')}"><button class="primary">Salvar cartão</button></form>`);$('#localCardForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const payload={name:f.get('name'),last4:f.get('last4')||null,limit_amount:Number(f.get('limit_amount')||0),due_day:Number(f.get('due_day')||10),close_day:f.get('close_day')?Number(f.get('close_day')):null,created_by:obj?.created_by||me.id};const q=obj?db.from('cards').update(payload).eq('id',obj.id).eq('created_by',me.id):db.from('cards').insert(payload);const {error}=await q;if(error){alert('Não foi possível salvar o cartão: '+error.message);return;}closeModal();await loadAll();renderLocalModules();}}
 if(type==='recurrence'){localModal(obj?'Editar recorrência':'Nova recorrência',`<form id="localRecForm"><label>Tipo</label><select name="type"><option value="expense" ${obj?.type!=='income'?'selected':''}>Despesa</option><option value="income" ${obj?.type==='income'?'selected':''}>Receita</option></select><label>Descrição</label><input name="description" required placeholder="Ex.: Aluguel" value="${dbEscAttr(obj?.description||'')}"><label>Valor</label><input name="amount" type="number" step="0.01" min="0" required value="${Number(obj?.amount||0)}"><label>Frequência</label><select name="frequency"><option value="monthly" ${obj?.frequency!=='weekly'&&obj?.frequency!=='yearly'?'selected':''}>Todo mês</option><option value="weekly" ${obj?.frequency==='weekly'?'selected':''}>Toda semana</option><option value="yearly" ${obj?.frequency==='yearly'?'selected':''}>Todo ano</option></select><label>Próxima data</label><input name="next_date" type="date" value="${dbEscAttr(obj?.next_date||todayISO())}"><p class="form-note">A regra será salva no Supabase. “Gerar” cria um lançamento real na tabela <b>transactions</b>.</p><button class="primary">Salvar recorrência</button></form>`);$('#localRecForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target);const payload={type:f.get('type'),description:f.get('description'),amount:Number(f.get('amount')||0),frequency:f.get('frequency'),next_date:f.get('next_date')||todayISO(),created_by:obj?.created_by||me.id};const q=obj?db.from('recurrences').update(payload).eq('id',obj.id).eq('created_by',me.id):db.from('recurrences').insert(payload);const {error}=await q;if(error){alert('Não foi possível salvar a recorrência: '+error.message);return;}closeModal();await loadAll();renderLocalModules();}}
}
window.adjustAccount=async id=>{const x=allAccounts.find(x=>x.id===id);if(!x)return;const v=prompt(`Novo saldo para ${x.name}:`,Number(x.balance||0).toFixed(2));if(v===null)return;const n=Number(String(v).replace(',','.'));if(!Number.isFinite(n))return alert('Informe um saldo válido.');const {error}=await db.from('accounts').update({balance:n}).eq('id',id).eq('created_by',me.id);if(error)alert(error.message);else{await loadAll();renderLocalModules();}};
window.editAccount=id=>{const x=allAccounts.find(x=>x.id===id);if(x)openLocalEdit('account',x)};
window.deleteAccount=async id=>{if(!confirm('Excluir esta conta do banco?'))return;const {error}=await db.from('accounts').delete().eq('id',id).eq('created_by',me.id);if(error)alert(error.message);else{await loadAll();renderLocalModules();}};
window.editCard=id=>{const x=allCards.find(x=>x.id===id);if(x)openLocalEdit('card',x)};
window.deleteCard=async id=>{if(!confirm('Excluir este cartão e suas compras do banco?'))return;const {error}=await db.from('cards').delete().eq('id',id).eq('created_by',me.id);if(error)alert(error.message);else{await loadAll();renderLocalModules();}};
window.addCardPurchase=async id=>{const c=allCards.find(x=>x.id===id);if(!c)return;localModal('Nova compra no cartão',`<form id="purchaseForm"><label>Descrição</label><input name="description" required placeholder="Ex.: Mercado"><label>Valor total da compra</label><input name="amount" type="number" step="0.01" min="0.01" required><label>Data da compra</label><input name="date" type="date" value="${todayISO()}"><label>Parcelas</label><input name="installments" type="number" min="1" max="60" value="1"><div class="installment-preview" id="installmentPreview">1x de R$ 0,00</div><p class="form-note">A compra será salva no Supabase e cada parcela será criada no financeiro.</p><button class="primary">Adicionar compra</button></form>`);const updateInstallmentPreview=()=>{const total=Number($('#purchaseForm [name=amount]')?.value||0),n=Math.max(1,Number($('#purchaseForm [name=installments]')?.value||1));$('#installmentPreview').textContent=`${n}x de ${dbMoney(total/n)}`};$('#purchaseForm [name=amount]')?.addEventListener('input',updateInstallmentPreview);$('#purchaseForm [name=installments]')?.addEventListener('input',updateInstallmentPreview);updateInstallmentPreview();$('#purchaseForm').onsubmit=async e=>{e.preventDefault();const f=new FormData(e.target),total=Number(f.get('amount')),n=Math.max(1,Number(f.get('installments')||1)),date=f.get('date')||todayISO(),part=Number((total/n).toFixed(2));const purchase={card_id:id,description:f.get('description'),amount:total,purchase_date:date,installments:n,installment_amount:part,created_by:me.id};const {data:cp,error:cpError}=await db.from('card_purchases').insert(purchase).select().single();if(cpError){alert('Não foi possível salvar a compra: '+cpError.message);return;}const rows=[];let remaining=total;for(let i=1;i<=n;i++){const value=i===n?Number(remaining.toFixed(2)):part;remaining-=value;rows.push({type:'expense',description:`${purchase.description}${n>1?` (${i}/${n})`:''}`,amount:value,due_date:addMonthsISO(date,i-1,c.due_day),status:'pending',created_by:me.id,responsible_profile_id:me.id,card_id:id,card_purchase_id:cp.id,installment_number:i,installments:n});}const {error:txError}=await db.from('transactions').insert(rows);if(txError){await db.from('card_purchases').delete().eq('id',cp.id).eq('created_by',me.id);alert('A compra foi revertida porque as parcelas não puderam ser criadas: '+txError.message);return;}closeModal();await loadAll();renderLocalModules();}};
window.generateCardTx=async id=>{};
window.generateRecurrence=async id=>{
  const r=allRecurrences.find(x=>x.id===id);if(!r)return;
  let accountId=null;
  if(r.type==='expense'){
    if(!allAccounts.length){alert('Antes de gerar uma despesa recorrente, cadastre pelo menos uma conta em Contas.');return;}
    const options=allAccounts.map(a=>`<option value="${dbEscAttr(a.id)}">${esc(a.name)} · saldo ${dbMoney(a.balance)}</option>`).join('');
    $('#modalContent').innerHTML=`<h3>🔄 Gerar despesa recorrente</h3><p class="doc-help"><b>${esc(r.description)}</b> · ${dbMoney(r.amount)}</p><form id="generateRecForm"><label>De qual conta você pretende pagar?</label><select name="account_id" id="recAccountSelect" required>${options}</select><p class="form-note">A despesa será criada como <b>Pendente</b>. O saldo só será descontado quando você clicar em <b>Pagar</b> no Financeiro.</p><button class="primary" type="submit">✓ Gerar lançamento</button></form>`;
    $('#modal').classList.remove('hidden');
    $('#generateRecForm').addEventListener('submit',async e=>{e.preventDefault();accountId=$('#recAccountSelect').value;await finishGenerateRecurrence(r,accountId);});
    return;
  }
  if(!confirm(`Gerar a receita “${r.description}” de ${dbMoney(r.amount)} no financeiro?`))return;
  await finishGenerateRecurrence(r,null);
};
async function finishGenerateRecurrence(r,accountId){
  const payload={type:r.type,description:r.description,amount:Number(r.amount),due_date:r.next_date||todayISO(),status:'pending',created_by:me.id,responsible_profile_id:me.id,recurrence_id:r.id,...(accountId?{account_id:accountId}:{})};
  const {error}=await db.from('transactions').insert(payload);
  if(error){alert('Não foi possível gerar o lançamento: '+error.message);return;}
  const next=r.frequency==='weekly'?addMonthsISO(r.next_date||todayISO(),0):r.frequency==='yearly'?addMonthsISO(r.next_date||todayISO(),12):addMonthsISO(r.next_date||todayISO(),1);let nextDate=next;if(r.frequency==='weekly'){const d=new Date(`${r.next_date||todayISO()}T12:00:00`);d.setDate(d.getDate()+7);nextDate=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;}
  const {error:updateError}=await db.from('recurrences').update({next_date:nextDate}).eq('id',r.id).eq('created_by',me.id);
  if(updateError){alert('Lançamento criado, mas não foi possível atualizar a próxima data: '+updateError.message);}
  closeModal();await loadAll();renderLocalModules();
}
window.editRecurrence=id=>{const x=allRecurrences.find(x=>x.id===id);if(x)openLocalEdit('recurrence',x)};
window.deleteRecurrence=async id=>{if(!confirm('Excluir esta recorrência do banco? Os lançamentos já gerados serão mantidos.'))return;const {error}=await db.from('recurrences').delete().eq('id',id).eq('created_by',me.id);if(error)alert(error.message);else{await loadAll();renderLocalModules();}};
window.openAccountModal=()=>openLocalEdit('account');window.openCardModal=()=>openLocalEdit('card');window.openRecurrenceModal=()=>openLocalEdit('recurrence');
window.openCardDetails=id=>{const c=allCards.find(x=>x.id===id);if(!c)return;const purchases=allCardPurchases.filter(x=>x.card_id===id);localModal(`Detalhes · ${esc(c.name)}`,`<div class="card-detail-summary"><b>Limite</b><strong>${dbMoney(c.limit_amount)}</strong><b>Vencimento</b><strong>Dia ${esc(c.due_day||'—')}</strong></div><div class="purchase-list light">${purchases.length?purchases.map(p=>`<div class="purchase-detail-row"><span class="purchase-detail-name"><span class="agenda-icon small">${smartIcon(p.description,'🛍️')}</span>${esc(p.description)} · ${p.installments}x</span><b>${dbMoney(p.amount)}</b></div>`).join(''):'<div class="empty">Nenhuma compra cadastrada.</div>'}</div>`) };

window.mobileMore=()=>{localModal('Mais opções',`<div class="more-menu"><button onclick="closeModal();showView('calendar')">📅 Calendário</button><button onclick="closeModal();showView('goals')">🎯 Metas</button><button onclick="closeModal();showView('report')">📊 Relatório completo</button><button onclick="closeModal();showView('recurrences')">↻ Recorrências</button><button onclick="closeModal();showView('profile')">👤 Perfil</button></div>`)};

function showError(m){console.error(m);alert(m)}
$('#loginBtn').onclick=login;$('#password').addEventListener('keydown',e=>{if(e.key==='Enter')login()});$('#logoutBtn').onclick=async()=>{await db.auth.signOut();location.reload()}; $('#logoutSide').onclick=async()=>{await db.auth.signOut();location.reload()};$('#quickAdd').onclick=()=>openModal('transaction'); $('#quickAddTop').onclick=()=>openModal('transaction'); $('#mobileAdd').onclick=()=>openModal('transaction');$('#mobileMore')?.addEventListener('click',mobileMore);$('#closeModal').onclick=closeModal;$('#modal').addEventListener('click',e=>{if(e.target.id==='modal')closeModal()});$('#txFilter').addEventListener('change',applyTxFilter);$('#txStatusFilter')?.addEventListener('change',applyTxFilter);$('#txSearch')?.addEventListener('input',applyTxFilter);$('#reportMonth')?.addEventListener('change',e=>{e.target.dataset.userChanged='1';renderReport();});$('#reportStatus')?.addEventListener('change',renderReport);$('#reportAllBtn')?.addEventListener('click',()=>{ $('#reportMonth').value=''; renderReport(); });$('#reportPrintBtn')?.addEventListener('click',printReport);$('#prevMonth')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()-1);renderCalendar(allTransactions);});$('#nextMonth')?.addEventListener('click',()=>{calendarCursor.setMonth(calendarCursor.getMonth()+1);renderCalendar(allTransactions);});$$('.nav button,.side-nav button,.mobile-nav button[data-view],.hero-button,[data-view]').forEach(b=>{if(b.dataset.view)b.onclick=()=>showView(b.dataset.view)});$$('[data-open]').forEach(b=>b.onclick=()=>openModal(b.dataset.open));start();
