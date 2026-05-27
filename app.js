/* =================================================================
   VitalFlow PS v2.0 Intelligence — app.js
   Vitalliz Engenharia de Dados
================================================================= */
'use strict';

// ================================================================
// CONFIGURATION
// ================================================================
const CONFIG = {
  ANAHP: { waitTarget: 30, complianceTarget: 80, stayTarget: 240 },
  USERS: [
    { username: 'admin',  password: 'vitalliz@2026', name: 'Administrador',   role: 'Gestor Geral' },
    { username: 'gestao', password: 'ps@2026',       name: 'Gestão PS',       role: 'Gestor de Unidade' },
    { username: 'viewer', password: 'viewer@2026',   name: 'Visualizador',    role: 'Acesso Leitura' },
  ],
  MONTHS:       ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'],
  MONTHS_SHORT: ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez'],
  WEEKDAYS:     ['Seg','Ter','Qua','Qui','Sex','Sáb','Dom'],
  SHIFTS:       [{ label:'Manhã', hours:[6,7,8,9,10,11] },{ label:'Tarde', hours:[12,13,14,15,16,17] },{ label:'Noite', hours:[18,19,20,21,22,23] }],
};

// ================================================================
// STATE
// ================================================================
const State = {
  user: null,
  data: null,       // current period
  baseData: null,   // comparison year
  filtered: null,
  charts: {},
  filters: { month: 'all', specialty: 'all' },
  baseFilename: null,
  currentFilename: null,
};

