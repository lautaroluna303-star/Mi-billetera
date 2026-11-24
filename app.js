(function(){
'use strict';

/* ============================================================
   estado
   ============================================================ */
var STATE = {
  db: null,
  mode: 'local',
  categories: [],
  transactions: [],
  debts: [],
  activeTab: 'resumen',
  currentMonth: startOfMonth(new Date()),
  expandedCat: null,
  expandedBar: null,
  notifPermission: (typeof Notification !== 'undefined') ? Notification.permission : 'unsupported',
  seededCategories: false
};

var DEFAULT_CATEGORIES = [
  {name:'Mercadería', parentId:null, children:['Champú','Jabón','Perfume','Desodorante','Otros de mercadería']},
  {name:'Comida', parentId:null, children:[]},
  {name:'Transporte', parentId:null, children:[]},
  {name:'Servicios', parentId:null, children:[]},
  {name:'Salud', parentId:null, children:[]},
  {name:'Entretenimiento', parentId:null, children:[]},
  {name:'Otros', parentId:null, children:[]}
];

/* ============================================================
   helpers
   ============================================================ */
function uid(){ return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2,9); }
function toISODate(d){
  var y=d.getFullYear(), m=String(d.getMonth()+1).padStart(2,'0'), day=String(d.getDate()).padStart(2,'0');
  return y+'-'+m+'-'+day;
}
function startOfMonth(d){ return new Date(d.getFullYear(), d.getMonth(), 1); }
function fmtMoney(n){
  n = Math.round(Number(n)||0);
  var neg = n<0; n = Math.abs(n);
  return (neg?'-':'') + '$ ' + n.toLocaleString('es-AR');
}
function fmtMonthLabel(d){
  var s = d.toLocaleDateString('es-AR', {month:'long', year:'numeric'});
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtDayLabel(iso){
  var d = new Date(iso+'T00:00:00');
  var s = d.toLocaleDateString('es-AR', {weekday:'long', day:'numeric', month:'long'});
  return s.charAt(0).toUpperCase() + s.slice(1);
}
function fmtShortDate(iso){
  var d = new Date(iso+'T00:00:00');
  return d.toLocaleDateString('es-AR', {day:'2-digit', month:'2-digit', year:'numeric'});
}
function daysUntil(iso){
  var today = new Date(); today.setHours(0,0,0,0);
  var d = new Date(iso+'T00:00:00');
  return Math.round((d-today)/86400000);
}
function debtUrgency(debt){
  if(debt.paid) return 'paid';
  var du = daysUntil(debt.dueDate);
  if(du<0) return 'overdue';
  if(du<=3) return 'soon';
  return 'later';
}
function debtWhenLabel(debt){
  var du = daysUntil(debt.dueDate);
  if(du===0) return 'Vence hoy';
  if(du===1) return 'Vence mañana';
  if(du>1) return 'Vence en '+du+' días';
  if(du===-1) return 'Vencida hace 1 día';
  return 'Vencida hace '+Math.abs(du)+' días';
}
function escapeHtml(s){
  return String(s==null?'':s).replace(/[&<>"']/g, function(c){
    return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c];
  });
}
function catName(id){
  var c = STATE.categories.find(function(x){return x.id===id;});
  return c ? c.name : 'Categoría eliminada';
}
function topCategories(){ return STATE.categories.filter(function(c){return !c.parentId;}); }
function subCategories(parentId){ return STATE.categories.filter(function(c){return c.parentId===parentId;}); }

/* ============================================================
   almacenamiento local (localStorage)
   ============================================================ */
var Store = {
  async init(){
    STATE.mode = 'local';
    this.loadLocal();
    if(STATE.categories.length===0){ this.seedCategories(); this.loadLocal(); }
    render();
    checkDueNotifications();
  },

  loadLocal(){
    try{
      STATE.categories = JSON.parse(localStorage.getItem('mb_categories')||'[]');
      STATE.transactions = JSON.parse(localStorage.getItem('mb_transactions')||'[]');
      STATE.debts = JSON.parse(localStorage.getItem('mb_debts')||'[]');
    }catch(e){ STATE.categories=[]; STATE.transactions=[]; STATE.debts=[]; }
  },
  saveLocal(col){
    var map = {categories:STATE.categories, transactions:STATE.transactions, debts:STATE.debts};
    localStorage.setItem('mb_'+col, JSON.stringify(map[col]));
  },

  async seedCategories(){
    var toAdd = [];
    DEFAULT_CATEGORIES.forEach(function(top){
      var topId = uid();
      toAdd.push({id:topId, name:top.name, parentId:null});
      top.children.forEach(function(childName){
        toAdd.push({id:uid(), name:childName, parentId:topId});
      });
    });
    STATE.categories = toAdd;
    this.saveLocal('categories');
  },

  async add(col, data){
    data = Object.assign({id:uid()}, data);
    STATE[col].push(data);
    this.saveLocal(col);
    render();
  },
  async update(col, id, data){
    var item = STATE[col].find(function(x){return x.id===id;});
    if(item){ Object.assign(item, data); this.saveLocal(col); render(); }
  },
  async remove(col, id){
    STATE[col] = STATE[col].filter(function(x){return x.id!==id;});
    this.saveLocal(col);
    render();
  }
};

/* ============================================================
   notificaciones (mejor esfuerzo, solo mientras la app está abierta)
   ============================================================ */
function checkDueNotifications(){
  if(typeof Notification==='undefined' || Notification.permission!=='granted') return;
  var todayStr = toISODate(new Date());
  STATE.debts.forEach(function(d){
    if(d.paid) return;
    if(d.dueDate<=todayStr && d.lastNotifiedDate!==todayStr){
      var overdue = d.dueDate<todayStr;
      try{
        new Notification(overdue ? 'Deuda vencida' : 'Vence hoy', {
          body: d.name+': '+fmtMoney(d.amount)
        });
      }catch(e){}
      Store.update('debts', d.id, {lastNotifiedDate: todayStr});
    }
  });
}
setInterval(checkDueNotifications, 60000);
document.addEventListener('visibilitychange', function(){
  if(document.visibilityState==='visible') checkDueNotifications();
});

/* ============================================================
   render
   ============================================================ */
function render(){
  renderHeader();
  if(STATE.activeTab==='resumen') renderResumen();
  if(STATE.activeTab==='movimientos') renderMovimientos();
  if(STATE.activeTab==='deudas') renderDeudas();
  if(STATE.activeTab==='categorias') renderCategorias();
  renderNavBadge();
}

function totals(list){
  var ingreso=0, gasto=0, ahorro=0;
  list.forEach(function(t){
    if(t.type==='ingreso') ingreso += t.amount;
    else if(t.type==='gasto') gasto += t.amount;
    else if(t.type==='ahorro') ahorro += t.amount;
  });
  return {ingreso:ingreso, gasto:gasto, ahorro:ahorro};
}

function renderHeader(){
  var all = totals(STATE.transactions);
  var disponible = all.ingreso - all.gasto - all.ahorro;
  document.getElementById('headerDisponible').textContent = fmtMoney(disponible);
}

function renderResumen(){
  var all = totals(STATE.transactions);
  var disponible = all.ingreso - all.gasto - all.ahorro;
  var deudaTotal = STATE.debts.filter(function(d){return !d.paid;}).reduce(function(a,d){return a+d.amount;},0);

  document.getElementById('statDisponible').textContent = fmtMoney(disponible);
  document.getElementById('statAhorro').textContent = fmtMoney(all.ahorro);
  document.getElementById('statDebo').textContent = fmtMoney(deudaTotal);

  document.getElementById('monthLabel').textContent = fmtMonthLabel(STATE.currentMonth);

  var y = STATE.currentMonth.getFullYear(), m = STATE.currentMonth.getMonth();
  var monthTx = STATE.transactions.filter(function(t){
    var d = new Date(t.date+'T00:00:00');
    return d.getFullYear()===y && d.getMonth()===m;
  });
  var mt = totals(monthTx);

  var ledger = document.getElementById('monthLedger');
  ledger.innerHTML =
    '<div class="ledger-row"><span class="name"><span class="dot ingreso"></span>Ingresos</span><span class="val ingreso">'+fmtMoney(mt.ingreso)+'</span></div>'+
    '<div class="ledger-row"><span class="name"><span class="dot gasto"></span>Gastos</span><span class="val gasto">'+fmtMoney(mt.gasto)+'</span></div>'+
    '<div class="ledger-row"><span class="name"><span class="dot ahorro"></span>Ahorro</span><span class="val ahorro">'+fmtMoney(mt.ahorro)+'</span></div>';

  // gastos por categoría (top-level) este mes
  var byCat = {};
  monthTx.filter(function(t){return t.type==='gasto';}).forEach(function(t){
    var topId = t.categoryId || 'sin-cat';
    byCat[topId] = byCat[topId] || {total:0, subs:{}};
    byCat[topId].total += t.amount;
    if(t.subcategoryId){
      byCat[topId].subs[t.subcategoryId] = (byCat[topId].subs[t.subcategoryId]||0) + t.amount;
    }
  });
  var rows = Object.keys(byCat).map(function(id){ return {id:id, total:byCat[id].total, subs:byCat[id].subs}; });
  rows.sort(function(a,b){ return b.total-a.total; });
  var maxTotal = rows.length ? rows[0].total : 0;

  var barlistEl = document.getElementById('catBarList');
  if(rows.length===0){
    barlistEl.innerHTML = '<div class="empty">No hay gastos cargados este mes todavía.</div>';
  } else {
    barlistEl.innerHTML = rows.map(function(r){
      var name = r.id==='sin-cat' ? 'Sin categoría' : catName(r.id);
      var pct = maxTotal ? Math.max(4, Math.round(r.total/maxTotal*100)) : 0;
      var cat = STATE.categories.find(function(x){return x.id===r.id;});
      var bud = cat && cat.budget, fillBg = '', budTxt = '';
      if(bud){
        var ratio = r.total/bud;
        pct = Math.min(100, Math.max(4, Math.round(ratio*100)));
        fillBg = 'background:'+(ratio>1 ? 'var(--red)' : (ratio>=0.8 ? 'var(--gold)' : 'var(--green)'))+';';
        budTxt = ' / '+fmtMoney(bud);
      }
      var subEntries = Object.keys(r.subs);
      var subHtml = '';
      if(STATE.expandedBar===r.id && subEntries.length){
        subHtml = '<div class="subcat-breakdown">' + subEntries.map(function(sid){
          return '<div><span>'+escapeHtml(catName(sid))+'</span><span>'+fmtMoney(r.subs[sid])+'</span></div>';
        }).join('') + '</div>';
      }
      return '<div class="bar-row" data-catid="'+r.id+'">'+
        '<div class="bar-top"><span class="cat">'+escapeHtml(name)+'</span><span class="amt">'+fmtMoney(r.total)+budTxt+'</span></div>'+
        '<div class="bar-track"><div class="bar-fill" style="'+fillBg+'width:'+pct+'%"></div></div>'+
        subHtml+
      '</div>';
    }).join('');
    barlistEl.querySelectorAll('.bar-row').forEach(function(el){
      el.addEventListener('click', function(){
        var id = el.getAttribute('data-catid');
        STATE.expandedBar = STATE.expandedBar===id ? null : id;
        renderResumen();
      });
    });
  }

  // proximos vencimientos
  var upcoming = STATE.debts.filter(function(d){return !d.paid;})
    .slice().sort(function(a,b){ return a.dueDate.localeCompare(b.dueDate); })
    .slice(0,3);
  var upEl = document.getElementById('upcomingDebts');
  if(upcoming.length===0){
    upEl.innerHTML = '<div class="empty">No tenés deudas pendientes. 🎉</div>';
  } else {
    upEl.innerHTML = upcoming.map(function(d){
      var urg = debtUrgency(d);
      return '<div class="mini-debt"><span class="urg '+urg+'"></span>'+
        '<span class="who">'+escapeHtml(d.name)+' · '+fmtMoney(d.amount)+'</span>'+
        '<span class="when">'+debtWhenLabel(d)+'</span></div>';
    }).join('');
  }
}

function renderMovimientos(){
  populateCategorySelects();
  var list = STATE.transactions.slice().sort(function(a,b){
    if(a.date!==b.date) return b.date.localeCompare(a.date);
    return (b.createdAt||0)-(a.createdAt||0);
  });
  var el = document.getElementById('txList');
  if(list.length===0){
    el.innerHTML = '<div class="empty">Todavía no cargaste movimientos.<br>Agregá el primero para empezar a ver tu resumen.</div>';
    return;
  }
  var html = '';
  var lastDay = null;
  list.forEach(function(t){
    if(t.date!==lastDay){
      html += '<div class="tx-day">'+fmtDayLabel(t.date)+'</div>';
      lastDay = t.date;
    }
    var chip = '';
    if(t.type==='gasto'){
      chip = catName(t.categoryId) + (t.subcategoryId ? ' · '+catName(t.subcategoryId) : '');
    } else if(t.type==='ahorro'){
      chip = t.amount<0 ? 'Retiro de ahorro' : 'Depósito en ahorro';
    } else {
      chip = 'Ingreso';
    }
    var desc = t.description ? escapeHtml(t.description) : (t.type==='gasto' ? catName(t.categoryId) : chip);
    var amtDisplay = fmtMoney(Math.abs(t.amount));
    var sign = t.type==='gasto' ? '−' : (t.type==='ahorro' ? (t.amount<0 ? '+' : '−') : '+');
    html += '<div class="tx-row">'+
      '<span class="bar '+t.type+'"></span>'+
      '<span class="mid" data-edit="'+t.id+'" style="cursor:pointer"><div class="desc">'+desc+'</div><div class="chip">'+escapeHtml(chip)+'</div></span>'+
      '<span class="amt '+t.type+'">'+sign+amtDisplay+'</span>'+
      '<button class="del" data-id="'+t.id+'" aria-label="Eliminar">×</button>'+
    '</div>';
  });
  el.innerHTML = html;
  el.querySelectorAll('.mid[data-edit]').forEach(function(m){
    m.addEventListener('click', function(){ startEditTx(m.getAttribute('data-edit')); });
  });
  el.querySelectorAll('.del').forEach(function(b){
    b.addEventListener('click', function(){
      if(confirm('¿Eliminar este movimiento?')) Store.remove('transactions', b.getAttribute('data-id'));
    });
  });
}

function renderDeudas(){
  var unpaid = STATE.debts.filter(function(d){return !d.paid;});
  var dueNow = unpaid.filter(function(d){ return debtUrgency(d)==='overdue' || (debtUrgency(d)==='soon' && daysUntil(d.dueDate)<=0); });

  var bannerEl = document.getElementById('debtBanner');
  if(dueNow.length){
    bannerEl.innerHTML = '<div class="banner"><div>'+
      '<div class="t">Tenés pagos que vencen hoy o ya vencieron</div>'+
      '<ul>'+dueNow.map(function(d){ return '<li>'+escapeHtml(d.name)+' — '+fmtMoney(d.amount)+' ('+debtWhenLabel(d)+')</li>'; }).join('')+'</ul>'+
    '</div></div>';
  } else {
    bannerEl.innerHTML = '';
  }

  var notifEl = document.getElementById('notifHint');
  if(typeof Notification==='undefined'){
    notifEl.innerHTML = '';
  } else if(Notification.permission==='granted'){
    notifEl.innerHTML = '<div class="notif-hint"><span>Los avisos están activados en este navegador.</span></div>';
  } else if(Notification.permission==='denied'){
    notifEl.innerHTML = '<div class="notif-hint"><span>Bloqueaste los avisos. Podés habilitarlos desde la config del navegador.</span></div>';
  } else {
    notifEl.innerHTML = '<div class="notif-hint"><span>Activá los avisos para que te recuerde cuando se acerque un vencimiento (funciona mientras tenés la app abierta).</span><button class="pill-btn ghost" id="askNotif" type="button" style="white-space:nowrap;">Activar</button></div>';
    document.getElementById('askNotif').addEventListener('click', function(){
      Notification.requestPermission().then(function(){ renderDeudas(); checkDueNotifications(); });
    });
  }

  var sorted = STATE.debts.slice().sort(function(a,b){
    if(a.paid!==b.paid) return a.paid ? 1 : -1;
    return a.dueDate.localeCompare(b.dueDate);
  });
  var listEl = document.getElementById('debtList');
  if(sorted.length===0){
    listEl.innerHTML = '<div class="empty">No cargaste deudas. Sumá a quién le debés y cuándo tenés que pagarle.</div>';
    return;
  }
  listEl.innerHTML = sorted.map(function(d){
    var urg = d.paid ? 'later' : debtUrgency(d);
    var whenClass = d.paid ? '' : (urg==='overdue' ? 'overdue' : (urg==='soon' ? 'soon' : ''));
    return '<div class="debt-card '+urg+(d.paid?' paid':'')+'">'+
      '<div class="debt-top"><span class="name">'+escapeHtml(d.name)+'</span><span class="amt">'+fmtMoney(d.amount)+'</span></div>'+
      '<div class="debt-when '+whenClass+'">'+(d.paid ? 'Pagada · vencía '+fmtShortDate(d.dueDate) : debtWhenLabel(d)+' · '+fmtShortDate(d.dueDate))+'</div>'+
      (d.notes ? '<div class="debt-notes">'+escapeHtml(d.notes)+'</div>' : '')+
      '<div class="debt-actions">'+
        (d.paid
          ? '<button class="btn-unpaid" data-act="unpaid" data-id="'+d.id+'">Marcar sin pagar</button>'
          : '<button class="btn-paid" data-act="paid" data-id="'+d.id+'">Marcar pagada</button>')+
        '<button class="btn-unpaid" data-act="edit" data-id="'+d.id+'">Editar</button>'+
        '<button class="btn-del" data-act="del" data-id="'+d.id+'">Eliminar</button>'+
      '</div>'+
    '</div>';
  }).join('');

  listEl.querySelectorAll('button[data-act]').forEach(function(b){
    b.addEventListener('click', function(){
      var id = b.getAttribute('data-id');
      var act = b.getAttribute('data-act');
      if(act==='paid') Store.update('debts', id, {paid:true});
      else if(act==='unpaid') Store.update('debts', id, {paid:false});
      else if(act==='edit') startEditDebt(id);
      else if(act==='del'){ if(confirm('¿Eliminar esta deuda?')) Store.remove('debts', id); }
    });
  });
}

function renderCategorias(){
  var tops = topCategories();
  var el = document.getElementById('catList');
  if(tops.length===0){
    el.innerHTML = '<div class="empty">Todavía no hay categorías.</div>';
    return;
  }
  el.innerHTML = tops.map(function(c){
    var subs = subCategories(c.id);
    var open = STATE.expandedCat===c.id;
    return '<div class="cat-block">'+
      '<div class="cat-head" data-id="'+c.id+'">'+
        '<span class="name">'+escapeHtml(c.name)+'</span>'+
        '<span style="display:flex;align-items:center;">'+
          '<span class="n">'+subs.length+' sub</span>'+
          '<button class="del-cat" data-id="'+c.id+'" aria-label="Eliminar categoría">🗑</button>'+
          '<span class="chev'+(open?' open':'')+'">›</span>'+
        '</span>'+
      '</div>'+
      '<div class="subcat-list'+(open?' open':'')+'">'+
        subs.map(function(s){
          return '<div class="subcat-row"><span>'+escapeHtml(s.name)+'</span><button data-id="'+s.id+'">🗑</button></div>';
        }).join('')+
        '<div class="add-subcat"><input type="text" placeholder="Nueva subcategoría" data-parent="'+c.id+'"><button data-parent="'+c.id+'">Agregar</button></div>'+
        '<div class="add-subcat"><input type="number" inputmode="decimal" min="0" placeholder="Tope mensual ($)" value="'+(c.budget||'')+'" data-budget="'+c.id+'"><button data-budget="'+c.id+'">Guardar tope</button></div>'+
      '</div>'+
    '</div>';
  }).join('');

  el.querySelectorAll('.cat-head').forEach(function(h){
    h.addEventListener('click', function(e){
      if(e.target.closest('.del-cat')) return;
      var id = h.getAttribute('data-id');
      STATE.expandedCat = STATE.expandedCat===id ? null : id;
      renderCategorias();
    });
  });
  el.querySelectorAll('.del-cat').forEach(function(b){
    b.addEventListener('click', function(e){
      e.stopPropagation();
      var id = b.getAttribute('data-id');
      if(confirm('¿Eliminar esta categoría y sus subcategorías?')){
        subCategories(id).forEach(function(s){ Store.remove('categories', s.id); });
        Store.remove('categories', id);
      }
    });
  });
  el.querySelectorAll('.subcat-row button').forEach(function(b){
    b.addEventListener('click', function(){
      if(confirm('¿Eliminar esta subcategoría?')) Store.remove('categories', b.getAttribute('data-id'));
    });
  });
  el.querySelectorAll('.add-subcat button[data-budget]').forEach(function(b){
    b.addEventListener('click', function(){
      var id = b.getAttribute('data-budget');
      var v = parseFloat(el.querySelector('input[data-budget="'+id+'"]').value);
      Store.update('categories', id, {budget: v>0 ? v : null});
      STATE.expandedCat = id;
    });
  });
  el.querySelectorAll('.add-subcat button[data-parent]').forEach(function(b){
    b.addEventListener('click', function(){
      var parentId = b.getAttribute('data-parent');
      var input = el.querySelector('input[data-parent="'+parentId+'"]');
      var name = (input.value||'').trim();
      if(!name) return;
      Store.add('categories', {name:name, parentId:parentId});
      input.value='';
      STATE.expandedCat = parentId;
    });
  });
}

function renderNavBadge(){
  var urgent = STATE.debts.filter(function(d){ return !d.paid && daysUntil(d.dueDate)<=0; }).length;
  var badge = document.getElementById('debtBadge');
  if(urgent>0){ badge.style.display='flex'; badge.textContent = urgent; }
  else { badge.style.display='none'; }
}

/* ============================================================
   formularios
   ============================================================ */
function populateCategorySelects(){
  var catSel = document.getElementById('txCategory');
  var tops = topCategories();
  var prevVal = catSel.value;
  catSel.innerHTML = tops.map(function(c){ return '<option value="'+c.id+'">'+escapeHtml(c.name)+'</option>'; }).join('');
  if(tops.some(function(c){return c.id===prevVal;})) catSel.value = prevVal;
  populateSubcatSelect();
}
function populateSubcatSelect(){
  var subSel = document.getElementById('txSubcategory');
  var subs = subCategories(document.getElementById('txCategory').value);
  subSel.innerHTML = '<option value="">— ninguna —</option>' + subs.map(function(s){ return '<option value="'+s.id+'">'+escapeHtml(s.name)+'</option>'; }).join('');
}

var txType = 'ingreso';
var ahorroModo = 'deposito';

function setTxType(t){
  txType = t;
  document.querySelectorAll('#txTypeSeg button').forEach(function(x){ x.classList.toggle('sel', x.getAttribute('data-val')===t); });
  document.getElementById('txCatField').style.display = t==='gasto' ? 'block':'none';
  document.getElementById('txSubcatField').style.display = t==='gasto' ? 'block':'none';
  document.getElementById('ahorroModoField').style.display = t==='ahorro' ? 'block':'none';
}
function setAhorroModo(m){
  ahorroModo = m;
  document.querySelectorAll('#ahorroModoSeg button').forEach(function(x){ x.classList.toggle('sel', x.getAttribute('data-val')===m); });
}
function resetTxFields(){
  STATE.editTxId = null;
  document.getElementById('txAmount').value = '';
  document.getElementById('txDesc').value = '';
}
function startEditTx(id){
  var t = STATE.transactions.find(function(x){return x.id===id;}); if(!t) return;
  populateCategorySelects();
  STATE.editTxId = id;
  setTxType(t.type);
  if(t.type==='ahorro') setAhorroModo(t.amount<0 ? 'retiro' : 'deposito');
  document.getElementById('txAmount').value = Math.abs(t.amount);
  document.getElementById('txDate').value = t.date;
  document.getElementById('txDesc').value = t.description || '';
  if(t.type==='gasto'){
    document.getElementById('txCategory').value = t.categoryId || '';
    populateSubcatSelect();
    document.getElementById('txSubcategory').value = t.subcategoryId || '';
  }
  document.getElementById('txForm').classList.add('open');
  window.scrollTo({top:0, behavior:'smooth'});
}
function startEditDebt(id){
  var d = STATE.debts.find(function(x){return x.id===id;}); if(!d) return;
  STATE.editDebtId = id;
  document.getElementById('debtName').value = d.name;
  document.getElementById('debtAmount').value = d.amount;
  document.getElementById('debtDate').value = d.dueDate;
  document.getElementById('debtNotes').value = d.notes || '';
  document.getElementById('debtForm').classList.add('open');
  window.scrollTo({top:0, behavior:'smooth'});
}

function setupTxForm(){
  document.getElementById('txTypeSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    setTxType(b.getAttribute('data-val'));
  });
  document.getElementById('ahorroModoSeg').addEventListener('click', function(e){
    var b = e.target.closest('button'); if(!b) return;
    ahorroModo = b.getAttribute('data-val');
    this.querySelectorAll('button').forEach(function(x){ x.classList.toggle('sel', x===b); });
  });
  document.getElementById('txCategory').addEventListener('change', populateSubcatSelect);

  document.getElementById('toggleTxForm').addEventListener('click', function(){
    var f = document.getElementById('txForm');
    if(!f.classList.contains('open')){
      resetTxFields();
      populateCategorySelects();
      document.getElementById('txDate').value = toISODate(new Date());
    }
    f.classList.toggle('open');
  });
  document.getElementById('cancelTx').addEventListener('click', function(){
    resetTxFields();
    document.getElementById('txForm').classList.remove('open');
  });

  document.getElementById('txForm').addEventListener('submit', function(e){
    e.preventDefault();
    var amount = parseFloat(document.getElementById('txAmount').value);
    if(!amount || amount<=0){ alert('Ingresá un monto válido.'); return; }
    var date = document.getElementById('txDate').value || toISODate(new Date());
    var desc = document.getElementById('txDesc').value.trim();
    var data = {type:txType, amount:amount, date:date, description:desc, createdAt:Date.now()};
    if(txType==='gasto'){
      data.categoryId = document.getElementById('txCategory').value || null;
      data.subcategoryId = document.getElementById('txSubcategory').value || null;
    } else if(txType==='ahorro'){
      data.amount = ahorroModo==='retiro' ? -Math.abs(amount) : Math.abs(amount);
    }
    if(STATE.editTxId){ delete data.createdAt; Store.update('transactions', STATE.editTxId, data); STATE.editTxId = null; }
    else Store.add('transactions', data);
    document.getElementById('txAmount').value='';
    document.getElementById('txDesc').value='';
    document.getElementById('txForm').classList.remove('open');
  });
}

function setupDebtForm(){
  document.getElementById('toggleDebtForm').addEventListener('click', function(){
    var f = document.getElementById('debtForm');
    if(!f.classList.contains('open')){
      STATE.editDebtId = null;
      ['debtName','debtAmount','debtNotes'].forEach(function(i){ document.getElementById(i).value=''; });
      document.getElementById('debtDate').value = toISODate(new Date());
    }
    f.classList.toggle('open');
  });
  document.getElementById('cancelDebt').addEventListener('click', function(){
    STATE.editDebtId = null;
    document.getElementById('debtForm').classList.remove('open');
  });
  document.getElementById('debtForm').addEventListener('submit', function(e){
    e.preventDefault();
    var name = document.getElementById('debtName').value.trim();
    var amount = parseFloat(document.getElementById('debtAmount').value);
    var date = document.getElementById('debtDate').value;
    var notes = document.getElementById('debtNotes').value.trim();
    if(!name){ alert('Ingresá a quién le debés.'); return; }
    if(!amount || amount<=0){ alert('Ingresá un monto válido.'); return; }
    if(!date){ alert('Ingresá la fecha límite.'); return; }
    if(STATE.editDebtId){ Store.update('debts', STATE.editDebtId, {name:name, amount:amount, dueDate:date, notes:notes, lastNotifiedDate:null}); STATE.editDebtId = null; }
    else Store.add('debts', {name:name, amount:amount, dueDate:date, notes:notes, paid:false, lastNotifiedDate:null, createdAt:Date.now()});
    document.getElementById('debtName').value='';
    document.getElementById('debtAmount').value='';
    document.getElementById('debtNotes').value='';
    document.getElementById('debtForm').classList.remove('open');
  });
}