// ================================================================
// INDEXEDDB HELPER
// ================================================================
const DB = {
  async get() {
    try {
      const res = await fetch('/api/records');
      if (!res.ok) throw new Error('Failed to fetch records from server');
      return await res.json();
    } catch (e) {
      console.error('API Get Error:', e);
      return null;
    }
  },
  
  async upload(data, isBase) {
    try {
      const res = await fetch(`/api/upload?type=${isBase ? 'base' : 'current'}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(data)
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error || 'Upload failed');
      }
      return await res.json();
    } catch (e) {
      console.error('API Upload Error:', e);
      throw e;
    }
  },

  async clear() {
    try {
      const res = await fetch('/api/clear', {
        method: 'DELETE'
      });
      if (!res.ok) throw new Error('Failed to clear database');
      return await res.json();
    } catch (e) {
      console.error('API Clear Error:', e);
      throw e;
    }
  }
};

// ================================================================
// UTILITIES
// ================================================================
const U = {
  parseMin(str) {
    if (!str) return null;
    const s = str.toString().trim();
    const hm = s.match(/(\d+)\s*h\s*(\d+\.?\d*)\s*m/i);
    if (hm) return Math.round(+hm[1] * 60 + parseFloat(hm[2]));
    const m = s.match(/^(\d+\.?\d*)\s*m$/i);
    if (m) return Math.round(parseFloat(m[1]));
    return null;
  },
  parseDate(str) {
    if (!str) return null;
    const m = str.toString().match(/(\d{2})\.(\d{2})\.(\d{4})/);
    return m ? new Date(+m[3], +m[2]-1, +m[1]) : null;
  },
  parseHour(str) {
    if (!str) return null;
    const m = str.toString().match(/^(\d{1,2}):/);
    return m ? +m[1] : null;
  },
  normDOW(raw) {
    if (!raw) return '';
    const s = raw.trim();
    if (/^S.{0,2}b$/.test(s)) return 'Sáb';
    return s;
  },
  fmtMin(min) {
    if (min === null || min === undefined || isNaN(min)) return '—';
    const h = Math.floor(min/60), m = Math.round(min%60);
    return h === 0 ? `${m}min` : `${h}h ${String(m).padStart(2,'0')}min`;
  },
  fmtDate(d) { return d ? d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'; },
  avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; },
  std(arr) {
    const a = U.avg(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+(v-a)**2,0)/arr.length);
  },
  heatColor(r) {
    r = Math.min(Math.max(r,0),1);
    if (r<=0.5) { const t=r*2; return `rgb(${Math.round(16+(245-16)*t)},${Math.round(185+(158-185)*t)},${Math.round(129+(11-129)*t)})`; }
    const t=(r-0.5)*2; return `rgb(${Math.round(245+(239-245)*t)},${Math.round(158+(68-158)*t)},${Math.round(11+(68-11)*t)})`;
  },
  dateKey(d) { return `${d.year}-${String(d.month).padStart(2,'0')}-${String(d.day).padStart(2,'0')}`; },
  groupKey(arr,fn) { return arr.reduce((a,d)=>{ const k=fn(d); if(!a[k])a[k]=[]; a[k].push(d); return a; },{}); },
};

// ================================================================
// AUTH
// ================================================================
const Auth = {
  KEY: 'vfps_auth_v2',
  login(u, p) {
    const usr = CONFIG.USERS.find(x=>x.username.toLowerCase()===u.trim().toLowerCase()&&x.password===p);
    if (!usr) return false;
    const s = { ...usr, ts: Date.now() };
    sessionStorage.setItem(this.KEY, JSON.stringify(s));
    State.user = s; return true;
  },
  logout() { sessionStorage.removeItem(this.KEY); State.user = null; },
  check() {
    try {
      const s = JSON.parse(sessionStorage.getItem(this.KEY)||'null');
      if (!s) return false;
      if (Date.now()-s.ts > 8*3600*1000) { sessionStorage.removeItem(this.KEY); return false; }
      State.user = s; return true;
    } catch { return false; }
  },
};

// ================================================================
// CSV PARSER
// ================================================================
const Parser = {
  parse(text) {
    return new Promise((res, rej) => {
      Papa.parse(text,{delimiter:';',header:false,skipEmptyLines:true,
        complete:({data})=>{ try{res(this.rows(data));}catch(e){rej(e);} },error:rej});
    });
  },
  rows(all) {
    return all.slice(1).map(r=>{
      if (!r||r.length<8||!r[2]?.trim()) return null;
      const date = U.parseDate(r[2]);
      if (!date||isNaN(date)) return null;
      return {
        id: r[3]?.trim() || 'NÃO INFORMADO',
        name: r[4]?.trim() || 'PACIENTE ANÔNIMO',
        dow: U.normDOW(r[1]), date, month:date.getMonth()+1, day:date.getDate(), year:date.getFullYear(),
        specialty: r[5]?.trim()||'NÃO INFORMADO',
        entryHour: U.parseHour(r[6]),
        waitTime:  U.parseMin(r[7]),
        stayTime:  U.parseMin(r[8]),
      };
    }).filter(Boolean);
  },
};

// ================================================================
// KPI ENGINE
// ================================================================
const KPI = {
  calc(data) {
    const ww = data.filter(d=>d.waitTime!==null&&d.waitTime>=0);
    const ws = data.filter(d=>d.stayTime!==null&&d.stayTime>=0);
    const avgWait = U.avg(ww.map(d=>d.waitTime));
    const avgStay = U.avg(ws.map(d=>d.stayTime));
    const compliance = ww.length ? ww.filter(d=>d.waitTime<=CONFIG.ANAHP.waitTarget).length/ww.length*100 : 0;
    const byDate = U.groupKey(data, d=>U.dateKey(d));
    const days = Object.values(byDate);
    const hourMap = {};
    data.forEach(d=>{ if(d.entryHour!==null) hourMap[d.entryHour]=(hourMap[d.entryHour]||0)+1; });
    const peakEntry = Object.entries(hourMap).sort((a,b)=>b[1]-a[1])[0];
    const byMonth = U.groupKey(ww, d=>d.month);
    const monthStats = Object.entries(byMonth).map(([m,items])=>({
      month:+m, name:CONFIG.MONTHS[+m-1],
      avg: U.avg(items.map(x=>x.waitTime)),
      count:items.length,
      compliance:items.filter(d=>d.waitTime<=CONFIG.ANAHP.waitTarget).length/items.length*100,
    })).sort((a,b)=>a.month-b.month);
    const bySpec = U.groupKey(ww, d=>d.specialty);
    const specialtyStats = Object.entries(bySpec).map(([name,items])=>({
      name, avg:U.avg(items.map(x=>x.waitTime)), count:items.length,
      compliance:items.filter(d=>d.waitTime<=CONFIG.ANAHP.waitTarget).length/items.length*100,
    })).sort((a,b)=>b.avg-a.avg);
    const best  = monthStats.length ? [...monthStats].sort((a,b)=>a.avg-b.avg)[0] : null;
    const worst = monthStats.length ? [...monthStats].sort((a,b)=>b.avg-a.avg)[0] : null;
    return {
      total:data.length, validWait:ww.length,
      avgWait:+avgWait.toFixed(1), avgStay:+avgStay.toFixed(1),
      compliance:+compliance.toFixed(1),
      avgDaily:Math.round(data.length/(days.length||1)),
      totalDays:days.length,
      peakHour: peakEntry?+peakEntry[0]:null, peakVol: peakEntry?+peakEntry[1]:0,
      monthStats, specialtyStats, bestMonth:best, worstMonth:worst,
    };
  },

  oee(kpis) {
    const c1 = Math.min(kpis.compliance/CONFIG.ANAHP.complianceTarget, 1)*100;
    const c2 = Math.max(0, Math.min((2*CONFIG.ANAHP.waitTarget - kpis.avgWait)/CONFIG.ANAHP.waitTarget,1))*100;
    const c3 = Math.max(0, Math.min((2*CONFIG.ANAHP.stayTarget - kpis.avgStay)/CONFIG.ANAHP.stayTarget,1))*100;
    const score = +(c1*0.40 + c2*0.35 + c3*0.25).toFixed(1);
    const cls = score>=85?'A':score>=70?'B':score>=55?'C':'D';
    return { score, cls, c1:+c1.toFixed(1), c2:+c2.toFixed(1), c3:+c3.toFixed(1) };
  },

  dailyEvolution(data) {
    const byDate = U.groupKey(data, d=>U.dateKey(d));
    return Object.entries(byDate).map(([,items])=>{
      const ww = items.filter(d=>d.waitTime!==null);
      return { date:items[0].date, volume:items.length,
               avgWait:ww.length?+U.avg(ww.map(d=>d.waitTime)).toFixed(1):null };
    }).sort((a,b)=>a.date-b.date);
  },

  worstDays(data, n=10) {
    const ww = data.filter(d=>d.waitTime!==null);
    const byDate = U.groupKey(ww, d=>U.dateKey(d));
    return Object.entries(byDate).map(([,items])=>{
      const avg = U.avg(items.map(d=>d.waitTime));
      const comp = items.filter(d=>d.waitTime<=CONFIG.ANAHP.waitTarget).length/items.length*100;
      return { date:items[0].date, dow:items[0].dow, avg, volume:items.length, compliance:comp,
               maxWait:Math.max(...items.map(d=>d.waitTime)) };
    }).sort((a,b)=>b.avg-a.avg).slice(0,n);
  },

  anomalies(data, sigma=2) {
    const ww = data.filter(d=>d.waitTime!==null);
    const byDate = U.groupKey(ww, d=>U.dateKey(d));
    const daily = Object.entries(byDate).map(([,items])=>({
      date:items[0].date, dow:items[0].dow,
      avg:U.avg(items.map(d=>d.waitTime)), volume:items.length,
    }));
    const avgs = daily.map(d=>d.avg);
    const mean = U.avg(avgs), sd = U.std(avgs);
    return daily.map(d=>({ ...d, z:(d.avg-mean)/(sd||1) }))
      .filter(d=>d.z>sigma).sort((a,b)=>b.z-a.z);
  },

  heatmap(data) {
    const M = {};
    CONFIG.WEEKDAYS.forEach(d=>{ M[d]={}; for(let h=0;h<24;h++) M[d][h]={sum:0,count:0}; });
    data.forEach(d=>{ if(d.entryHour===null||!M[d.dow]) return; const c=M[d.dow][d.entryHour]; if(!c)return; c.count++; if(d.waitTime!==null)c.sum+=d.waitTime; });
    return M;
  },

  capacity(data) {
    const M = {};
    CONFIG.WEEKDAYS.forEach(d=>{ M[d]={}; CONFIG.SHIFTS.forEach(s=>{ M[d][s.label]={count:0,days:new Set()}; }); });
    data.forEach(d=>{
      if(d.entryHour===null||!M[d.dow]) return;
      const sh = CONFIG.SHIFTS.find(s=>s.hours.includes(d.entryHour));
      if(!sh) return;
      M[d.dow][sh.label].count++;
      M[d.dow][sh.label].days.add(U.dateKey(d));
    });
    // avg per day
    const R = {};
    CONFIG.WEEKDAYS.forEach(d=>{ R[d]={}; CONFIG.SHIFTS.forEach(s=>{ const c=M[d][s.label]; R[d][s.label]=c.days.size?Math.round(c.count/c.days.size):0; }); });
    return R;
  },

  monthlyByYear(data) {
    const byYear = U.groupKey(data.filter(d=>d.waitTime!==null), d=>d.year);
    const res = {};
    Object.entries(byYear).forEach(([yr,items])=>{
      const byM = U.groupKey(items, d=>d.month);
      res[yr] = {};
      Object.entries(byM).forEach(([m,its])=>{ res[yr][+m]=+U.avg(its.map(d=>d.waitTime)).toFixed(1); });
    });
    return res;
  },

  forecast(daily, horizon=30) {
    if (daily.length < 14) return null;
    const vals = daily.filter(d=>d.avgWait!==null).map(d=>d.avgWait);
    if (vals.length < 10) return null;

    // Simple double exponential smoothing (Holt)
    const α=0.3, β=0.1;
    let s=vals[0], b=(vals[1]-vals[0]);
    const smoothed=[s];
    for(let i=1;i<vals.length;i++){
      const sNew=α*vals[i]+(1-α)*(s+b);
      b=β*(sNew-s)+(1-β)*b;
      s=sNew;
      smoothed.push(s);
    }

    // Seasonal component (weekly, period=7) from detrended series
    const period=7;
    const detrend = vals.map((v,i)=>v-smoothed[i]);
    const seasonal=Array.from({length:period},(_,p)=>{
      const ws=detrend.filter((_,i)=>i%period===p);
      return ws.length?U.avg(ws):0;
    });

    // Build future dates
    const lastDate = daily[daily.length-1].date;
    const predictions=[];
    let sd=U.std(vals.slice(-14));

    for(let i=1;i<=horizon;i++){
      const fDate=new Date(lastDate);
      fDate.setDate(fDate.getDate()+i);
      const dow=fDate.getDay(); // 0=Sun
      const adj=seasonal[(((dow-1)+7)%7)%period];
      const base=s+b*i+adj;
      predictions.push({
        date:fDate,
        value: Math.max(5, +base.toFixed(1)),
        lo:    Math.max(0, +(base-1.28*sd).toFixed(1)),
        hi:    +(base+1.28*sd).toFixed(1),
      });
    }
    return { predictions, trend: b>0?'alta':b<0?'baixa':'estável' };
  },
};

// ================================================================
// CHART HELPERS
// ================================================================
const TT = { backgroundColor:'#0F1A2E',titleColor:'#F8FAFC',bodyColor:'#94A3B8',borderColor:'rgba(99,102,241,0.30)',borderWidth:1,padding:12,cornerRadius:8,displayColors:true,boxWidth:10,boxHeight:10 };
const LEG = { labels:{ color:'#94A3B8',font:{family:'Inter',size:12},boxWidth:10,usePointStyle:true,padding:16 } };
const SX = { ticks:{color:'#94A3B8',font:{family:'Inter',size:11}},grid:{color:'rgba(148,163,184,0.10)'} };
const SY = (ex={}) => ({ ticks:{color:'#94A3B8',font:{family:'Inter'},...ex},grid:{color:'rgba(148,163,184,0.10)'} });

// ================================================================
// CHARTS
// ================================================================
const Charts = {
  kill(id) { if(State.charts[id]){State.charts[id].destroy();delete State.charts[id];} },

  monthly(kpis, baseKpis) {
    this.kill('monthly');
    const ctx = document.getElementById('chartMonthly')?.getContext('2d');
    if (!ctx||!kpis.monthStats.length) return;
    const s=kpis.monthStats;
    const datasets=[{
      label:'Tempo Médio (min)',data:s.map(x=>+x.avg.toFixed(1)),
      borderColor:'#6366F1',backgroundColor:'rgba(99,102,241,0.12)',fill:true,tension:0.45,
      pointBackgroundColor:'#6366F1',pointBorderColor:'#fff',pointBorderWidth:2,pointRadius:6,pointHoverRadius:9,yAxisID:'y',
    },{
      label:'% Conform. ≤30min',data:s.map(x=>+x.compliance.toFixed(1)),
      borderColor:'#10B981',backgroundColor:'rgba(16,185,129,0.05)',fill:false,tension:0.45,borderDash:[6,3],
      pointBackgroundColor:'#10B981',pointBorderColor:'#fff',pointBorderWidth:2,pointRadius:6,pointHoverRadius:9,yAxisID:'y2',
    }];
    if (baseKpis) {
      datasets.push({
        label:'Tempo Médio Ano Base',data:s.map(x=>{ const bm=baseKpis.monthStats.find(b=>b.month===x.month); return bm?+bm.avg.toFixed(1):null; }),
        borderColor:'#A78BFA',backgroundColor:'transparent',fill:false,tension:0.45,borderDash:[4,4],
        pointBackgroundColor:'#A78BFA',pointRadius:5,pointHoverRadius:8,yAxisID:'y',spanGaps:true,
      });
    }
    State.charts.monthly=new Chart(ctx,{type:'line',data:{labels:s.map(x=>CONFIG.MONTHS_SHORT[x.month-1]),datasets},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>ctx.datasetIndex===0||ctx.datasetIndex===2?` ${ctx.parsed.y} min`:` ${ctx.parsed.y}%`}}},
        scales:{x:SX,y:{...SY({callback:v=>v+'min'}),title:{display:true,text:'Tempo (min)',color:'#6366F1',font:{size:11}}},
          y2:{position:'right',min:0,max:100,ticks:{color:'#10B981',callback:v=>v+'%'},grid:{display:false},title:{display:true,text:'Conformidade (%)',color:'#10B981',font:{size:11}}}}}});
  },

  yoy(currentData, baseData) {
    this.kill('yoy');
    const ctx = document.getElementById('chartYoY')?.getContext('2d');
    if (!ctx) return;
    const combined = [...currentData, ...baseData];
    const byYear = KPI.monthlyByYear(combined);
    const years = Object.keys(byYear).sort();
    const months = [...new Set(combined.map(d=>d.month))].sort((a,b)=>a-b);
    const colors = ['rgba(99,102,241,0.80)','rgba(167,139,250,0.80)'];
    const datasets = years.map((yr,i)=>({
      label:`${yr}`,
      data:months.map(m=>byYear[yr][m]??null),
      backgroundColor:colors[i%2],borderRadius:5,borderSkipped:false,
    }));
    State.charts.yoy=new Chart(ctx,{type:'bar',data:{labels:months.map(m=>CONFIG.MONTHS_SHORT[m-1]),datasets},
      options:{responsive:true,maintainAspectRatio:false,
        plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${ctx.parsed.y} min`}}},
        scales:{x:SX,y:{...SY({callback:v=>v+'min'})}}}});
  },

  specialty(kpis) {
    this.kill('specialty');
    const ctx = document.getElementById('chartSpecialty')?.getContext('2d');
    if (!ctx||!kpis.specialtyStats.length) return;
    const st = kpis.specialtyStats.slice(0,10);
    const colors = st.map(s=>s.avg>CONFIG.ANAHP.waitTarget?'rgba(239,68,68,0.80)':'rgba(16,185,129,0.80)');
    State.charts.specialty=new Chart(ctx,{type:'bar',data:{labels:st.map(s=>s.name),datasets:[{
      label:'Tempo Médio (min)',data:st.map(s=>+s.avg.toFixed(1)),
      backgroundColor:colors,borderColor:colors.map(c=>c.replace('0.80','1')),borderWidth:1,borderRadius:6,borderSkipped:false,
    }]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:ctx=>[` Tempo: ${ctx.parsed.x.toFixed(1)} min`,` Volume: ${st[ctx.dataIndex].count.toLocaleString('pt-BR')}`,` Conform.: ${st[ctx.dataIndex].compliance.toFixed(1)}%`]}}},
      scales:{x:{...SX,ticks:{...SX.ticks,callback:v=>v+'min'}},y:{ticks:{color:'#F8FAFC',font:{family:'Inter',size:11}},grid:{display:false}}}}});
  },

  distribution(data) {
    this.kill('distribution');
    const ctx = document.getElementById('chartDistribution')?.getContext('2d');
    if (!ctx) return;
    const vals = data.filter(d=>d.waitTime!==null).map(d=>d.waitTime);
    if (!vals.length) return;
    const BIN=10, MAX=130;
    const bins=[];
    for(let i=0;i<MAX;i+=BIN) bins.push({label:i>=MAX-BIN?`+${i}m`:`${i}–${i+BIN}m`,min:i,count:0});
    vals.forEach(v=>{ const idx=Math.min(Math.floor(v/BIN),bins.length-1); if(idx>=0)bins[idx].count++; });
    const total=vals.length;
    State.charts.distribution=new Chart(ctx,{type:'bar',data:{labels:bins.map(b=>b.label),datasets:[{
      label:'% Atendimentos',data:bins.map(b=>+(b.count/total*100).toFixed(1)),
      backgroundColor:bins.map(b=>b.min<30?'rgba(16,185,129,0.78)':b.min<60?'rgba(245,158,11,0.78)':'rgba(239,68,68,0.78)'),
      borderRadius:4,borderSkipped:false,
    }]},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:ctx=>[` ${ctx.parsed.y}%`,` ${bins[ctx.dataIndex].count.toLocaleString('pt-BR')} pacientes`]}}},
      scales:{x:{...SX,ticks:{...SX.ticks,maxRotation:45,font:{size:10}}},y:SY({callback:v=>v+'%'})}}});
  },

  daily(daily) {
    this.kill('daily');
    const ctx=document.getElementById('chartDaily')?.getContext('2d');
    if(!ctx||!daily.length) return;
    const labels=daily.map(d=>`${String(d.date.getDate()).padStart(2,'0')}/${String(d.date.getMonth()+1).padStart(2,'0')}`);
    
    // 7-day moving average calculation
    const ma = [];
    for (let i = 0; i < daily.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) {
        if (daily[j].avgWait !== null) {
          sum += daily[j].avgWait;
          count++;
        }
      }
      ma.push(count > 0 ? +(sum / count).toFixed(1) : null);
    }

    State.charts.daily=new Chart(ctx,{type:'bar',data:{labels,datasets:[
      {type:'bar',label:'Volume',data:daily.map(d=>d.volume),backgroundColor:'rgba(99,102,241,0.35)',borderColor:'rgba(99,102,241,0.70)',borderWidth:1,borderRadius:2,yAxisID:'y2'},
      {type:'line',label:'Tempo Médio Espera (min)',data:daily.map(d=>d.avgWait),borderColor:'#F59E0B',backgroundColor:'rgba(245,158,11,0.08)',fill:false,tension:0.3,pointRadius:0,pointHoverRadius:6,borderWidth:2,yAxisID:'y',spanGaps:true},
      {type:'line',label:'Média Móvel 7 Dias',data:ma,borderColor:'#A78BFA',backgroundColor:'transparent',fill:false,tension:0.3,pointRadius:0,pointHoverRadius:4,borderWidth:2,borderDash:[4,4],yAxisID:'y',spanGaps:true},
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>ctx.datasetIndex===0?` Volume: ${ctx.parsed.y}`:ctx.datasetIndex===1?` Espera: ${ctx.parsed.y} min`:` Média Móvel 7d: ${ctx.parsed.y} min`}}},
      scales:{x:{...SX,ticks:{...SX.ticks,maxTicksLimit:20,maxRotation:45,font:{size:9}}},
        y:{...SY({callback:v=>v+'min',color:'#F59E0B'}),title:{display:true,text:'Tempo (min)',color:'#F59E0B',font:{size:11}}},
        y2:{position:'right',ticks:{color:'#6366F1'},grid:{display:false},title:{display:true,text:'Volume',color:'#6366F1',font:{size:11}}}}}});
  },

  weekday(data) {
    this.kill('weekday');
    const ctx=document.getElementById('chartWeekday')?.getContext('2d');
    if(!ctx) return;
    const M={};
    data.forEach(d=>{ if(!d.dow)return; if(!M[d.dow])M[d.dow]={ws:0,wc:0,vol:0}; M[d.dow].vol++; if(d.waitTime!==null){M[d.dow].ws+=d.waitTime;M[d.dow].wc++;} });
    const labels=CONFIG.WEEKDAYS.filter(d=>M[d]);
    const avgs=labels.map(d=>M[d].wc?+U.avg([M[d].ws/M[d].wc]).toFixed(1):0);
    State.charts.weekday=new Chart(ctx,{type:'bar',data:{labels,datasets:[
      {type:'bar',label:'Tempo Médio (min)',data:avgs,backgroundColor:avgs.map(v=>v>CONFIG.ANAHP.waitTarget?'rgba(239,68,68,0.75)':'rgba(99,102,241,0.75)'),borderRadius:7,yAxisID:'y'},
      {type:'line',label:'Volume Total',data:labels.map(d=>M[d].vol),borderColor:'#F59E0B',backgroundColor:'transparent',pointBackgroundColor:'#F59E0B',pointBorderColor:'#fff',pointBorderWidth:2,pointRadius:7,tension:0.4,yAxisID:'y2'},
    ]},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>ctx.datasetIndex===0?` Espera: ${ctx.parsed.y} min`:` Volume: ${ctx.parsed.y.toLocaleString('pt-BR')}`}}},
      scales:{x:{...SX,ticks:{...SX.ticks,font:{size:12,weight:'600'}}},
        y:{...SY({callback:v=>v+'min'}),title:{display:true,text:'Tempo (min)',color:'#6366F1',font:{size:11}}},
        y2:{position:'right',ticks:{color:'#F59E0B'},grid:{display:false},title:{display:true,text:'Volume',color:'#F59E0B',font:{size:11}}}}}});
  },

  forecast(daily) {
    this.kill('forecast');
    const ctx=document.getElementById('chartForecast')?.getContext('2d');
    if(!ctx) return;
    const fc=KPI.forecast(daily, 30);
    if(!fc) { ctx.canvas.closest('.chart-body').innerHTML='<p style="padding:20px;color:var(--text-3);text-align:center">Dados insuficientes para previsão (mínimo 14 dias com registro)</p>'; return; }

    const histLabels = daily.slice(-60).map(d=>`${String(d.date.getDate()).padStart(2,'0')}/${String(d.date.getMonth()+1).padStart(2,'0')}`);
    const histVals   = daily.slice(-60).map(d=>d.avgWait);
    const fcLabels   = fc.predictions.map(p=>`${String(p.date.getDate()).padStart(2,'0')}/${String(p.date.getMonth()+1).padStart(2,'0')}`);
    const allLabels  = [...histLabels, ...fcLabels];
    const histData   = [...histVals, ...Array(fcLabels.length).fill(null)];
    const fcData     = [...Array(histLabels.length).fill(null), ...fc.predictions.map(p=>p.value)];
    const loData     = [...Array(histLabels.length).fill(null), ...fc.predictions.map(p=>p.lo)];
    const hiData     = [...Array(histLabels.length).fill(null), ...fc.predictions.map(p=>p.hi)];

    State.charts.forecast=new Chart(ctx,{type:'line',data:{labels:allLabels,datasets:[
      {label:'Histórico',data:histData,borderColor:'#6366F1',backgroundColor:'rgba(99,102,241,0.08)',fill:true,tension:0.3,pointRadius:0,pointHoverRadius:5,borderWidth:2,spanGaps:false},
      {label:'Previsão',data:fcData,borderColor:'#A78BFA',backgroundColor:'rgba(167,139,250,0.08)',fill:false,tension:0.4,pointRadius:4,pointHoverRadius:8,borderWidth:2.5,borderDash:[],spanGaps:false},
      {label:'Banda Superior',data:hiData,borderColor:'rgba(167,139,250,0.25)',backgroundColor:'rgba(167,139,250,0.08)',fill:'+1',tension:0.4,pointRadius:0,borderWidth:1,borderDash:[3,3]},
      {label:'Banda Inferior',data:loData,borderColor:'rgba(167,139,250,0.25)',backgroundColor:'rgba(167,139,250,0.08)',fill:false,tension:0.4,pointRadius:0,borderWidth:1,borderDash:[3,3]},
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{...LEG,labels:{...LEG.labels,filter:i=>i.datasetIndex<2}},tooltip:{...TT,callbacks:{
        label:ctx=>{ if(ctx.datasetIndex===0) return ` Histórico: ${ctx.parsed.y} min`; if(ctx.datasetIndex===1) return ` Previsto: ${ctx.parsed.y} min`; return ''; }
      }}},
      scales:{x:{...SX,ticks:{...SX.ticks,maxTicksLimit:18,maxRotation:45,font:{size:9}}},
        y:{...SY({callback:v=>v+'min'})}}}});

    // Risk badges
    const badgeEl=document.getElementById('forecastRiskBadges');
    if(badgeEl){
      const weeks=[0,7,14,21].map(s=>({label:s===0?'Próx. 7d':s===7?'7–14d':s===14?'14–21d':'21–30d',avg:U.avg(fc.predictions.slice(s,s+7).map(p=>p.value))}));
      badgeEl.innerHTML=weeks.map(w=>{
        const cls=w.avg<=CONFIG.ANAHP.waitTarget?'risk-ok':w.avg<=CONFIG.ANAHP.waitTarget*1.5?'risk-warn':'risk-bad';
        return `<span class="risk-badge ${cls}">${w.label}: ${w.avg.toFixed(0)}min</span>`;
      }).join('');
    }
  },

  pareto(kpis) {
    this.kill('pareto');
    const ctx = document.getElementById('chartPareto')?.getContext('2d');
    if (!ctx || !kpis.specialtyStats.length) return;
    
    // Top 7 specialties by total wait hours (average wait time * volume of patients)
    const specs = kpis.specialtyStats.map(s => ({
      name: s.name,
      totalWait: s.avg * s.count
    })).sort((a,b) => b.totalWait - a.totalWait).slice(0, 7);
    
    const sumTotal = specs.reduce((sum, s) => sum + s.totalWait, 0);
    let cumulative = 0;
    const cumPercentages = specs.map(s => {
      cumulative += s.totalWait;
      return sumTotal > 0 ? +(cumulative / sumTotal * 100).toFixed(1) : 0;
    });

    State.charts.pareto = new Chart(ctx, {
      data: {
        labels: specs.map(s => s.name),
        datasets: [
          {
            type: 'bar',
            label: 'Espera Total Acumulada (h)',
            data: specs.map(s => +(s.totalWait / 60).toFixed(1)),
            backgroundColor: 'rgba(99, 102, 241, 0.75)',
            borderRadius: 5,
            yAxisID: 'y',
            order: 2
          },
          {
            type: 'line',
            label: '% Acumulado',
            data: cumPercentages,
            borderColor: '#EF4444',
            backgroundColor: 'transparent',
            pointBackgroundColor: '#EF4444',
            pointRadius: 4,
            tension: 0.2,
            yAxisID: 'y2',
            order: 1
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: LEG,
          tooltip: {
            ...TT,
            callbacks: {
              label: ctx => ctx.datasetIndex === 0 ? ` Espera: ${ctx.parsed.y} horas` : ` Acumulado: ${ctx.parsed.y}%`
            }
          }
        },
        scales: {
          x: { ...SX, ticks: { ...SX.ticks, font: { size: 9 } } },
          y: { ...SY({ callback: v => v + 'h' }), title: { display: true, text: 'Espera Acumulada (h)', color: '#6366F1', font: { size: 10 } } },
          y2: {
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#EF4444', callback: v => v + '%' },
            grid: { display: false },
            title: { display: true, text: '% Acumulado', color: '#EF4444', font: { size: 10 } }
          }
        }
      }
    });
  },

  oeeGauge(score) {
    const canvas=document.getElementById('oeeGauge');
    if(!canvas) return;
    const ctx=canvas.getContext('2d');
    const cx=90, cy=90, r=65, start=Math.PI, end=2*Math.PI;
    ctx.clearRect(0,0,180,100);
    // Background arc
    ctx.beginPath(); ctx.arc(cx,cy,r,start,end); ctx.strokeStyle='rgba(148,163,184,0.15)'; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
    // Score arc
    const filled=start+(end-start)*(score/100);
    const grad=ctx.createLinearGradient(cx-r,cy,cx+r,cy);
    grad.addColorStop(0,'#EF4444'); grad.addColorStop(0.5,'#F59E0B'); grad.addColorStop(1,'#10B981');
    ctx.beginPath(); ctx.arc(cx,cy,r,start,filled); ctx.strokeStyle=grad; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
    // Score text
    const el=document.getElementById('oeeScore');
    if(el){ el.textContent=score.toFixed(1); const color=score>=85?'#10B981':score>=70?'#38BDF8':score>=55?'#F59E0B':'#EF4444'; el.style.color=color; }
  },
};