function setupCatForm(){
  document.getElementById('toggleCatForm').addEventListener('click', function(){
    document.getElementById('catForm').classList.toggle('open');
  });
  document.getElementById('cancelCat').addEventListener('click', function(){
    document.getElementById('catForm').classList.remove('open');
  });
  document.getElementById('catForm').addEventListener('submit', function(e){
    e.preventDefault();
    var input = document.getElementById('newCatName');
    var name = input.value.trim();
    if(!name) return;
    Store.add('categories', {name:name, parentId:null});
    input.value='';
    document.getElementById('catForm').classList.remove('open');
  });
}

/* ============================================================
   navegación
   ============================================================ */
function setupNav(){
  document.querySelectorAll('.tabbtn').forEach(function(b){
    b.addEventListener('click', function(){
      var tab = b.getAttribute('data-tab');
      STATE.activeTab = tab;
      document.querySelectorAll('.tabbtn').forEach(function(x){ x.classList.toggle('active', x===b); });
      document.querySelectorAll('section.tab').forEach(function(s){ s.classList.toggle('active', s.id==='tab-'+tab); });
      render();
    });
  });
  document.getElementById('prevMonth').addEventListener('click', function(){
    STATE.currentMonth = new Date(STATE.currentMonth.getFullYear(), STATE.currentMonth.getMonth()-1, 1);
    renderResumen();
  });
  document.getElementById('nextMonth').addEventListener('click', function(){
    STATE.currentMonth = new Date(STATE.currentMonth.getFullYear(), STATE.currentMonth.getMonth()+1, 1);
    renderResumen();
  });
  document.getElementById('themeToggle').addEventListener('click', function(){
    var cur = document.documentElement.getAttribute('data-theme');
    var next = cur==='dark' ? 'light' : (cur==='light' ? '' : (matchMedia('(prefers-color-scheme: dark)').matches ? 'light' : 'dark'));
    if(next===''){ document.documentElement.removeAttribute('data-theme'); }
    else { document.documentElement.setAttribute('data-theme', next); }
    try{ localStorage.setItem('mb_theme', next); }catch(e){}
  });
  try{
    var savedTheme = localStorage.getItem('mb_theme');
    if(savedTheme) document.documentElement.setAttribute('data-theme', savedTheme);
  }catch(e){}
}

function setupBackup(){
  document.getElementById('btnExport').addEventListener('click', function(){
    var data = {app:'mi-billetera', v:1, categories:STATE.categories, transactions:STATE.transactions, debts:STATE.debts};
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data)], {type:'application/json'}));
    a.download = 'mi-billetera-'+toISODate(new Date())+'.json';
    document.body.appendChild(a); a.click(); a.remove();
  });
  var f = document.getElementById('importFile');
  document.getElementById('btnImport').addEventListener('click', function(){ f.click(); });
  f.addEventListener('change', function(){
    var file = f.files[0]; if(!file) return;
    var r = new FileReader();
    r.onload = function(){
      try{
        var d = JSON.parse(r.result);
        if(!Array.isArray(d.categories) || !Array.isArray(d.transactions) || !Array.isArray(d.debts)) throw 0;
        if(!confirm('Esto reemplaza todos tus datos actuales por los del archivo. ¿Seguir?')) { f.value=''; return; }
        STATE.categories = d.categories; STATE.transactions = d.transactions; STATE.debts = d.debts;
        ['categories','transactions','debts'].forEach(function(c){ Store.saveLocal(c); });
        render(); alert('Datos importados.');
      }catch(e){ alert('El archivo no es una copia válida de Mi Billetera.'); }
      f.value='';
    };
    r.readAsText(file);
  });
}