// ================================================================
// RENDERERS
// ================================================================
const Heatmap = {
  render(data) {
    const el=document.getElementById('heatmapContainer');
    if(!el) return;
    const M=KPI.heatmap(data);
    const days=CONFIG.WEEKDAYS.filter(d=>Object.values(M[d]||{}).some(c=>c.count>0));
    let maxCount=0;
    days.forEach(d=>{ for(let h=0;h<24;h++) if(M[d]?.[h]) maxCount=Math.max(maxCount,M[d][h].count); });
    const hrl=Array.from({length:24},(_,i)=>i%4===0?`${String(i).padStart(2,'0')}h`:'');
    let html=`<div class="heatmap-wrapper"><div class="hm-header"><div class="hm-day-spacer"></div><div class="hm-hour-labels">${hrl.map(l=>`<div class="hm-hour-label">${l}</div>`).join('')}</div></div><div class="hm-body">`;
    days.forEach(day=>{
      html+=`<div class="hm-row"><div class="hm-day-label">${day}</div><div class="hm-cells">`;
      for(let h=0;h<24;h++){
        const c=M[day]?.[h]||{sum:0,count:0};
        const ratio=maxCount>0?c.count/maxCount:0;
        const color=ratio>0.01?U.heatColor(ratio):'rgba(148,163,184,0.06)';
        const op=ratio>0.01?(0.25+ratio*0.75).toFixed(2):'0.35';
        const avgW=c.count>0?Math.round(c.sum/c.count):null;
        const title=c.count>0?`${day} ${String(h).padStart(2,'0')}h: ${c.count} atend. | Espera: ${avgW}min`:`${day} ${String(h).padStart(2,'0')}h: sem dados`;
        html+=`<div class="hm-cell" style="background:${color};opacity:${op}" title="${title}"></div>`;
      }
      html+=`</div></div>`;
    });
    html+=`</div><div class="heatmap-scale"><span>Menor fluxo</span><div class="hm-scale-bar"></div><span>Maior fluxo</span></div></div>`;
    el.innerHTML=html;
  },
};