function setupQuickAdd(){
  document.getElementById('quickAddIncome').addEventListener('click', function(){
    STATE.activeTab = 'movimientos';
    document.querySelectorAll('.tabbtn').forEach(function(x){ x.classList.toggle('active', x.getAttribute('data-tab')==='movimientos'); });
    document.querySelectorAll('section.tab').forEach(function(s){ s.classList.toggle('active', s.id==='tab-movimientos'); });
    render();

    txType = 'ingreso';
    document.querySelectorAll('#txTypeSeg button').forEach(function(x){ x.classList.toggle('sel', x.getAttribute('data-val')==='ingreso'); });
    document.getElementById('txCatField').style.display = 'none';
    document.getElementById('txSubcatField').style.display = 'none';
    document.getElementById('ahorroModoField').style.display = 'none';
    populateCategorySelects();
    document.getElementById('txDate').value = toISODate(new Date());
    var f = document.getElementById('txForm');
    if(!f.classList.contains('open')) f.classList.add('open');
    setTimeout(function(){ document.getElementById('txAmount').focus(); }, 300);
  });
}

/* ============================================================
   init
   ============================================================ */
setupNav();
setupTxForm();
setupDebtForm();
setupCatForm();
setupQuickAdd();
setupBackup();
document.getElementById('txDate').value = toISODate(new Date());
Store.init();

if('serviceWorker' in navigator){
  window.addEventListener('load', function(){
    navigator.serviceWorker.register('service-worker.js').catch(function(e){ console.warn('SW registration failed', e); });
  });
}

})();