const AnnualCalendar = {
  render(data) {
    const el=document.getElementById('annualCalendar');
    if(!el) return;
    // Build daily avg map
    const ww=data.filter(d=>d.waitTime!==null);
    const byDate=U.groupKey(ww, d=>U.dateKey(d));
    const avgMap={};
    Object.entries(byDate).forEach(([k,items])=>{ avgMap[k]=U.avg(items.map(d=>d.waitTime)); });
    // Group by month
    const months=[...new Set(data.map(d=>d.month))].sort((a,b)=>a-b);
    const year=data[0].year;
    const DAYS=['D','S','T','Q','Q','S','S'];
    let html='<div class="cal-months-row">';
    months.forEach(m=>{
      const daysInMonth=new Date(year,m,0).getDate();
      const firstDow=(new Date(year,m-1,1).getDay()); // 0=Sun
      html+=`<div class="cal-month"><div class="cal-month-label">${CONFIG.MONTHS_SHORT[m-1]}</div><div class="cal-grid">`;
      DAYS.forEach(d=>{ html+=`<div class="cal-dow">${d}</div>`; });
      // padding
      for(let i=0;i<firstDow;i++) html+=`<div class="cal-cell cal-empty"></div>`;
      for(let d=1;d<=daysInMonth;d++){
        const key=`${year}-${String(m).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
        const avg=avgMap[key];
        let cls='cal-none', title=`${d}/${m}: sem dados`;
        if(avg!==undefined){
          cls=avg<=30?'cal-good':avg<=60?'cal-warn':'cal-bad';
          title=`${d}/${m}: ${avg.toFixed(0)}min de espera`;
        }
        html+=`<div class="cal-cell ${cls}" title="${title}"></div>`;
      }
      html+=`</div></div>`;
    });
    html+='</div>';
    el.innerHTML=html;
  },
};

const CapacityGrid = {
  render(data) {
    const el=document.getElementById('capacityGrid');
    if(!el) return;
    const factor = parseFloat(document.getElementById('capacitySeasonFactor')?.value || '1.0');
    const cap=KPI.capacity(data);
    
    // Compute actual values after applying the seasonality factor
    const computed = {};
    CONFIG.WEEKDAYS.forEach(d => {
      computed[d] = {};
      CONFIG.SHIFTS.forEach(s => {
        const raw = cap[d]?.[s.label] || 0;
        computed[d][s.label] = Math.round(raw * factor);
      });
    });

    const allVals = CONFIG.WEEKDAYS.flatMap(d => CONFIG.SHIFTS.map(s => computed[d][s.label]));
    const mx = Math.max(...allVals) || 1;

    let html='<table class="capacity-grid"><thead><tr><th>Dia</th>';
    CONFIG.SHIFTS.forEach(s=>{ html+=`<th>${s.label}</th>`; });
    html+='</tr></thead><tbody>';
    CONFIG.WEEKDAYS.filter(d=>cap[d]).forEach(d=>{
      html+=`<tr><td class="cap-day-label">${d}</td>`;
      CONFIG.SHIFTS.forEach(s=>{
        const v=computed[d][s.label];
        const r=v/mx;
        const cls=r<0.4?'cap-low':r<0.7?'cap-med':'cap-high';
        html+=`<td><div class="cap-cell ${cls}">${v}</div></td>`;
      });
      html+='</tr>';
    });
    html+='</tbody></table>';
    el.innerHTML=html;
  },
};

const AnomalyTable = {
  render(data) {
    const el=document.getElementById('anomalyTable');
    const badge=document.getElementById('anomalyCount');
    if(!el) return;
    const anom=KPI.anomalies(data, 2);
    if(badge) badge.textContent=`${anom.length} detectadas`;
    if(!anom.length){
      el.innerHTML='<p style="padding:20px;color:var(--text-3);font-size:13px;text-align:center">✅ Nenhuma anomalia estatística detectada neste período</p>';
      return;
    }
    let html='<table class="data-table"><thead><tr><th>Data</th><th>Dia</th><th>Média</th><th>Z-score</th><th>Volume</th></tr></thead><tbody>';
    anom.forEach(d=>{
      const cls=d.z>3?'time-bad':'time-warn';
      html+=`<tr class="${d.z>3?'row-critical':'row-warning'}">
        <td>${U.fmtDate(d.date)}</td><td>${d.dow}</td>
        <td class="${cls}">${U.fmtMin(d.avg)}</td>
        <td class="anomaly-sigma">${d.z.toFixed(2)}σ</td>
        <td>${d.volume}</td></tr>`;
    });
    html+='</tbody></table>';
    el.innerHTML=html;
  },
};

const WorstTable = {
  render(data) {
    const el=document.getElementById('worstDaysTable');
    if(!el) return;
    const worst=KPI.worstDays(data,10);
    if(!worst.length){el.innerHTML='<p style="padding:20px;color:var(--text-3);text-align:center">Sem dados</p>';return;}
    let html='<table class="data-table"><thead><tr><th>#</th><th>Data</th><th>Dia</th><th>Média</th><th>Volume</th><th>Conform.</th></tr></thead><tbody>';
    worst.forEach((d,i)=>{
      const avg=Math.round(d.avg);
      const cls=avg>CONFIG.ANAHP.waitTarget*2?'time-bad':avg>CONFIG.ANAHP.waitTarget?'time-warn':'time-good';
      const row=avg>CONFIG.ANAHP.waitTarget*2?'row-critical':avg>CONFIG.ANAHP.waitTarget?'row-warning':'';
      html+=`<tr class="${row}"><td class="rank-cell">${i+1}°</td><td>${U.fmtDate(d.date)}</td><td>${d.dow}</td><td class="${cls}">${U.fmtMin(d.avg)}</td><td>${d.volume}</td><td class="${d.compliance>=80?'time-good':d.compliance>=60?'time-warn':'time-bad'}">${d.compliance.toFixed(1)}%</td></tr>`;
    });
    html+='</tbody></table>';
    el.innerHTML=html;
  },
};

// ================================================================
// SMART REPORT ENGINE
// ================================================================
const Report = {
  generate(kpis, data) {
    const el=document.getElementById('reportBody');
    if(!el) return;
    const insights=[];

    // 1. Overall status
    const statusEmoji=kpis.avgWait<=CONFIG.ANAHP.waitTarget?'✅':kpis.avgWait<=40?'⚠️':'🔴';
    const statusType=kpis.avgWait<=CONFIG.ANAHP.waitTarget?'good':kpis.avgWait<=40?'warn':'bad';
    insights.push({
      emoji:statusEmoji,title:'Status Geral do Período',type:statusType,
      body:`Tempo médio de espera: <strong>${U.fmtMin(kpis.avgWait)}</strong>. Meta ANAHP: ≤ 30min. Conformidade: <strong>${kpis.compliance}%</strong>.`,
    });

    // 2. Best month
    if(kpis.bestMonth){
      insights.push({
        emoji:'🏆',title:'Melhor Desempenho Mensal',type:'good',
        body:`<strong>${kpis.bestMonth.name}</strong> foi o melhor mês com média de <strong>${U.fmtMin(kpis.bestMonth.avg)}</strong> e conformidade de <strong>${kpis.bestMonth.compliance.toFixed(1)}%</strong>.`,
      });
    }

    // 3. Worst month
    if(kpis.worstMonth&&kpis.worstMonth.month!==kpis.bestMonth?.month){
      const wtype=kpis.worstMonth.avg>45?'bad':'warn';
      insights.push({
        emoji:'📉',title:'Mês Mais Crítico',type:wtype,
        body:`<strong>${kpis.worstMonth.name}</strong> registrou a pior performance: <strong>${U.fmtMin(kpis.worstMonth.avg)}</strong> de espera média e apenas <strong>${kpis.worstMonth.compliance.toFixed(1)}%</strong> de conformidade.`,
      });
    }

    // 4. Worst specialty
    if(kpis.specialtyStats.length){
      const ws=kpis.specialtyStats[0];
      insights.push({
        emoji:'🔬',title:'Especialidade Crítica',type:'bad',
        body:`<strong>${ws.name}</strong> tem a maior espera média: <strong>${U.fmtMin(ws.avg)}</strong> — <strong>${((ws.avg/CONFIG.ANAHP.waitTarget-1)*100).toFixed(0)}%</strong> acima da meta. ${ws.count.toLocaleString('pt-BR')} atendimentos analisados.`,
      });
      const bs=kpis.specialtyStats[kpis.specialtyStats.length-1];
      if(bs.name!==ws.name){
        insights.push({
          emoji:'⭐',title:'Especialidade Destaque',type:'good',
          body:`<strong>${bs.name}</strong> tem o menor tempo médio: <strong>${U.fmtMin(bs.avg)}</strong> com conformidade de <strong>${bs.compliance.toFixed(1)}%</strong>.`,
        });
      }
    }

    // 5. Peak hour
    if(kpis.peakHour!==null){
      insights.push({
        emoji:'📈',title:'Horário de Pico Identificado',type:'warn',
        body:`O maior volume de chegadas ocorre às <strong>${String(kpis.peakHour).padStart(2,'0')}h</strong>. Recomenda-se escala reforçada neste horário para manter a meta ANAHP.`,
      });
    }

    // 6. Volume
    insights.push({
      emoji:'👥',title:'Volume de Atendimentos',type:'info',
      body:`Total de <strong>${kpis.total.toLocaleString('pt-BR')}</strong> atendimentos em <strong>${kpis.totalDays}</strong> dias. Média diária: <strong>${kpis.avgDaily}</strong> atendimentos/dia.`,
    });

    // 7. Anomalies
    const anom=KPI.anomalies(data);
    if(anom.length){
      insights.push({
        emoji:'🔴',title:'Anomalias Detectadas',type:'bad',
        body:`<strong>${anom.length}</strong> dia${anom.length>1?'s com desvio':' com desvio'} estatístico acima de 2σ. Dia mais crítico: <strong>${U.fmtDate(anom[0].date)}</strong> (${U.fmtMin(anom[0].avg)}, Z=${anom[0].z.toFixed(2)}).`,
      });
    } else {
      insights.push({
        emoji:'✅',title:'Consistência Estatística',type:'good',
        body:'Nenhum dia com desvio estatístico acima de 2σ detectado — o fluxo está dentro da normalidade esperada.',
      });
    }

    el.innerHTML=insights.map(i=>`<div class="report-insight insight-${i.type}"><div class="ri-header"><span class="ri-emoji">${i.emoji}</span><span class="ri-title">${i.title}</span></div><div class="ri-body">${i.body}</div></div>`).join('');
  },
};

// ================================================================
// OEE UI
// ================================================================
const OEE = {
  update(kpis) {
    const oee=KPI.oee(kpis);
    Charts.oeeGauge(oee.score);
    const badgeEl=document.getElementById('oeeClassBadge');
    if(badgeEl){ badgeEl.textContent=`Classe ${oee.cls}`; badgeEl.className=`oee-class-badge oee-class-${oee.cls}`; }
    const tips={A:'Excelente! Mantenha o desempenho atual.',B:`Bom desempenho. Para atingir Classe A, reduza o tempo médio em ${Math.max(0,kpis.avgWait-CONFIG.ANAHP.waitTarget).toFixed(0)}min.`,C:'Atenção — múltiplos indicadores abaixo da meta. Revise a escala médica.',D:'Crítico — intervenção imediata recomendada. Considere revisão dos processos de triagem.'};
    const tip=document.getElementById('oeeTip');
    if(tip) tip.textContent=tips[oee.cls];
    ['1','2','3'].forEach((n,i)=>{
      const v=[oee.c1,oee.c2,oee.c3][i];
      const bar=document.getElementById(`oeeBar${n}`); const val=document.getElementById(`oeeVal${n}`);
      if(bar) bar.style.width=`${v}%`;
      if(val) val.textContent=`${v.toFixed(0)}%`;
    });
  },
};

// ================================================================
// SCORECARD TABLE
// ================================================================
const Scorecard = {
  render(kpis, baseKpis) {
    const container = document.getElementById('scorecardTable');
    if (!container) return;
    
    const currentData = State.filtered || State.data;
    if (!currentData || !currentData.length) {
      container.innerHTML = '<p style="padding:20px;color:var(--text-3);text-align:center">Sem dados carregados para o scorecard</p>';
      return;
    }

    // Group by month
    const byMonth = U.groupKey(currentData, d => d.month);
    const monthsInData = Object.keys(byMonth).map(Number).sort((a,b) => a - b);
    
    if (!monthsInData.length) {
      container.innerHTML = '<p style="padding:20px;color:var(--text-3);text-align:center">Sem dados de meses</p>';
      return;
    }

    // Calculate monthly stats
    const monthlyStats = monthsInData.map(m => {
      const items = byMonth[m] || [];
      const ww = items.filter(d => d.waitTime !== null && d.waitTime >= 0);
      const ws = items.filter(d => d.stayTime !== null && d.stayTime >= 0);
      
      return {
        month: m,
        name: CONFIG.MONTHS_SHORT[m - 1],
        avgWait: ww.length ? U.avg(ww.map(d => d.waitTime)) : null,
        compliance: ww.length ? (ww.filter(d => d.waitTime <= CONFIG.ANAHP.waitTarget).length / ww.length * 100) : 0,
        avgStay: ws.length ? U.avg(ws.map(d => d.stayTime)) : null,
        volume: items.length
      };
    });

    const rows = [
      {
        name: 'Tempo Médio de Espera',
        target: `≤ ${CONFIG.ANAHP.waitTarget} min`,
        unit: ' min',
        valFn: s => s.avgWait !== null ? s.avgWait.toFixed(1) + ' min' : '—',
        avgVal: kpis.avgWait.toFixed(1),
        statusFn: v => v <= CONFIG.ANAHP.waitTarget ? 'good' : v <= 40 ? 'warn' : 'bad'
      },
      {
        name: 'Conformidade de Espera',
        target: `≥ ${CONFIG.ANAHP.complianceTarget}%`,
        unit: '%',
        valFn: s => s.compliance !== null ? s.compliance.toFixed(1) + '%' : '—',
        avgVal: kpis.compliance.toFixed(1),
        statusFn: v => v >= CONFIG.ANAHP.complianceTarget ? 'good' : v >= 70 ? 'warn' : 'bad'
      },
      {
        name: 'Tempo Médio de Permanência',
        target: `≤ ${CONFIG.ANAHP.stayTarget} min`,
        unit: ' min',
        valFn: s => s.avgStay !== null ? Math.round(s.avgStay) + ' min' : '—',
        avgVal: Math.round(kpis.avgStay),
        statusFn: v => v <= CONFIG.ANAHP.stayTarget ? 'good' : v <= 300 ? 'warn' : 'bad'
      },
      {
        name: 'Volume de Atendimentos',
        target: '—',
        unit: '',
        valFn: s => s.volume.toLocaleString('pt-BR'),
        avgVal: kpis.total.toLocaleString('pt-BR'),
        statusFn: () => 'neutral'
      }
    ];

    let html = `<table class="scorecard-table">
      <thead>
        <tr>
          <th>Indicador</th>
          <th>Meta ANAHP</th>
          ${monthlyStats.map(s => `<th>${s.name}</th>`).join('')}
          <th>Período Geral</th>
        </tr>
      </thead>
      <tbody>`;

    rows.forEach(r => {
      html += `<tr>
        <td><strong>${r.name}</strong></td>
        <td><span class="sc-val text-3">${r.target}</span></td>`;
        
      monthlyStats.forEach(s => {
        let valStr = '—';
        let cls = '';
        if (r.name === 'Tempo Médio de Espera' && s.avgWait !== null) {
          valStr = `${s.avgWait.toFixed(1)}m`;
          cls = `time-${r.statusFn(s.avgWait)}`;
        } else if (r.name === 'Conformidade de Espera') {
          valStr = `${s.compliance.toFixed(1)}%`;
          cls = `time-${r.statusFn(s.compliance)}`;
        } else if (r.name === 'Tempo Médio de Permanência' && s.avgStay !== null) {
          valStr = U.fmtMin(s.avgStay);
          cls = `time-${r.statusFn(s.avgStay)}`;
        } else if (r.name === 'Volume de Atendimentos') {
          valStr = s.volume.toLocaleString('pt-BR');
        }
        
        html += `<td class="${cls}">${valStr}</td>`;
      });

      let genCls = '';
      if (r.name === 'Tempo Médio de Espera') genCls = `time-${r.statusFn(kpis.avgWait)}`;
      else if (r.name === 'Conformidade de Espera') genCls = `time-${r.statusFn(kpis.compliance)}`;
      else if (r.name === 'Tempo Médio de Permanência') genCls = `time-${r.statusFn(kpis.avgStay)}`;
      
      html += `<td class="${genCls}"><strong>${r.avgVal}${r.unit}</strong></td>
      </tr>`;
    });

    html += `</tbody></table>`;
    container.innerHTML = html;
  }
};

// ================================================================
// GOAL SIMULATOR
// ================================================================
const Simulator = {
  active: false,
  
  open() {
    document.getElementById('simulatorModal').classList.remove('hidden');
    this.active = true;
    this.update();
  },
  
  close() {
    document.getElementById('simulatorModal').classList.add('hidden');
    this.active = false;
  },
  
  reset() {
    document.getElementById('simSlideWait').value = 0;
    document.getElementById('simSlideStay').value = 0;
    this.update();
  },
  
  update() {
    const currentData = State.filtered || State.data;
    if (!currentData) return;
    const kpis = KPI.calc(currentData);
    
    const waitDeltaPct = +document.getElementById('simSlideWait').value;
    const stayDeltaPct = +document.getElementById('simSlideStay').value;
    
    const formatPct = v => v === 0 ? '0%' : (v > 0 ? `+${v}%` : `${v}%`);
    document.getElementById('simValWait').textContent = formatPct(waitDeltaPct);
    document.getElementById('simValStay').textContent = formatPct(stayDeltaPct);
    
    const simAvgWait = Math.max(5, kpis.avgWait * (1 + waitDeltaPct / 100));
    const simAvgStay = Math.max(30, kpis.avgStay * (1 + stayDeltaPct / 100));
    
    const simCompliance = (() => {
      const ww = currentData.filter(d => d.waitTime !== null && d.waitTime >= 0);
      if (!ww.length) return 0;
      const countCompliant = ww.filter(d => {
        const simWait = d.waitTime * (1 + waitDeltaPct / 100);
        return simWait <= CONFIG.ANAHP.waitTarget;
      }).length;
      return +(countCompliant / ww.length * 100).toFixed(1);
    })();
    
    document.getElementById('simResWait').textContent = U.fmtMin(simAvgWait);
    document.getElementById('simResStay').textContent = U.fmtMin(simAvgStay);
    document.getElementById('simResComp').textContent = `${simCompliance.toFixed(1)}%`;
    
    const simKpis = {
      compliance: simCompliance,
      avgWait: simAvgWait,
      avgStay: simAvgStay
    };
    const simOee = KPI.oee(simKpis);
    
    this.drawGauge(simOee.score);
  },
  
  drawGauge(score) {
    const canvas = document.getElementById('simOeeGauge');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const cx = 90, cy = 90, r = 65, start = Math.PI, end = 2 * Math.PI;
    ctx.clearRect(0, 0, 180, 100);
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.strokeStyle = 'rgba(148,163,184,0.15)'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
    const filled = start + (end - start) * (score / 100);
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, '#EF4444'); grad.addColorStop(0.5, '#F59E0B'); grad.addColorStop(1, '#10B981');
    ctx.beginPath(); ctx.arc(cx, cy, r, start, filled); ctx.strokeStyle = grad; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
    
    const el = document.getElementById('simOeeScore');
    if (el) {
      el.textContent = score.toFixed(1);
      const color = score >= 85 ? '#10B981' : score >= 70 ? '#38BDF8' : score >= 55 ? '#F59E0B' : '#EF4444';
      el.style.color = color;
    }
  }
};

// ================================================================
// ================================================================
// PDF PRINT ENGINE (OFFSCREEN LIGHT-THEME RENDERING)
// ================================================================

const printBgPlugin = {
  id: 'printBg',
  beforeDraw: (chart) => {
    const ctx = chart.canvas.getContext('2d');
    ctx.save();
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, chart.width, chart.height);
    ctx.restore();
  }
};

const PrintCharts = {
  oeeGauge(score) {
    const canvas = document.createElement('canvas');
    canvas.width = 360;
    canvas.height = 200;
    const ctx = canvas.getContext('2d');
    const cx = 180, cy = 180, r = 130, start = Math.PI, end = 2 * Math.PI;
    ctx.clearRect(0, 0, 360, 200);
    
    // Draw solid white background
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 360, 200);
    
    // Background arc (solid light slate gray)
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    // Score arc
    const scoreVal = Math.min(100, Math.max(0, score || 0));
    const filled = start + (end - start) * (scoreVal / 100);
    const grad = ctx.createLinearGradient(cx - r, cy, cx + r, cy);
    grad.addColorStop(0, '#EF4444');
    grad.addColorStop(0.5, '#F59E0B');
    grad.addColorStop(1, '#10B981');
    
    ctx.beginPath();
    ctx.arc(cx, cy, r, start, filled);
    ctx.strokeStyle = grad;
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.stroke();
    
    return canvas.toDataURL('image/png');
  },

  monthly(kpis, baseKpis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    const s = kpis.monthStats;
    if (!s.length) return '';
    
    const datasets = [{
      label: 'Tempo Médio (min)',
      data: s.map(x => +x.avg.toFixed(1)),
      borderColor: '#4F46E5', // high contrast Indigo
      backgroundColor: 'rgba(79, 70, 229, 0.08)',
      fill: true,
      tension: 0.4,
      pointBackgroundColor: '#4F46E5',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 6,
      yAxisID: 'y',
    }, {
      label: '% Conform. ≤30min',
      data: s.map(x => +x.compliance.toFixed(1)),
      borderColor: '#10B981', // Emerald
      backgroundColor: 'rgba(16, 185, 129, 0.04)',
      fill: false,
      tension: 0.4,
      borderDash: [6, 3],
      pointBackgroundColor: '#10B981',
      pointBorderColor: '#fff',
      pointBorderWidth: 2,
      pointRadius: 6,
      yAxisID: 'y2',
    }];
    
    if (baseKpis) {
      datasets.push({
        label: 'Tempo Médio Ano Base',
        data: s.map(x => { 
          const bm = baseKpis.monthStats.find(b => b.month === x.month); 
          return bm ? +bm.avg.toFixed(1) : null; 
        }),
        borderColor: '#8B5CF6', // Purple
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.4,
        borderDash: [4, 4],
        pointBackgroundColor: '#8B5CF6',
        pointRadius: 5,
        yAxisID: 'y',
        spanGaps: true,
      });
    }
    
    const chart = new Chart(ctx, {
      type: 'line',
      plugins: [printBgPlugin],
      data: {
        labels: s.map(x => CONFIG.MONTHS_SHORT[x.month - 1]),
        datasets
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#0F172A', font: { family: 'Inter', size: 12, weight: '500' } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 10 } },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#4F46E5', font: { family: 'Inter', size: 10 } },
            grid: { color: '#E2E8F0' },
            title: { display: true, text: 'Tempo (min)', color: '#4F46E5', font: { family: 'Inter', size: 11, weight: 'bold' } }
          },
          y2: {
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#10B981', font: { family: 'Inter', size: 10 }, callback: v => v + '%' },
            grid: { display: false },
            title: { display: true, text: 'Conformidade (%)', color: '#10B981', font: { family: 'Inter', size: 11, weight: 'bold' } }
          }
        }
      }
    });
    
    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  specialty(kpis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    const st = kpis.specialtyStats.slice(0, 10);
    if (!st.length) return '';
    
    const colors = st.map(s => s.avg > CONFIG.ANAHP.waitTarget ? 'rgba(239, 68, 68, 0.85)' : 'rgba(16, 185, 129, 0.85)');
    const borderColors = st.map(s => s.avg > CONFIG.ANAHP.waitTarget ? '#EF4444' : '#10B981');
    
    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels: st.map(s => s.name),
        datasets: [{
          label: 'Tempo Médio (min)',
          data: st.map(s => +s.avg.toFixed(1)),
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1.5,
          borderRadius: 6,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 10 }, callback: v => v + 'min' },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '500' } },
            grid: { display: false }
          }
        }
      }
    });
    
    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  distribution(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    const vals = data.filter(d => d.waitTime !== null).map(d => d.waitTime);
    if (!vals.length) return '';
    
    const BIN = 10, MAX = 130;
    const bins = [];
    for (let i = 0; i < MAX; i += BIN) bins.push({ label: i >= MAX - BIN ? `+${i}m` : `${i}–${i + BIN}m`, min: i, count: 0 });
    vals.forEach(v => { const idx = Math.min(Math.floor(v / BIN), bins.length - 1); if (idx >= 0) bins[idx].count++; });
    const total = vals.length;
    
    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels: bins.map(b => b.label),
        datasets: [{
          label: '% Atendimentos',
          data: bins.map(b => +(b.count / total * 100).toFixed(1)),
          backgroundColor: bins.map(b => b.min < 30 ? 'rgba(16, 185, 129, 0.85)' : b.min < 60 ? 'rgba(245, 158, 11, 0.85)' : 'rgba(239, 68, 68, 0.85)'),
          borderColor: bins.map(b => b.min < 30 ? '#10B981' : b.min < 60 ? '#F59E0B' : '#EF4444'),
          borderWidth: 1,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: { display: false }
        },
        scales: {
          x: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 10 }, maxRotation: 45 },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 10 }, callback: v => v + '%' },
            grid: { color: '#E2E8F0' }
          }
        }
      }
    });
    
    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  daily(daily) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!daily.length) return '';
    
    const labels = daily.map(d => `${String(d.date.getDate()).padStart(2, '0')}/${String(d.date.getMonth() + 1).padStart(2, '0')}`);
    
    // 7-day MA
    const ma = [];
    for (let i = 0; i < daily.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) {
        if (daily[j].avgWait !== null) {
          sum += daily[j].avgWait;
          count++;
        }
      }
      ma.push(count > 0 ? +(sum / count).toFixed(1) : null);
    }
    
    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Volume Diário',
            data: daily.map(d => d.volume),
            backgroundColor: 'rgba(79, 70, 229, 0.40)', // deep Indigo
            borderColor: '#4F46E5',
            borderWidth: 1,
            borderRadius: 2,
            yAxisID: 'y2'
          },
          {
            type: 'line',
            label: 'Espera Média (min)',
            data: daily.map(d => d.avgWait),
            borderColor: '#D97706',  // Amber
            backgroundColor: 'rgba(217, 119, 6, 0.08)',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
            yAxisID: 'y',
            spanGaps: true
          },
          {
            type: 'line',
            label: 'Média Móvel 7 Dias',
            data: ma,
            borderColor: '#8B5CF6',  // Violet
            backgroundColor: 'transparent',
            fill: false,
            tension: 0.3,
            pointRadius: 0,
            borderWidth: 2.5,
            borderDash: [5, 4],
            yAxisID: 'y',
            spanGaps: true
          }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#0F172A', font: { family: 'Inter', size: 10, weight: '500' } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 9 }, maxTicksLimit: 20, maxRotation: 45 },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#D97706', font: { family: 'Inter', size: 10 } },
            grid: { color: '#E2E8F0' },
            title: { display: true, text: 'Tempo (min)', color: '#D97706', font: { family: 'Inter', size: 10, weight: 'bold' } }
          },
          y2: {
            position: 'right',
            ticks: { color: '#4F46E5', font: { family: 'Inter', size: 10 } },
            grid: { display: false },
            title: { display: true, text: 'Volume', color: '#4F46E5', font: { family: 'Inter', size: 10, weight: 'bold' } }
          }
        }
      }
    });
    
    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  weekday(data) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    const M = {};
    data.forEach(d => { 
      if (!d.dow) return; 
      if (!M[d.dow]) M[d.dow] = { ws: 0, wc: 0, vol: 0 }; 
      M[d.dow].vol++; 
      if (d.waitTime !== null) { M[d.dow].ws += d.waitTime; M[d.dow].wc++; } 
    });
    const labels = CONFIG.WEEKDAYS.filter(d => M[d]);
    const avgs = labels.map(d => M[d].wc ? +U.avg([M[d].ws / M[d].wc]).toFixed(1) : 0);
    
    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels,
        datasets: [
          {
            type: 'bar',
            label: 'Tempo Médio (min)',
            data: avgs,
            backgroundColor: avgs.map(v => v > CONFIG.ANAHP.waitTarget ? 'rgba(239, 68, 68, 0.80)' : 'rgba(79, 70, 229, 0.80)'),
            borderColor: avgs.map(v => v > CONFIG.ANAHP.waitTarget ? '#EF4444' : '#4F46E5'),
            borderWidth: 1,
            borderRadius: 7,
            yAxisID: 'y'
          },
          {
            type: 'line',
            label: 'Volume Total',
            data: labels.map(d => M[d].vol),
            borderColor: '#D97706',
            backgroundColor: 'transparent',
            pointBackgroundColor: '#D97706',
            pointBorderColor: '#fff',
            pointBorderWidth: 2,
            pointRadius: 6,
            tension: 0.4,
            yAxisID: 'y2'
          }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#0F172A', font: { family: 'Inter', size: 10, weight: '500' } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 10, weight: 'bold' } },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 10 }, callback: v => v + 'min' },
            grid: { color: '#E2E8F0' },
            title: { display: true, text: 'Tempo (min)', color: '#4F46E5', font: { family: 'Inter', size: 10, weight: 'bold' } }
          },
          y2: {
            position: 'right',
            ticks: { color: '#D97706', font: { family: 'Inter', size: 10 } },
            grid: { display: false },
            title: { display: true, text: 'Volume', color: '#D97706', font: { family: 'Inter', size: 10, weight: 'bold' } }
          }
        }
      }
    });
    
    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  pareto(kpis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 600;
    const ctx = canvas.getContext('2d');
    if (!kpis.specialtyStats.length) return '';
    
    const specs = kpis.specialtyStats.map(s => ({
      name: s.name,
      totalWait: s.avg * s.count
    })).sort((a, b) => b.totalWait - a.totalWait).slice(0, 7);
    
    const sumTotal = specs.reduce((sum, s) => sum + s.totalWait, 0);
    let cumulative = 0;
    const cumPercentages = specs.map(s => {
      cumulative += s.totalWait;
      return sumTotal > 0 ? +(cumulative / sumTotal * 100).toFixed(1) : 0;
    });
    
    const chart = new Chart(ctx, {
      plugins: [printBgPlugin],
      data: {
        labels: specs.map(s => s.name),
        datasets: [
          {
            type: 'bar',
            label: 'Espera Total (h)',
            data: specs.map(s => +(s.totalWait / 60).toFixed(1)),
            backgroundColor: 'rgba(79, 70, 229, 0.75)', // Indigo
            borderColor: '#4F46E5',
            borderWidth: 1,
            borderRadius: 5,
            yAxisID: 'y',
            order: 2
          },
          {
            type: 'line',
            label: '% Acumulado',
            data: cumPercentages,
            borderColor: '#EF4444',
            backgroundColor: 'transparent',
            pointBackgroundColor: '#EF4444',
            pointRadius: 6,
            tension: 0.2,
            yAxisID: 'y2',
            order: 1
          }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { color: '#0F172A', font: { family: 'Inter', size: 10, weight: '500' } }
          }
        },
        scales: {
          x: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 9 } },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#4F46E5', font: { family: 'Inter', size: 10 }, callback: v => v + 'h' },
            grid: { color: '#E2E8F0' },
            title: { display: true, text: 'Horas de Espera Total', color: '#4F46E5', font: { family: 'Inter', size: 10, weight: 'bold' } }
          },
          y2: {
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#EF4444', font: { family: 'Inter', size: 10 }, callback: v => v + '%' },
            grid: { display: false },
            title: { display: true, text: '% Acumulado', color: '#EF4444', font: { family: 'Inter', size: 10, weight: 'bold' } }
          }
        }
      }
    });
    
    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  }
};

const PrintEngine = {
  buildDistributionTable(data) {
    const vals = data.filter(d => d.waitTime !== null).map(d => d.waitTime);
    if (!vals.length) return '<p style="padding:10px;text-align:center">Sem dados</p>';
    const BIN = 10, MAX = 130;
    const bins = [];
    for (let i = 0; i < MAX; i += BIN) bins.push({ label: i >= MAX - BIN ? `Mais de ${i}min` : `${i} a ${i + BIN}min`, min: i, count: 0 });
    vals.forEach(v => { const idx = Math.min(Math.floor(v / BIN), bins.length - 1); if (idx >= 0) bins[idx].count++; });
    const total = vals.length;
    
    let html = '<table class="data-table"><thead><tr><th>Faixa de Espera</th><th>Pacientes</th><th>% Represent.</th></tr></thead><tbody>';
    bins.forEach(b => {
      const pct = +(b.count / total * 100).toFixed(1);
      const cls = b.min < 30 ? 'time-good' : b.min < 60 ? 'time-warn' : 'time-bad';
      html += `<tr><td><strong>${b.label}</strong></td><td>${b.count.toLocaleString('pt-BR')}</td><td class="${cls}">${pct}%</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
  },

  buildSpecialtyTable(kpis) {
    const stats = kpis.specialtyStats;
    if (!stats.length) return '<p style="padding:10px;text-align:center">Sem dados</p>';
    
    let html = '<table class="data-table"><thead><tr><th>Especialidade</th><th>Volume</th><th>Tempo Médio</th><th>Conform.</th></tr></thead><tbody>';
    stats.forEach(s => {
      const cls = s.avg <= 30 ? 'time-good' : s.avg <= 40 ? 'time-warn' : 'time-bad';
      html += `<tr><td><strong>${s.name}</strong></td><td>${s.count.toLocaleString('pt-BR')}</td><td class="${cls}">${Math.round(s.avg)} min</td><td class="${s.compliance >= 80 ? 'time-good' : s.compliance >= 60 ? 'time-warn' : 'time-bad'}">${s.compliance.toFixed(1)}%</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
  },

  export() {
    const currentData = State.filtered || State.data;
    if (!currentData || !currentData.length) {
      UI.toast('Nenhum dado carregado para exportar.', 'error');
      return;
    }

    UI.loading(true, 'Gerando relatório PDF executivo com alta nitidez...');
    
    setTimeout(() => {
      try {
        const kpis = KPI.calc(currentData);
        const baseKpis = State.baseData ? KPI.calc(State.baseData) : null;
        const daily = KPI.dailyEvolution(currentData);
        
        // Generate high-resolution, light-themed images in memory
        const oeeGaugeImg = PrintCharts.oeeGauge(kpis.oeeScore || 0);
        const monthlyImg = PrintCharts.monthly(kpis, baseKpis);
        const specialtyImg = PrintCharts.specialty(kpis);
        const dailyImg = PrintCharts.daily(daily);
        const weekdayImg = PrintCharts.weekday(currentData);
        const distributionImg = PrintCharts.distribution(currentData);
        const paretoImg = PrintCharts.pareto(kpis);
        
        // Dynamic HTML elements from dashboard
        const scorecardTableHTML = document.getElementById('scorecardTable')?.innerHTML || '';
        const capacityGridHTML = document.getElementById('capacityGrid')?.innerHTML || '';
        const anomalyTableHTML = document.getElementById('anomalyTable')?.innerHTML || '';
        const worstDaysTableHTML = document.getElementById('worstDaysTable')?.innerHTML || '';
        const reportBodyHTML = document.getElementById('reportBody')?.innerHTML || '';
        
        // Print-specific dynamic tables
        const distributionTableHTML = this.buildDistributionTable(currentData);
        const specialtyTableHTML = this.buildSpecialtyTable(kpis);
        
        // Open print window
        const win = window.open('', '_blank');
        if (!win) {
          UI.toast('Bloqueador de popups detectado! Ative popups para este site.', 'error');
          UI.loading(false);
          return;
        }
        
        const periodText = document.getElementById('dataInfo')?.textContent || '';
        
        win.document.write(`
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Relatório Executivo VitalFlow PS - ${new Date().toLocaleDateString('pt-BR')}</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap" rel="stylesheet">
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800;900&display=swap');
    
    @page {
      size: A4 landscape;
      margin: 10mm;
    }
    
    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }
    
    body {
      font-family: 'Inter', sans-serif;
      color: #1E293B;
      background: #FFFFFF;
      line-height: 1.4;
      font-size: 11px;
    }
    
    .page {
      width: 277mm;
      height: 190mm;
      position: relative;
      page-break-after: always;
      display: flex;
      flex-direction: column;
      justify-content: space-between;
      overflow: hidden;
      padding-bottom: 3mm;
      border-bottom: 1px dashed #CBD5E1;
    }
    
    /* Cover Page */
    .cover-page {
      justify-content: center;
      align-items: center;
      text-align: center;
      padding: 30mm 20mm;
    }
    .cover-logo {
      width: 65px;
      height: 65px;
      background: linear-gradient(135deg, #4F46E5, #10B981);
      border-radius: 16px;
      margin: 0 auto 20px;
      display: flex;
      align-items: center;
      justify-content: center;
      box-shadow: 0 4px 20px rgba(79, 70, 229, 0.15);
    }
    .cover-logo svg {
      width: 36px;
      height: 36px;
      color: white;
    }
    .cover-title {
      font-size: 34px;
      font-weight: 900;
      letter-spacing: -1px;
      color: #0F172A;
      margin-bottom: 6px;
    }
    .cover-subtitle {
      font-size: 16px;
      font-weight: 600;
      color: #4F46E5;
      margin-bottom: 24px;
    }
    .cover-divider {
      width: 100px;
      height: 4px;
      background: linear-gradient(90deg, #4F46E5, #10B981);
      margin: 0 auto 30px;
      border-radius: 2px;
    }
    .cover-meta {
      font-size: 12px;
      color: #475569;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 10px;
      padding: 16px 28px;
      display: inline-block;
      max-width: 550px;
      text-align: left;
      line-height: 1.7;
    }
    .cover-meta strong {
      color: #0F172A;
    }
    
    /* Header & Footer styling */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1.5px solid #E2E8F0;
      padding-bottom: 6px;
      margin-bottom: 10px;
    }
    .header-left h2 {
      font-size: 14px;
      font-weight: 800;
      color: #0F172A;
      letter-spacing: -0.3px;
    }
    .header-left p {
      font-size: 9.5px;
      color: #475569;
    }
    .header-right {
      text-align: right;
    }
    .header-right .badge {
      background: #EEF2FF;
      color: #4F46E5;
      border: 1px solid #C7D2FE;
      font-size: 9px;
      font-weight: 700;
      padding: 3px 10px;
      border-radius: 20px;
    }
    
    .content {
      flex: 1;
      display: flex;
      flex-direction: column;
      justify-content: flex-start;
      gap: 10px;
      min-height: 0;
    }
    
    .footer {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-top: 1px solid #E2E8F0;
      padding-top: 5px;
      font-size: 8.5px;
      color: #64748B;
    }
    
    /* Grid system */
    .grid-print-2 {
      display: grid;
      grid-template-columns: 58% 39%;
      gap: 3%;
      align-items: start;
      height: 100%;
      min-height: 0;
    }
    
    /* Cards and styling */
    .card {
      background: #FFFFFF;
      border: 1.5px solid #E2E8F0;
      border-radius: 8px;
      padding: 10px 14px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.01);
      display: flex;
      flex-direction: column;
      gap: 6px;
      height: 100%;
    }
    .card h3 {
      font-size: 11px;
      font-weight: 800;
      color: #1E293B;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      border-bottom: 1.5px solid #F1F5F9;
      padding-bottom: 5px;
      margin-bottom: 4px;
    }
    .card-body {
      flex: 1;
      min-height: 0;
      position: relative;
    }
    
    /* Charts as images */
    .chart-img-wrap {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
      background: #FFFFFF;
      border: 1px solid #F1F5F9;
      border-radius: 6px;
      padding: 5px;
    }
    .chart-img {
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
    
    /* KPI Cards specifically */
    .kpi-row {
      display: grid;
      grid-template-columns: repeat(6, 1fr);
      gap: 8px;
      margin-bottom: 4px;
    }
    .kpi-pdf-card {
      background: #F8FAFC;
      border: 1.5px solid #E2E8F0;
      border-radius: 6px;
      padding: 10px 8px;
      text-align: center;
      position: relative;
    }
    .kpi-pdf-card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 3.5px;
      border-radius: 6px 6px 0 0;
    }
    .kpi-pdf-card.status-good::before { background: #10B981; }
    .kpi-pdf-card.status-warn::before { background: #F59E0B; }
    .kpi-pdf-card.status-bad::before { background: #EF4444; }
    .kpi-pdf-card.status-neutral::before { background: #4F46E5; }
    
    .kpi-pdf-label {
      font-size: 8px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.3px;
      margin-bottom: 4px;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .kpi-pdf-value {
      font-size: 16px;
      font-weight: 900;
      color: #0F172A;
      margin-bottom: 2px;
    }
    .kpi-pdf-target {
      font-size: 8px;
      color: #64748B;
    }
    
    /* Tables design overrides for print */
    table, .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.5px;
      color: #1E293B;
    }
    th {
      background: #F8FAFC;
      color: #475569;
      font-weight: 800;
      border-bottom: 1.5px solid #E2E8F0;
      padding: 5px 6px;
      text-align: left;
      text-transform: uppercase;
      font-size: 7.5px;
      letter-spacing: 0.3px;
    }
    td {
      padding: 5px 6px;
      border-bottom: 1px solid #F1F5F9;
      text-align: left;
    }
    td strong {
      color: #0F172A;
    }
    tr.row-critical { background: #FEF2F2; }
    tr.row-warning { background: #FFFBEB; }
    .time-good { color: #047857 !important; font-weight: 700; }
    .time-warn { color: #B45309 !important; font-weight: 700; }
    .time-bad { color: #B91C1C !important; font-weight: 700; }
    .rank-cell { font-weight: 700; color: #4F46E5; }
    
    /* Scorecard special styling */
    .scorecard-table {
      border: 1.5px solid #E2E8F0;
      border-radius: 8px;
      overflow: hidden;
    }
    .scorecard-table th, .scorecard-table td {
      padding: 4.5px 6px;
    }
    
    /* Intelligence Insights */
    .insight-pdf-grid {
      display: flex;
      flex-direction: column;
      gap: 6.5px;
      overflow: hidden;
    }
    .report-insight {
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-left: 3.5px solid #4F46E5;
      border-radius: 6px;
      padding: 6.5px 10px;
    }
    .report-insight.insight-good { border-left-color: #10B981; }
    .report-insight.insight-warn { border-left-color: #F59E0B; }
    .report-insight.insight-bad { border-left-color: #EF4444; }
    .report-insight.insight-info { border-left-color: #0EA5E9; }
    
    .ri-header {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 2px;
      font-weight: 700;
      font-size: 9px;
      color: #0F172A;
    }
    .ri-body {
      font-size: 8.5px;
      color: #475569;
      line-height: 1.35;
    }
    .ri-body strong {
      color: #0F172A;
    }
    
    /* Capacity Cell */
    .cap-grid-table {
      width: 100%;
      border: 1.5px solid #E2E8F0;
      border-radius: 6px;
      overflow: hidden;
    }
    .cap-grid-table th, .cap-grid-table td {
      padding: 4px 5px;
      font-size: 8px;
    }
    .cap-cell {
      border-radius: 4px;
      padding: 2.5px 5px;
      font-weight: 700;
      font-size: 8.5px;
      display: inline-block;
      text-align: center;
    }
    .cap-low { background: #D1FAE5; color: #065F46; }
    .cap-med { background: #FEF3C7; color: #92400E; }
    .cap-high { background: #FEE2E2; color: #991B1B; }
    
    /* Cover Page OEE */
    .cover-oee {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 40px;
      margin-top: 30px;
      background: #F8FAFC;
      border: 1px solid #E2E8F0;
      border-radius: 12px;
      padding: 16px 40px;
    }
    .cover-oee-gauge {
      width: 180px;
      height: 100px;
      position: relative;
    }
    .cover-oee-gauge img {
      width: 180px;
      height: auto;
    }
    .cover-oee-score-wrap {
      text-align: left;
    }
    .cover-oee-label {
      font-size: 10.5px;
      font-weight: 700;
      text-transform: uppercase;
      color: #475569;
      letter-spacing: 0.3px;
    }
    .cover-oee-score-row {
      display: flex;
      align-items: baseline;
      gap: 4px;
      margin-top: 4px;
    }
    .cover-oee-score {
      font-size: 34px;
      font-weight: 900;
      color: #0F172A;
      letter-spacing: -1px;
    }
    .cover-oee-badge {
      font-size: 13.5px;
      font-weight: 800;
      background: #D1FAE5;
      color: #065F46;
      border: 1.5px solid #A7F3D0;
      padding: 3.5px 12px;
      border-radius: 6px;
      margin-left: 10px;
    }
    
    .executive-summary {
      background: #F8FAFC;
      border-radius: 6px;
      border: 1px solid #E2E8F0;
      padding: 10px;
    }
    
    @media print {
      body {
        background: #FFFFFF !important;
      }
      .page {
        border-bottom: none !important;
        height: 190mm !important;
        page-break-after: always !important;
      }
    }
  </style>
</head>
<body>

  <!-- ==================== PAGE 1: CAPA ==================== -->
  <div class="page cover-page">
    <div class="cover-logo">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6"/>
      </svg>
    </div>
    <h1 class="cover-title">VitalFlow PS</h1>
    <div class="cover-subtitle">Relatório Executivo de Performance Hospitalar</div>
    <div class="cover-divider"></div>
    
    <div class="cover-meta">
      <strong>Instituição:</strong> Hospital Pronto Socorro Central<br>
      <strong>Parceiro Tecnológico:</strong> Vitalliz - Engenharia de Dados Hospitalares<br>
      <strong>Período de Análise:</strong> ${periodText.replace('atendimentos ·', '')}<br>
      <strong>Data de Emissão:</strong> ${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', {hour: '2-digit', minute:'2-digit'})}
    </div>
    
    <div class="cover-oee">
      <div class="cover-oee-gauge">
        <img src="${oeeGaugeImg}">
      </div>
      <div class="cover-oee-score-wrap">
        <div class="cover-oee-label">Eficiência Operacional Geral (OEE)</div>
        <div class="cover-oee-score-row">
          <span class="cover-oee-score">${kpis.oeeScore ? kpis.oeeScore.toFixed(1) : document.getElementById('oeeScore')?.textContent || '—'}</span>
          <span class="cover-oee-label">/100</span>
          <span class="cover-oee-badge">${document.getElementById('oeeClassBadge')?.textContent || '—'}</span>
        </div>
      </div>
    </div>
    
    <div class="footer" style="margin-top: auto; width: 100%;">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 1</span>
    </div>
  </div>

  <!-- ==================== PAGE 2: SCORECARD & KPIS ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>1. Indicadores Chave de Desempenho (KPIs)</h2>
        <p>Monitoramento detalhado vs Metas oficiais da ANAHP</p>
      </div>
      <div class="header-right">
        <span class="badge">VitalFlow PS v3.0</span>
      </div>
    </div>
    
    <div class="content">
      <div class="kpi-row">
        <div class="kpi-pdf-card status-${kpis.avgWait <= 30 ? 'good' : kpis.avgWait <= 40 ? 'warn' : 'bad'}">
          <div class="kpi-pdf-label">Tempo Médio de Espera</div>
          <div class="kpi-pdf-value">${U.fmtMin(kpis.avgWait)}</div>
          <div class="kpi-pdf-target">Meta ANAHP: ≤30min</div>
        </div>
        <div class="kpi-pdf-card status-${kpis.compliance >= 80 ? 'good' : kpis.compliance >= 70 ? 'warn' : 'bad'}">
          <div class="kpi-pdf-label">Conformidade de Espera</div>
          <div class="kpi-pdf-value">${kpis.compliance.toFixed(1)}%</div>
          <div class="kpi-pdf-target">Meta ANAHP: ≥80%</div>
        </div>
        <div class="kpi-pdf-card status-${kpis.avgStay <= 240 ? 'good' : kpis.avgStay <= 300 ? 'warn' : 'bad'}">
          <div class="kpi-pdf-label">Tempo Médio Permanência</div>
          <div class="kpi-pdf-value">${U.fmtMin(kpis.avgStay)}</div>
          <div class="kpi-pdf-target">Meta: ≤240min</div>
        </div>
        <div class="kpi-pdf-card status-neutral">
          <div class="kpi-pdf-label">Volume Total</div>
          <div class="kpi-pdf-value">${kpis.total.toLocaleString('pt-BR')}</div>
          <div class="kpi-pdf-target">Média: ${kpis.avgDaily}/dia</div>
        </div>
        <div class="kpi-pdf-card status-neutral">
          <div class="kpi-pdf-label">Horário de Pico</div>
          <div class="kpi-pdf-value">${kpis.peakHour !== null ? String(kpis.peakHour).padStart(2,'0') + ':00' : '—'}</div>
          <div class="kpi-pdf-target">${kpis.peakVol} atendimentos</div>
        </div>
        <div class="kpi-pdf-card status-good">
          <div class="kpi-pdf-label">Melhor Mês</div>
          <div class="kpi-pdf-value">${kpis.bestMonth ? CONFIG.MONTHS_SHORT[kpis.bestMonth.month - 1] : '—'}</div>
          <div class="kpi-pdf-target">Média: ${U.fmtMin(kpis.bestMonth ? kpis.bestMonth.avg : 0)}</div>
        </div>
      </div>
      
      <div class="card" style="margin-top: 6px;">
        <h3>Scorecard Mensal Evolutivo (M-o-M)</h3>
        <div class="card-body">
          ${scorecardTableHTML}
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 2</span>
    </div>
  </div>

  <!-- ==================== PAGE 3: TENDÊNCIA E EVOLUÇÃO MENSAL ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>2. Tendência Mensal Evolutiva (YoY)</h2>
        <p>Histórico mensal comparativo de tempos médios de espera e conformidade com metas</p>
      </div>
      <div class="header-right">
        <span class="badge">Evolução Mensal</span>
      </div>
    </div>
    
    <div class="content grid-print-2">
      <div class="card">
        <h3>Evolução Mensal do Tempo de Espera e Conformidade</h3>
        <div class="chart-img-wrap">
          <img src="${monthlyImg}" class="chart-img">
        </div>
      </div>
      <div class="card">
        <h3>Nota de Tendência e Metas Executivas</h3>
        <div class="card-body" style="display: flex; flex-direction: column; gap: 12px;">
          <div class="executive-summary" style="font-size: 9px; line-height: 1.5;">
            <strong>Análise Corporativa M-o-M:</strong><br>
            Os dados indicam que o tempo médio de atendimento e a conformidade estão fortemente interligados. Nos meses de maior volume (Inverno), observa-se um aumento acentuado do tempo de espera, com consequente redução na conformidade de atendimento ≤ 30 minutos (Meta ANAHP).
          </div>
          <div class="executive-summary" style="font-size: 9px; line-height: 1.5;">
            <strong>Diretriz Operacional:</strong><br>
            A manutenção de conformidade de atendimento acima de <strong>80%</strong> requer que o tempo médio de espera de acolhimento até a consulta permaneça rigorosamente abaixo dos <strong>30 minutos</strong> em todas as especialidades operacionais.
          </div>
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 3</span>
    </div>
  </div>

  <!-- ==================== PAGE 4: EVOLUÇÃO DIÁRIA & TOP DIAS ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>3. Monitoramento de Demanda e Espera Diária</h2>
        <p>Evolução diária com linha suavizada de Média Móvel de 7 dias e identificação de piores picos</p>
      </div>
      <div class="header-right">
        <span class="badge">Espera Diária</span>
      </div>
    </div>
    
    <div class="content grid-print-2">
      <div class="card">
        <h3>Espera Média Diária & Volume (Média Móvel 7 Dias)</h3>
        <div class="chart-img-wrap">
          <img src="${dailyImg}" class="chart-img">
        </div>
      </div>
      <div class="card">
        <h3>Top 10 Dias Mais Críticos (Maior Tempo de Espera)</h3>
        <div class="card-body" style="overflow: hidden; max-height: 100%;">
          ${worstDaysTableHTML}
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 4</span>
    </div>
  </div>

  <!-- ==================== PAGE 5: HISTOGRAMA DE DISTRIBUIÇÃO E CONFORMIDADE ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>4. Perfil de Triagem e Distribuição de Pacientes</h2>
        <p>Histograma estatístico detalhado de representação percentual por faixa de tempo de espera</p>
      </div>
      <div class="header-right">
        <span class="badge">Faixas de Espera</span>
      </div>
    </div>
    
    <div class="content grid-print-2">
      <div class="card">
        <h3>Histograma de Distribuição de Pacientes por Faixa</h3>
        <div class="chart-img-wrap">
          <img src="${distributionImg}" class="chart-img">
        </div>
      </div>
      <div class="card">
        <h3>Distribuição Estatística dos Tempos de Espera</h3>
        <div class="card-body" style="overflow: hidden; max-height: 100%;">
          ${distributionTableHTML}
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 5</span>
    </div>
  </div>

  <!-- ==================== PAGE 6: PRODUTIVIDADE & PARETO POR ESPECIALIDADE ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>5. Produtividade por Especialidade e Pareto (80/20)</h2>
        <p>Distribuição do tempo médio de espera por especialidade e Pareto de concentração de gargalos</p>
      </div>
      <div class="header-right">
        <span class="badge">Análise de Gargalos</span>
      </div>
    </div>
    
    <div class="content grid-print-2">
      <div class="card">
        <h3>Análise de Concentração de Pareto (Horas Totais Acumuladas)</h3>
        <div class="chart-img-wrap">
          <img src="${paretoImg}" class="chart-img">
        </div>
      </div>
      <div class="card">
        <h3>Performance e Métricas por Especialidade</h3>
        <div class="card-body" style="overflow: hidden; max-height: 100%;">
          ${specialtyTableHTML}
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 6</span>
    </div>
  </div>

  <!-- ==================== PAGE 7: DIMENSIONAMENTO DE CAPACIDADE & TURNOS ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>6. Dimensionamento de Capacidade & Turnos</h2>
        <p>Evolução de fluxos operacionais por dia da semana e dimensionamento de turnos ativo</p>
      </div>
      <div class="header-right">
        <span class="badge">Planejamento & Escalas</span>
      </div>
    </div>
    
    <div class="content grid-print-2">
      <div class="card">
        <h3>Evolução de Fluxo Operacional por Dia da Semana</h3>
        <div class="chart-img-wrap">
          <img src="${weekdayImg}" class="chart-img">
        </div>
      </div>
      <div class="card">
        <h3>Grade de Dimensionamento de Turnos Operacionais</h3>
        <div class="card-body" style="overflow: hidden; max-height: 100%;">
          ${capacityGridHTML}
        </div>
        <p style="font-size: 8px; color: #64748B; margin-top: 4px; font-style: italic; font-weight: 500;">
          * Calculado com base no multiplicador sazonal ativo no painel: <strong>${document.getElementById('capacitySeasonFactor')?.options[document.getElementById('capacitySeasonFactor')?.selectedIndex]?.text || 'Normal 1.0x'}</strong>.
        </p>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 7</span>
    </div>
  </div>

  <!-- ==================== PAGE 8: DIAGNOSTICO NEXUS & ANOMALIAS ==================== -->
  <div class="page">
    <div class="header">
      <div class="header-left">
        <h2>7. Inteligência de Diagnóstico NEXUS & Anomalias</h2>
        <p>Relatório automatizado de desvios operacionais com Z-Score (Z > 2.0σ) e insights contextuais</p>
      </div>
      <div class="header-right">
        <span class="badge">NEXUS Inteligência</span>
      </div>
    </div>
    
    <div class="content grid-print-2">
      <div class="card" style="max-height: 100%;">
        <h3>Insights de Performance Automatizados</h3>
        <div class="insight-pdf-grid" style="overflow-y: hidden;">
          ${reportBodyHTML}
        </div>
      </div>
      <div class="card" style="max-height: 100%;">
        <h3>Anomalias Estatísticas Relevantes (Z-Score > 2.0σ)</h3>
        <div class="card-body" style="overflow: hidden;">
          ${anomalyTableHTML}
        </div>
      </div>
    </div>
    
    <div class="footer">
      <span>Vitalliz - Engenharia de Dados Hospitalares</span>
      <span>Página 8</span>
    </div>
  </div>

</body>
</html>
        `);
        
        win.document.close();
        
        setTimeout(() => {
          win.print();
          UI.loading(false);
        }, 1500);
        
      } catch (err) {
        console.error('PDF Generation Error:', err);
        UI.toast('Erro ao gerar relatório em PDF.', 'error');
        UI.loading(false);
      }
    }, 300);
  }
};

// ================================================================
// UI CONTROLLER
// ================================================================
const UI = {
  showLogin() { document.getElementById('loginPage').classList.remove('hidden'); document.getElementById('appPage').classList.add('hidden'); },
  showApp() {
    document.getElementById('loginPage').classList.add('hidden');
    document.getElementById('appPage').classList.remove('hidden');
    if(State.user){
      document.getElementById('userName').textContent=State.user.name;
      document.getElementById('userRole').textContent=State.user.role;
      document.getElementById('userAvatar').textContent=State.user.name.charAt(0).toUpperCase();
      
      // Toggle upload controls and clear DB buttons based on roles
      const isWriter = State.user.role === 'Gestor Geral' || State.user.role === 'Gestor de Unidade';
      
      const uploadHeader = document.querySelector('.upload-group');
      if (uploadHeader) uploadHeader.style.display = isWriter ? 'flex' : 'none';
      
      const uploadPromptBtns = document.querySelector('.upload-btns-row');
      if (uploadPromptBtns) uploadPromptBtns.style.display = isWriter ? 'flex' : 'none';
      
      const uploadDragText = document.getElementById('uploadDropZone')?.querySelector('p');
      if (uploadDragText) {
        uploadDragText.innerHTML = isWriter 
          ? 'Arraste e solte o arquivo <strong>tempos_atendimento_sus.csv</strong> aqui' 
          : 'Nenhum dado carregado no momento. Solicite a um administrador para subir a base de dados.';
      }
      
      const btnClear = document.getElementById('btnClearDB');
      if (btnClear) btnClear.style.display = isWriter ? 'flex' : 'none';
    }
  },
  showUpload() { document.getElementById('uploadState').classList.remove('hidden'); document.getElementById('dashboardContent').classList.add('hidden'); },
  showDash() {
    document.getElementById('uploadState').classList.add('hidden');
    document.getElementById('dashboardContent').classList.remove('hidden');
    const btnSim = document.getElementById('btnSimulator');
    const btnPdf = document.getElementById('btnExportPDF');
    if (btnSim) btnSim.disabled = false;
    if (btnPdf) btnPdf.disabled = false;
  },
  loading(show, msg='Processando dados...') {
    const el=document.getElementById('loadingOverlay');
    el?.classList[show?'remove':'add']('hidden');
    const t=document.getElementById('loadingText');
    if(t) t.textContent=msg;
  },
  toast(msg, type='success') {
    const t=document.createElement('div');
    t.className=`toast toast-${type}`;
    t.textContent=msg;
    document.body.appendChild(t);
    requestAnimationFrame(()=>t.classList.add('toast-visible'));
    setTimeout(()=>{ t.classList.remove('toast-visible'); setTimeout(()=>t.remove(),350); },3500);
  },
  populateFilters(data) {
    const months=[...new Set(data.map(d=>d.month))].sort((a,b)=>a-b);
    const specs=[...new Set(data.map(d=>d.specialty))].sort();
    const mSel=document.getElementById('filterMonth');
    const sSel=document.getElementById('filterSpecialty');
    mSel.innerHTML='<option value="all">Todos os Meses</option>';
    months.forEach(m=>{ const o=document.createElement('option'); o.value=m; o.textContent=CONFIG.MONTHS[m-1]; mSel.appendChild(o); });
    sSel.innerHTML='<option value="all">Todas as Especialidades</option>';
    specs.forEach(s=>{ const o=document.createElement('option'); o.value=s; o.textContent=s; sSel.appendChild(o); });
  },
  updatePeriod(data, label) {
    const months=[...new Set(data.map(d=>d.month))].sort((a,b)=>a-b);
    const first=CONFIG.MONTHS_SHORT[(months[0]||1)-1];
    const last=CONFIG.MONTHS_SHORT[(months.at(-1)||5)-1];
    const pb=document.getElementById('periodBadge');
    if(pb) pb.innerHTML=`<svg width="12" height="12" viewBox="0 0 24 24" fill="none"><rect x="3" y="4" width="18" height="18" rx="2" stroke="currentColor" stroke-width="2"/><path d="M16 2v4M8 2v4M3 10h18" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg> ${first}–${last} ${data[0].year}`;
    const di=document.getElementById('dataInfo');
    if(di) di.innerHTML=`<strong>${data.length.toLocaleString('pt-BR')}</strong> atendimentos · <strong>${first}–${last} ${data[0].year}</strong> · ${label||''}`;
    const badge=document.getElementById('trendBadge');
    if(badge) badge.textContent=`${first}–${last} ${data[0].year}`;
    const daily=document.getElementById('dailyBadge');
    if(daily) daily.textContent=`${first}–${last} ${data[0].year}`;
  },
  setCompareMode(on) {
    document.getElementById('compareModeBadge')?.classList[on?'remove':'add']('hidden');
    document.getElementById('yoySection')?.classList[on?'remove':'add']('hidden');
  },
  updateKPIs(kpis, baseKpis) {
    this._kpi('kpiWait', U.fmtMin(kpis.avgWait), `Meta ANAHP: ≤ ${CONFIG.ANAHP.waitTarget}min`,
      kpis.avgWait<=CONFIG.ANAHP.waitTarget?'good':kpis.avgWait<=40?'warn':'bad',
      baseKpis ? kpis.avgWait - baseKpis.avgWait : null, 'min', true);
    this._kpi('kpiCompliance', `${kpis.compliance.toFixed(1)}%`, `Meta ANAHP: ≥ ${CONFIG.ANAHP.complianceTarget}%`,
      kpis.compliance>=CONFIG.ANAHP.complianceTarget?'good':kpis.compliance>=70?'warn':'bad',
      baseKpis ? kpis.compliance - baseKpis.compliance : null, '%', false);
    this._kpi('kpiStay', U.fmtMin(kpis.avgStay), `Meta: ≤ ${U.fmtMin(CONFIG.ANAHP.stayTarget)}`,
      kpis.avgStay<=CONFIG.ANAHP.stayTarget?'good':kpis.avgStay<=300?'warn':'bad',
      baseKpis ? kpis.avgStay - baseKpis.avgStay : null, 'min', true);
    this._kpi('kpiVolume', kpis.total.toLocaleString('pt-BR'), `Média: ${kpis.avgDaily} at/dia · ${kpis.totalDays} dias`, 'neutral',
      baseKpis ? kpis.total - baseKpis.total : null, '', false);
    this._kpi('kpiPeak', kpis.peakHour!==null?`${String(kpis.peakHour).padStart(2,'0')}:00h`:'—', kpis.peakHour!==null?`${kpis.peakVol} atend. no pico`:'Sem dados', 'neutral', null);
    this._kpi('kpiBestMonth', kpis.bestMonth?CONFIG.MONTHS_SHORT[kpis.bestMonth.month-1]:'—', kpis.bestMonth?`Média: ${U.fmtMin(kpis.bestMonth.avg)}`:'—', 'good', null);
  },
  _kpi(id, val, target, status, delta, unit, lowerIsBetter) {
    const card=document.getElementById(id);
    if(!card) return;
    card.className=`kpi-card status-${status}`;
    const vEl=document.getElementById(`${id}Value`);
    const tEl=document.getElementById(`${id}Target`);
    const dEl=document.getElementById(`${id}Delta`);
    if(vEl) vEl.textContent=val;
    if(tEl) tEl.textContent=target;
    if(dEl&&delta!==null&&delta!==undefined){
      const isGood=(lowerIsBetter&&delta<0)||(!lowerIsBetter&&delta>0);
      const sign=delta>0?'+':'';
      dEl.className=`kpi-delta ${isGood?'pos':'neg'}`;
      dEl.textContent=`${sign}${typeof delta==='number'?delta.toFixed(1):''}${unit} vs ano base`;
      dEl.classList.remove('hidden');
    } else if(dEl) dEl.classList.add('hidden');
  },
};

// ================================================================
// AUDIT PANEL & DRILLDOWN
// ================================================================
const AuditPanel = {
  page: 1,
  pageSize: 15,
  searchQuery: '',
  severityFilter: 'all', // 'all', 'warn' (>30m), 'critical' (>60m)

  init() {
    // Search input event
    const searchInput = document.getElementById('auditSearchInput');
    if (searchInput) {
      searchInput.addEventListener('input', (e) => {
        this.searchQuery = e.target.value.toLowerCase().trim();
        this.page = 1;
        this.render();
      });
    }

    // Severity buttons
    const btnAll = document.getElementById('btnAuditAll');
    const btnWarn = document.getElementById('btnAuditWarn');
    const btnCritical = document.getElementById('btnAuditCritical');

    const updateBtns = (activeBtn) => {
      [btnAll, btnWarn, btnCritical].forEach(btn => btn?.classList.remove('active'));
      activeBtn?.classList.add('active');
    };

    btnAll?.addEventListener('click', () => {
      updateBtns(btnAll);
      this.severityFilter = 'all';
      this.page = 1;
      this.render();
    });

    btnWarn?.addEventListener('click', () => {
      updateBtns(btnWarn);
      this.severityFilter = 'warn';
      this.page = 1;
      this.render();
    });

    btnCritical?.addEventListener('click', () => {
      updateBtns(btnCritical);
      this.severityFilter = 'critical';
      this.page = 1;
      this.render();
    });

    // Pagination events
    document.getElementById('btnAuditPrev')?.addEventListener('click', () => {
      if (this.page > 1) {
        this.page--;
        this.render();
      }
    });

    document.getElementById('btnAuditNext')?.addEventListener('click', () => {
      const filtered = this.getFilteredData();
      const maxPages = Math.ceil(filtered.length / this.pageSize);
      if (this.page < maxPages) {
        this.page++;
        this.render();
      }
    });

    // Backdrop click modal close
    const modal = document.getElementById('auditDetailModal');
    modal?.addEventListener('click', (e) => {
      if (e.target === modal) {
        this.closeModal();
      }
    });
  },

  getFilteredData() {
    const data = State.filtered || State.data || [];
    
    // Sort descending by date and hour to show recent first
    const sorted = [...data].sort((a, b) => {
      const valA = a.date.getTime() + (a.entryHour || 0) * 3600000;
      const valB = b.date.getTime() + (b.entryHour || 0) * 3600000;
      return valB - valA;
    });

    return sorted.filter(d => {
      // 1. Text filter
      let matchText = true;
      if (this.searchQuery) {
        const name = d.name ? d.name.toLowerCase() : '';
        const id = d.id ? d.id.toLowerCase() : '';
        matchText = name.includes(this.searchQuery) || id.includes(this.searchQuery);
      }

      // 2. Severity filter
      let matchSeverity = true;
      if (this.severityFilter === 'warn') {
        matchSeverity = d.waitTime !== null && d.waitTime > 30;
      } else if (this.severityFilter === 'critical') {
        matchSeverity = d.waitTime !== null && d.waitTime > 60;
      }

      return matchText && matchSeverity;
    });
  },

  render() {
    const tbody = document.getElementById('auditTableBody');
    const badgeCount = document.getElementById('auditCount');
    const pagInfo = document.getElementById('auditPaginationInfo');
    const btnPrev = document.getElementById('btnAuditPrev');
    const btnNext = document.getElementById('btnAuditNext');

    if (!tbody) return;

    const filtered = this.getFilteredData();
    const total = filtered.length;

    // Update count badge
    if (badgeCount) {
      badgeCount.textContent = `${total.toLocaleString('pt-BR')} registros`;
    }

    if (total === 0) {
      tbody.innerHTML = `<tr><td colspan="6" style="padding: 24px; text-align: center; color: #64748B; font-size: 13px;">
        Nenhum registro encontrado para os filtros selecionados.
      </td></tr>`;
      if (pagInfo) pagInfo.textContent = 'Exibindo 0-0 de 0 registros';
      if (btnPrev) btnPrev.disabled = true;
      if (btnNext) btnNext.disabled = true;
      return;
    }

    // Paginate
    const maxPages = Math.ceil(total / this.pageSize);
    if (this.page > maxPages) this.page = maxPages || 1;

    const startIdx = (this.page - 1) * this.pageSize;
    const endIdx = Math.min(startIdx + this.pageSize, total);
    const slice = filtered.slice(startIdx, endIdx);

    // Update pagination info & buttons
    if (pagInfo) {
      pagInfo.innerHTML = `Exibindo <strong style="color: #E2E8F0;">${startIdx + 1}-${endIdx}</strong> de <strong style="color: #E2E8F0;">${total.toLocaleString('pt-BR')}</strong> registros | Página <strong style="color: #E2E8F0;">${this.page}</strong> de <strong style="color: #E2E8F0;">${maxPages}</strong>`;
    }

    if (btnPrev) btnPrev.disabled = this.page === 1;
    if (btnNext) btnNext.disabled = this.page === maxPages;

    // Render rows
    let html = '';
    slice.forEach((d, i) => {
      // Determine severity badge
      let badgeClass = 'good';
      let badgeLabel = 'Conforme';
      if (d.waitTime > 60) {
        badgeClass = 'bad';
        badgeLabel = 'Crítico (>60m)';
      } else if (d.waitTime > 30) {
        badgeClass = 'warn';
        badgeLabel = 'Alerta (>30m)';
      }

      // Format Date/Time
      const formattedDate = U.fmtDate(d.date) + ' ' + (d.entryHour !== null ? `${String(d.entryHour).padStart(2, '0')}:00` : '--:--');

      html += `<tr data-index="${startIdx + i}">
        <td style="font-weight: 700; color: #F8FAFC;">${d.name || 'PACIENTE ANÔNIMO'}</td>
        <td style="font-family: monospace; font-size: 11px;">${formattedDate}</td>
        <td>${d.specialty}</td>
        <td>
          <span class="audit-badge ${badgeClass}">${U.fmtMin(d.waitTime)} (${badgeLabel})</span>
        </td>
        <td>${U.fmtMin(d.stayTime)}</td>
        <td style="text-align: right;">
          <button class="audit-btn-view">Ver Ficha</button>
        </td>
      </tr>`;
    });

    tbody.innerHTML = html;

    // Bind click events to rows
    const rows = tbody.querySelectorAll('tr');
    rows.forEach(row => {
      row.addEventListener('click', () => {
        const idx = parseInt(row.getAttribute('data-index'), 10);
        if (!isNaN(idx) && filtered[idx]) {
          AuditPanel.openModal(filtered[idx]);
        }
      });
    });
  },

  openModal(d) {
    const modal = document.getElementById('auditDetailModal');
    if (!modal) return;

    // Set simple fields
    document.getElementById('auditPatientName').textContent = d.name || 'PACIENTE ANÔNIMO';
    document.getElementById('auditPatientId').textContent = d.id || 'NÃO INFORMADO';
    document.getElementById('auditPatientSpecialty').textContent = d.specialty;
    document.getElementById('auditPatientDow').textContent = d.dow;
    document.getElementById('auditPatientWait').textContent = U.fmtMin(d.waitTime);

    // Compute meta compliance label
    const complianceSpan = document.getElementById('auditPatientCompliance');
    if (complianceSpan) {
      if (d.waitTime <= CONFIG.ANAHP.waitTarget) {
        complianceSpan.textContent = 'CONFORME (Meta ANAHP)';
        complianceSpan.style.color = '#10B981';
      } else {
        complianceSpan.textContent = 'NÃO CONFORME (Meta ANAHP)';
        complianceSpan.style.color = '#EF4444';
      }
    }

    // 1. TIMELINE CALCULATIONS
    const t1 = d.entryHour !== null ? `${String(d.entryHour).padStart(2, '0')}:00` : '--:--';
    document.getElementById('timeStep1').textContent = t1;

    let t2 = '--:--';
    if (d.entryHour !== null && d.waitTime !== null) {
      const totalMin = d.entryHour * 60 + d.waitTime;
      const cHour = Math.floor(totalMin / 60) % 24;
      const cMin = Math.round(totalMin % 60);
      t2 = `${String(cHour).padStart(2, '0')}:${String(cMin).padStart(2, '0')}`;
    }
    document.getElementById('timeStep2').textContent = t2;

    let t3 = '--:--';
    if (d.entryHour !== null && d.stayTime !== null) {
      const totalMin = d.entryHour * 60 + d.stayTime;
      const aHour = Math.floor(totalMin / 60) % 24;
      const aMin = Math.round(totalMin % 60);
      t3 = `${String(aHour).padStart(2, '0')}:${String(aMin).padStart(2, '0')}`;
    }
    document.getElementById('timeStep3').textContent = t3;

    // Timeline dots progress state
    const dot2 = document.getElementById('dotStep2');
    const label2 = document.getElementById('labelStep2');
    const dot3 = document.getElementById('dotStep3');
    const label3 = document.getElementById('labelStep3');

    // Reset progress styles
    dot2.classList.remove('active');
    dot3.classList.remove('active');
    label2.style.color = '#94A3B8';
    label3.style.color = '#94A3B8';
    document.getElementById('timelineProgressLine').style.width = '0%';

    // Animate progress line and dots after modal open transition
    setTimeout(() => {
      if (d.waitTime !== null) {
        dot2.classList.add('active');
        label2.style.color = '#10B981';
        document.getElementById('timelineProgressLine').style.width = '50%';
      }
      if (d.stayTime !== null) {
        setTimeout(() => {
          dot3.classList.add('active');
          label3.style.color = '#10B981';
          document.getElementById('timelineProgressLine').style.width = '80%';
        }, 400);
      }
    }, 150);

    // 2. STATISTICAL COMPUTATIONS (Z-Score & Carga no Turno)
    const baseData = State.filtered || State.data || [];

    // A. Z-Score waitTime standard deviation inside the same Specialty
    const specData = baseData.filter(x => x.specialty === d.specialty && x.waitTime !== null);
    let zScore = 0;
    if (specData.length > 1) {
      const avgSpecWait = U.avg(specData.map(x => x.waitTime));
      const stdDev = U.std(specData.map(x => x.waitTime));
      if (stdDev > 0) {
        zScore = (d.waitTime - avgSpecWait) / stdDev;
      }
    }

    const zBadge = document.getElementById('auditZscoreBadge');
    const zTitle = document.getElementById('auditZscoreTitle');
    const zDesc = document.getElementById('auditZscoreDesc');

    if (zBadge && zTitle && zDesc) {
      const zVal = zScore.toFixed(2);
      zBadge.textContent = `${zScore >= 0 ? '+' : ''}${zVal}σ`;

      if (zScore > 2) {
        zBadge.style.background = 'rgba(239, 68, 68, 0.12)';
        zBadge.style.color = '#EF4444';
        zBadge.style.borderColor = 'rgba(239, 68, 68, 0.25)';
        zTitle.textContent = 'Espera Anômala (Crítica)';
        zTitle.style.color = '#EF4444';
        zDesc.textContent = `Atraso extremamente incomum (${zVal} desvios padrão acima da média da clínica).`;
      } else if (zScore > 1) {
        zBadge.style.background = 'rgba(245, 158, 11, 0.12)';
        zBadge.style.color = '#F59E0B';
        zBadge.style.borderColor = 'rgba(245, 158, 11, 0.25)';
        zTitle.textContent = 'Desvio Moderado';
        zTitle.style.color = '#F59E0B';
        zDesc.textContent = `Tempo de espera acima do normal para a especialidade (${zVal} desvios padrão).`;
      } else {
        zBadge.style.background = 'rgba(16, 185, 129, 0.12)';
        zBadge.style.color = '#10B981';
        zBadge.style.borderColor = 'rgba(16, 185, 129, 0.25)';
        zTitle.textContent = 'Tempo Conforme';
        zTitle.style.color = '#10B981';
        zDesc.textContent = `Tempo de espera ideal e dentro do padrão esperado para o setor (${zVal}σ).`;
      }
    }

    // B. Carga no Turno (Active volume of patients inside the same Specialty during the same shift & day)
    let patientShift = null;
    if (d.entryHour !== null) {
      patientShift = CONFIG.SHIFTS.find(s => s.hours.includes(d.entryHour));
    }

    let activeVolume = 0;
    if (patientShift) {
      const sameDayStr = U.dateKey(d);
      const activeInShift = baseData.filter(x => {
        if (x.specialty !== d.specialty || x.entryHour === null) return false;
        const xDayStr = U.dateKey(x);
        return xDayStr === sameDayStr && patientShift.hours.includes(x.entryHour);
      });
      activeVolume = activeInShift.length;
    }

    const cBadge = document.getElementById('auditCargaBadge');
    const cDesc = document.getElementById('auditCargaDesc');

    if (cBadge && cDesc) {
      cBadge.textContent = activeVolume.toString();

      let loadText = 'Baixo fluxo';
      if (activeVolume > 25) {
        loadText = 'Superlotação Extrema';
        cBadge.style.background = 'rgba(239, 68, 68, 0.12)';
        cBadge.style.color = '#EF4444';
        cBadge.style.borderColor = 'rgba(239, 68, 68, 0.25)';
      } else if (activeVolume > 12) {
        loadText = 'Alto Fluxo no Setor';
        cBadge.style.background = 'rgba(245, 158, 11, 0.12)';
        cBadge.style.color = '#F59E0B';
        cBadge.style.borderColor = 'rgba(245, 158, 11, 0.25)';
      } else {
        loadText = 'Fluxo Tranquilo';
        cBadge.style.background = 'rgba(99, 102, 241, 0.12)';
        cBadge.style.color = '#6366F1';
        cBadge.style.borderColor = 'rgba(99, 102, 241, 0.25)';
      }
      cDesc.innerHTML = `<strong style="color:#FFF;">${loadText}</strong> (${activeVolume} pacientes ativos na clínica no mesmo turno e dia).`;
    }

    modal.classList.remove('hidden');
  },

  closeModal() {
    const modal = document.getElementById('auditDetailModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  }
};

// ================================================================
// RENDER DASHBOARD
// ================================================================
function render(data, baseData) {
  const kpis     = KPI.calc(data);
  const baseKpis = baseData ? KPI.calc(baseData) : null;
  const daily    = KPI.dailyEvolution(data);

  UI.updateKPIs(kpis, baseKpis);
  OEE.update(kpis);
  Report.generate(kpis, data);

  Charts.monthly(kpis, baseKpis);
  if(baseData){ Charts.yoy([...data,...baseData], baseData); UI.setCompareMode(true); }
  else { UI.setCompareMode(false); }
  Charts.specialty(kpis);
  Charts.distribution(data);
  Charts.daily(daily);
  Charts.weekday(data);
  Charts.forecast(daily);
  Charts.pareto(kpis);

  Scorecard.render(kpis, baseKpis);
  if (Simulator.active) { Simulator.update(); }

  Heatmap.render(data);
  AnnualCalendar.render(data);
  AnomalyTable.render(data);
  CapacityGrid.render(data);
  WorstTable.render(data);
  AuditPanel.render();
}

// ================================================================
// FILTERS
// ================================================================
function applyFilters() {
  const { month, specialty } = State.filters;
  State.filtered = State.data.filter(d=>{
    return (month==='all'||d.month===+month) && (specialty==='all'||d.specialty===specialty);
  });
  render(State.filtered, State.baseData);
}

// ================================================================
// FILE HANDLER
// ================================================================
async function handleFile(file, isBase) {
  if(!file?.name.toLowerCase().endsWith('.csv')){ UI.toast('Selecione um arquivo .csv válido.','error'); return; }
  UI.loading(true, isBase?'Carregando ano base...':'Processando dados do período atual...');
  try {
    const text=await file.text();
    const data=await Parser.parse(text);
    if(!data.length){ UI.toast('Nenhum dado encontrado no arquivo.','error'); return; }
    if(isBase){
      State.baseData=data;
      State.baseFilename=file.name;
      document.getElementById('baseLoadedLabel').textContent='✓';
      await DB.upload(data, true);
      localStorage.setItem('baseFilename', file.name);
      UI.toast(`✓ Ano base: ${data.length.toLocaleString('pt-BR')} atendimentos`,'info');
    } else {
      State.data=data;
      State.filtered=data;
      State.currentFilename=file.name;
      State.filters={month:'all',specialty:'all'};
      document.getElementById('filterMonth').value='all';
      document.getElementById('filterSpecialty').value='all';
      document.getElementById('currentLoadedLabel').textContent='✓';
      await DB.upload(data, false);
      localStorage.setItem('currentFilename', file.name);
      UI.populateFilters(data);
      UI.updatePeriod(data, '');
      UI.showDash();
      UI.toast(`✓ ${data.length.toLocaleString('pt-BR')} atendimentos carregados!`);
    }
    if(State.filtered||State.data){
      render(State.filtered||State.data, State.baseData);
    }
  } catch(err){ console.error(err); UI.toast('Erro ao processar o arquivo.','error'); }
  finally{ UI.loading(false); }
}

// ================================================================
// EVENTS
// ================================================================
function setup() {
  // Login
  document.getElementById('loginForm')?.addEventListener('submit', e=>{
    e.preventDefault();
    const u=document.getElementById('loginUsername').value;
    const p=document.getElementById('loginPassword').value;
    const btn=document.getElementById('loginBtn');
    const err=document.getElementById('loginError');
    btn.classList.add('loading');
    btn.querySelector('.btn-login-text').classList.add('hidden');
    btn.querySelector('.btn-login-spinner').classList.remove('hidden');
    err.classList.add('hidden');
    setTimeout(async ()=>{
      if(Auth.login(u,p)){ UI.showApp(); await loadSavedData(); }
      else{ err.classList.remove('hidden'); document.getElementById('loginPassword').value=''; }
      btn.classList.remove('loading');
      btn.querySelector('.btn-login-text').classList.remove('hidden');
      btn.querySelector('.btn-login-spinner').classList.add('hidden');
    },650);
  });

  document.getElementById('btnLogout')?.addEventListener('click',()=>{
    if(confirm('Deseja sair do VitalFlow PS?')){ Auth.logout(); UI.showLogin(); }
  });

  // Upload buttons
  document.getElementById('btnUploadCurrent')?.addEventListener('click',()=>document.getElementById('fileInputCurrent').click());
  document.getElementById('btnUploadBase')?.addEventListener('click',()=>document.getElementById('fileInputBase').click());
  document.getElementById('btnUploadPromptCurrent')?.addEventListener('click',()=>document.getElementById('fileInputCurrent').click());
  document.getElementById('btnUploadPromptBase')?.addEventListener('click',()=>document.getElementById('fileInputBase').click());

  document.getElementById('fileInputCurrent')?.addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f)handleFile(f,false); e.target.value=''; });
  document.getElementById('fileInputBase')?.addEventListener('change',e=>{ const f=e.target.files?.[0]; if(f)handleFile(f,true); e.target.value=''; });

  // Drag & drop
  const zone=document.getElementById('uploadDropZone');
  if(zone){
    zone.addEventListener('dragover',e=>{ e.preventDefault(); zone.closest('.upload-state')?.classList.add('drag-over'); });
    zone.addEventListener('dragleave',()=>zone.closest('.upload-state')?.classList.remove('drag-over'));
    zone.addEventListener('drop',e=>{ e.preventDefault(); zone.closest('.upload-state')?.classList.remove('drag-over'); const f=e.dataTransfer.files?.[0]; if(f)handleFile(f,false); });
  }

  // Filters
  document.getElementById('filterMonth')?.addEventListener('change',e=>{ State.filters.month=e.target.value; applyFilters(); });
  document.getElementById('filterSpecialty')?.addEventListener('change',e=>{ State.filters.specialty=e.target.value; applyFilters(); });

  // Goal Simulator events
  document.getElementById('btnSimulator')?.addEventListener('click', () => Simulator.open());
  document.getElementById('btnCloseSimulator')?.addEventListener('click', () => Simulator.close());
  document.getElementById('btnResetSimulator')?.addEventListener('click', () => Simulator.reset());
  document.getElementById('simSlideWait')?.addEventListener('input', () => Simulator.update());
  document.getElementById('simSlideStay')?.addEventListener('input', () => Simulator.update());

  // Capacity factor event
  document.getElementById('capacitySeasonFactor')?.addEventListener('change', () => {
    const currentData = State.filtered || State.data;
    if (currentData) {
      CapacityGrid.render(currentData);
    }
  });

  // PDF Export print trigger
  document.getElementById('btnExportPDF')?.addEventListener('click', () => PrintEngine.export());
  document.getElementById('btnPrintReport')?.addEventListener('click', () => PrintEngine.export());

  // Clear Database event
  document.getElementById('btnClearDB')?.addEventListener('click', async () => {
    if (confirm('Tem certeza que deseja apagar todos os dados salvos no sistema? Isso recomeçará a tela de upload.')) {
      UI.loading(true, 'Limpando banco de dados...');
      try {
        await DB.clear();
        State.data = null;
        State.filtered = null;
        State.baseData = null;
        State.currentFilename = null;
        State.baseFilename = null;
        
        // Reset labels
        document.getElementById('currentLoadedLabel').textContent = '';
        document.getElementById('baseLoadedLabel').textContent = '';
        
        UI.showUpload();
        UI.toast('Banco de dados limpo com sucesso!', 'info');
      } catch (err) {
        console.error(err);
        UI.toast('Erro ao limpar banco de dados.', 'error');
      } finally {
        UI.loading(false);
      }
    }
  });
  AuditPanel.init();
}

// ================================================================
// DATA LIFECYCLE MANAGEMENT
// ================================================================
async function loadSavedData() {
  UI.loading(true, 'Buscando dados salvos...');
  try {
    const res = await DB.get();
    if (res && res.current && res.current.length > 0) {
      // Reconstruct Date objects from serialized string
      const data = res.current.map(d => ({ ...d, date: new Date(d.date) }));
      State.data = data;
      State.filtered = data;
      State.currentFilename = localStorage.getItem('currentFilename') || 'dados_salvos.csv';
      document.getElementById('currentLoadedLabel').textContent = '✓';
      UI.populateFilters(data);
      UI.updatePeriod(data, '');
      
      // Check for base data
      if (res.base && res.base.length > 0) {
        const baseData = res.base.map(d => ({ ...d, date: new Date(d.date) }));
        State.baseData = baseData;
        State.baseFilename = localStorage.getItem('baseFilename') || 'ano_base.csv';
        document.getElementById('baseLoadedLabel').textContent = '✓';
      }
      
      UI.showDash();
      render(State.filtered, State.baseData);
      return true;
    } else {
      UI.showUpload();
      return false;
    }
  } catch (err) {
    console.error(err);
    UI.showUpload();
    return false;
  } finally {
    UI.loading(false);
  }
}

// ================================================================
// INIT
// ================================================================
document.addEventListener('DOMContentLoaded', async () => {
  setup();
  if (Auth.check()) {
    UI.showApp();
    await loadSavedData();
  } else {
    UI.showLogin();
  }
});
