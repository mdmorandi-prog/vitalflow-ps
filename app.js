/* =================================================================
   VitalFlow PS — app.js
   Vitalliz Engenharia de Dados
================================================================= */
'use strict';

// ================================================================
// CONFIGURATION
// ================================================================
const CONFIG = {
  ANAHP: { waitTarget: 30, complianceTarget: 80, stayTarget: 240, salaVermelhaTarget: 60, suturaTarget: 30, soroterapiaTarget: 180 },
  DESTINATIONS: { 'Casa':'Alta Domiciliar', 'Internado':'Internação', 'Retorno Ambulatorial':'Retorno Amb.', 'Evasão':'Evasão', 'Transferência':'Transferência', 'Óbito':'Óbito', 'Outro':'Outro', 'Ignorado':'Ignorado' },
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
  filters: { month: 'all', specialty: 'all', convenio: 'TODOS' },
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
    const chunkSize = 5000;
    const totalRecords = data.length;
    let uploadedCount = 0;

    if (totalRecords === 0) return { success: true, count: 0 };

    for (let i = 0; i < totalRecords; i += chunkSize) {
      const chunk = data.slice(i, i + chunkSize);
      const isFirst = i === 0;
      
      try {
        const res = await fetch(`/api/upload?type=${isBase ? 'base' : 'current'}&clear=${isFirst ? 'true' : 'false'}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(chunk)
        });
        if (!res.ok) {
          const err = await res.json();
          throw new Error(err.error || 'Upload failed');
        }
        await res.json();
        uploadedCount += chunk.length;
      } catch (e) {
        console.error(`API Upload Error at chunk starting at index ${i}:`, e);
        throw e;
      }
    }

    return { success: true, count: uploadedCount };
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
  parseTime(str) {
    if (!str) return null;
    const m = str.toString().trim().match(/^(\d{1,2}):(\d{2})/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
  },
  timeToMin(timeStr, fallbackHour = null) {
    if (timeStr) {
      const m = timeStr.toString().trim().match(/^(\d{1,2}):(\d{2})/);
      if (m) return (+m[1]) * 60 + (+m[2]);
    }
    return fallbackHour !== null && fallbackHour !== undefined ? fallbackHour * 60 : null;
  },
  normDOW(raw) {
    if (!raw) return '';
    const s = raw.trim();
    if (/^S.{0,2}b$/.test(s)) return 'Sáb';
    return s;
  },
  fmtMin(min) {
    if (min === null || min === undefined || isNaN(min)) return '—';
    const sign = min < 0 ? '-' : '';
    const total = Math.round(Math.abs(min));
    if (total <= 60) return `${sign}${total}min`;
    const h = Math.floor(total / 60), m = total % 60;
    return `${sign}${h}h ${String(m).padStart(2, '0')}min`;
  },
  fmtMinShort(min) {
    if (min === null || min === undefined || isNaN(min)) return '—';
    const sign = min < 0 ? '-' : '';
    const total = Math.round(Math.abs(min));
    if (total <= 60) return `${sign}${total}m`;
    const h = Math.floor(total / 60), m = total % 60;
    return m === 0 ? `${sign}${h}h` : `${sign}${h}h${String(m).padStart(2, '0')}m`;
  },
  fmtDate(d) { return d ? d.toLocaleDateString('pt-BR',{day:'2-digit',month:'2-digit',year:'numeric'}) : '—'; },
  avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; },
  std(arr) {
    const a = U.avg(arr);
    return Math.sqrt(arr.reduce((s,v)=>s+(v-a)**2,0)/arr.length);
  },
  heatColor(r) {
    r = Math.min(Math.max(r, 0), 1);
    const stops = [
      [241, 245, 249], // #F1F5F9
      [219, 234, 254], // #DBEAFE
      [147, 197, 253], // #93C5FD
      [37,  99,  235], // #2563EB
      [15,  41,  66],  // #0F2942
    ];
    const scaled = r * (stops.length - 1);
    const idx = Math.min(Math.floor(scaled), stops.length - 2);
    const t = scaled - idx;
    const a = stops[idx], b = stops[idx + 1];
    return `rgb(${Math.round(a[0] + (b[0] - a[0]) * t)},${Math.round(a[1] + (b[1] - a[1]) * t)},${Math.round(a[2] + (b[2] - a[2]) * t)})`;
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
    if (!all || all.length < 2) return [];
    const headers = (all[0] || []).map(h => (h || '').replace(/^\uFEFF/, '').trim().toUpperCase());
    const hasConvenioCols = headers.includes('CONVENIO') || headers.includes('COD_CONVENIO');
    const off = hasConvenioCols ? 2 : 0;
    const idx = (names, fallback) => {
      for (const n of names) {
        const i = headers.indexOf(n);
        if (i !== -1) return i;
      }
      return fallback;
    };

    const iWeek  = idx(['SEMANA_MES'], 0);
    const iDow   = idx(['DIA_SEMANA'], 1);
    const iDate  = idx(['DATA'], 2);
    const iId    = idx(['ATENDIMENTO'], 3);
    const iTipo  = idx(['TIPO_CONVENIO'], 4);
    const iConv  = hasConvenioCols ? idx(['CONVENIO'], 6) : -1;
    const iName  = idx(['PACIENTE'], 5 + off);
    const iSpec  = idx(['ESPECIALIDADE'], 6 + off);
    const iDest  = idx(['DESTINO'], 7 + off);
    const iEnt   = idx(['HORA_ENTRADA'], 8 + off);
    const iExit  = idx(['HORA_SAIDA'], 9 + off);
    const iTriW  = idx(['TEMPO_ESPERA_TRIAGEM'], 10 + off);
    const iTriD  = idx(['TEMPO_TRIAGEM_ATE_MEDICO'], 11 + off);
    const iWait  = idx(['TEMPO_TOTAL_FICHA_ATE_MEDICO', 'PACIENTE_TEMPO_FICHA_ATE_MEDICO'], 12 + off);
    const iSV    = idx(['TEMPO_SALA_VERMELHA'], 13 + off);
    const iSor   = idx(['TEMPO_SOROTERAPIA'], 14 + off);
    const iSut   = idx(['TEMPO_SUTURA'], 15 + off);
    const iStay  = idx(['TEMPO_PERMANENCIA_TOTAL', 'PACIENTE_TEMPO_PERMANENCIA_TOTAL'], 16 + off);
    const iDayT  = idx(['TOTAL_ATEND_CONVENIO_DIA', 'TOTAL_ATEND_DIA', 'TOTAL_ATENDIMENTOS_DO_DIA'], 17 + off);
    const iDMTW  = idx(['DIA_MED_ESPERA_TRIAGEM'], 18 + off);
    const iDMTD  = idx(['DIA_MED_TRIAGEM_ATE_MEDICO'], 19 + off);
    const iDMW   = idx(['DIA_MED_TOTAL_ATE_MEDICO', 'DIA_TEMPO_MED_FICHA_ATE_MEDICO'], 20 + off);
    const iDMS   = idx(['DIA_MED_PERMANENCIA_TOTAL'], 21 + off);

    return all.slice(1).map(r => {
      if (!r || r.length < 8 || !r[iDate]?.trim()) return null;
      const date = U.parseDate(r[iDate]);
      if (!date || isNaN(date)) return null;
      const rawTipo = r[iTipo]?.trim() || 'NÃO INFORMADO';
      const tipoConvenio = /conv.nio/i.test(rawTipo) ? 'CONVÊNIOS' : rawTipo;
      const rawConv = iConv !== -1 ? r[iConv]?.trim() : '';
      const convenio = rawConv || tipoConvenio;
      // Normalise destination: strip BOM / encoding artifacts
      const rawDest = r[iDest]?.trim() || null;
      const destination = rawDest && rawDest !== '-' ? rawDest
        .replace(/.*bito.*/i, 'Óbito')
        .replace(/.*vas.o.*/i, 'Evasão')
        .replace(/.*ransfer.ncia.*/i, 'Transferência')
        .replace(/.*nterna..o.*/i, 'Internado') : null;
      return {
        id:                r[iId]?.trim()   || 'NÃO INFORMADO',
        tipoConvenio,
        convenio,
        name:              r[iName]?.trim() || 'PACIENTE ANÔNIMO',
        dow: U.normDOW(r[iDow]), date, month: date.getMonth() + 1, day: date.getDate(), year: date.getFullYear(),
        weekOfMonth:       +r[iWeek] || null,
        specialty:         r[iSpec]?.trim() || 'NÃO INFORMADO',
        destination,
        entryHour:         U.parseHour(r[iEnt]),
        entryTime:         U.parseTime(r[iEnt]),
        exitHour:          U.parseHour(r[iExit]),
        exitTime:          U.parseTime(r[iExit]),
        triageWait:        U.parseMin(r[iTriW]),
        triageToDocWait:   U.parseMin(r[iTriD]),
        waitTime:          U.parseMin(r[iWait]),
        salaVermelhaTime:  U.parseMin(r[iSV]),
        soroterapiaTime:   U.parseMin(r[iSor]),
        suturaTime:        U.parseMin(r[iSut]),
        stayTime:          U.parseMin(r[iStay]),
        dayTotalAtt:       r[iDayT] ? +r[iDayT] : null,
        dayMedTriageWait:  U.parseMin(r[iDMTW]),
        dayMedTriageToDoc: U.parseMin(r[iDMTD]),
        dayMedWait:        U.parseMin(r[iDMW]),
        dayMedStayTime:    U.parseMin(r[iDMS]),
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
    const tw = data.filter(d=>d.triageWait!==null&&d.triageWait>=0);
    const ttdw = data.filter(d=>d.triageToDocWait!==null&&d.triageToDocWait>=0);
    const ws = data.filter(d=>d.stayTime!==null&&d.stayTime>=0);
    const sv = data.filter(d=>d.salaVermelhaTime!==null&&d.salaVermelhaTime>=0);
    const so = data.filter(d=>d.soroterapiaTime!==null&&d.soroterapiaTime>=0);
    const su = data.filter(d=>d.suturaTime!==null&&d.suturaTime>=0);
    const avgWait = U.avg(ww.map(d=>d.waitTime));
    const avgTriageWait = U.avg(tw.map(d=>d.triageWait));
    const avgTriageToDocWait = U.avg(ttdw.map(d=>d.triageToDocWait));
    const avgStay = U.avg(ws.map(d=>d.stayTime));
    const avgSalaV = sv.length ? +U.avg(sv.map(d=>d.salaVermelhaTime)).toFixed(1) : null;
    const avgSorot = so.length ? +U.avg(so.map(d=>d.soroterapiaTime)).toFixed(1) : null;
    const avgSutura = su.length ? +U.avg(su.map(d=>d.suturaTime)).toFixed(1) : null;
    const compliance = ww.length ? ww.filter(d=>d.waitTime<=CONFIG.ANAHP.waitTarget).length/ww.length*100 : 0;
    const salaVCompliance = sv.length ? sv.filter(d=>d.salaVermelhaTime<=CONFIG.ANAHP.salaVermelhaTarget).length/sv.length*100 : null;
    const suturaCompliance = su.length ? su.filter(d=>d.suturaTime<=CONFIG.ANAHP.suturaTarget).length/su.length*100 : null;
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
    // Destination stats
    const destMap = {};
    data.forEach(d=>{ 
      const k=d.destination||'Não Informado'; 
      if(!destMap[k]) destMap[k] = { count: 0, waitTimes: [] };
      destMap[k].count++;
      if (d.waitTime !== null && d.waitTime >= 0) destMap[k].waitTimes.push(d.waitTime);
    });
    const destinationStats = Object.entries(destMap).map(([name,val])=>({
      name,
      count: val.count,
      pct: +(val.count/data.length*100).toFixed(1),
      avgWait: val.waitTimes.length ? U.avg(val.waitTimes) : null
    })).sort((a,b)=>b.count-a.count);
    const getRate = (precision, ...keys) => {
      if (!data.length) return null;
      let sum = 0;
      const upperKeys = keys.map(k => k.toUpperCase());
      Object.entries(destMap).forEach(([k, v]) => {
        if (upperKeys.includes(k.toUpperCase())) sum += v.count;
      });
      return +(sum / data.length * 100).toFixed(precision);
    };

    const internRate = getRate(1, 'Internado', 'Internação', 'Internacao');
    const evasionRate = getRate(1, 'Evasão', 'Evasao');
    const homeRate = getRate(1, 'Casa', 'Alta', 'Alta Domiciliar', 'Retorno Ambulatorial');
    const deathRate = getRate(2, 'Óbito', 'Obito');

    // Convenio / Operadora stats
    const convMap = {};
    data.forEach(d => {
      const k = d.convenio || d.tipoConvenio || 'NÃO INFORMADO';
      if (!convMap[k]) convMap[k] = { count: 0, waits: [], stays: [], triages: [], waitGt60: 0, intern: 0 };
      const st = convMap[k];
      st.count++;
      if (d.waitTime !== null && d.waitTime >= 0) {
        st.waits.push(d.waitTime);
        if (d.waitTime > 60) st.waitGt60++;
      }
      if (d.stayTime !== null && d.stayTime >= 0) st.stays.push(d.stayTime);
      if (d.triageWait !== null && d.triageWait >= 0) st.triages.push(d.triageWait);
      const uDest = d.destination ? d.destination.toUpperCase() : '';
      if (uDest === 'INTERNADO' || uDest === 'INTERNAÇÃO' || uDest === 'INTERNACAO') st.intern++;
    });
    const convenioStats = Object.entries(convMap).map(([name, st]) => ({
      name,
      count: st.count,
      pct: data.length ? +(st.count / data.length * 100).toFixed(1) : 0,
      avgWait: st.waits.length ? +U.avg(st.waits).toFixed(1) : null,
      avgStay: st.stays.length ? +U.avg(st.stays).toFixed(1) : null,
      avgTriage: st.triages.length ? +U.avg(st.triages).toFixed(1) : null,
      waitGt60Pct: st.waits.length ? +(st.waitGt60 / st.waits.length * 100).toFixed(1) : 0,
      internRate: st.count ? +(st.intern / st.count * 100).toFixed(1) : 0,
    })).sort((a, b) => b.count - a.count);

    return {
      total:data.length, validWait:ww.length,
      avgWait:+avgWait.toFixed(1), avgStay:+avgStay.toFixed(1),
      avgTriageWait: tw.length ? +avgTriageWait.toFixed(1) : null,
      avgTriageToDocWait: ttdw.length ? +avgTriageToDocWait.toFixed(1) : null,
      avgSalaV, avgSorot, avgSutura,
      salaVCount:sv.length, sorotCount:so.length, suturaCount:su.length,
      salaVCompliance: salaVCompliance!==null ? +salaVCompliance.toFixed(1) : null,
      suturaCompliance: suturaCompliance!==null ? +suturaCompliance.toFixed(1) : null,
      compliance:+compliance.toFixed(1),
      avgDaily:Math.round(data.length/(days.length||1)),
      totalDays:days.length,
      peakHour: peakEntry?+peakEntry[0]:null, peakVol: peakEntry?+peakEntry[1]:0,
      monthStats, specialtyStats, convenioStats, bestMonth:best, worstMonth:worst,
      destinationStats, internRate, evasionRate, homeRate, deathRate,
    };
  },

  oee(kpis) {
    const c1 = Math.min(kpis.compliance/CONFIG.ANAHP.complianceTarget, 1)*100;
    const c2 = Math.max(0, Math.min((2*CONFIG.ANAHP.waitTarget - kpis.avgWait)/CONFIG.ANAHP.waitTarget,1))*100;
    const c3 = Math.max(0, Math.min((2*CONFIG.ANAHP.stayTarget - kpis.avgStay)/CONFIG.ANAHP.stayTarget,1))*100;
    // OEE v2 — enriched with new KPIs when available
    let score, labels;
    if (kpis.avgSalaV !== null && kpis.homeRate !== null) {
      const c4 = kpis.avgSalaV !== null ? Math.max(0, Math.min((2*CONFIG.ANAHP.salaVermelhaTarget - kpis.avgSalaV)/CONFIG.ANAHP.salaVermelhaTarget,1))*100 : 50;
      const c5 = kpis.evasionRate !== null ? Math.max(0, Math.min((5 - kpis.evasionRate)/5, 1))*100 : 50;
      score = +(c1*0.30 + c2*0.25 + c3*0.20 + c4*0.15 + c5*0.10).toFixed(1);
      labels = ['OEE v2'];
    } else {
      score = +(c1*0.40 + c2*0.35 + c3*0.25).toFixed(1);
      labels = ['OEE v1'];
    }
    const cls = score>=85?'A':score>=70?'B':score>=55?'C':'D';
    return { score, cls, c1:+c1.toFixed(1), c2:+c2.toFixed(1), c3:+c3.toFixed(1), labels };
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
// CHART HELPERS (Swiss Medical Light Theme + Glass Tooltips)
// ================================================================
function glassTooltipHandler(context) {
  const { chart, tooltip } = context;
  let el = document.getElementById('chartjsGlassTooltip');
  if (!el) {
    el = document.createElement('div');
    el.id = 'chartjsGlassTooltip';
    el.className = 'chartjs-glass-tooltip';
    document.body.appendChild(el);
  }
  if (tooltip.opacity === 0) {
    el.style.opacity = '0';
    return;
  }
  let html = '';
  if (tooltip.title?.length) {
    html += `<div class="cgt-title">${tooltip.title.join(' · ')}</div>`;
  }
  if (tooltip.body?.length) {
    tooltip.body.forEach((b, i) => {
      const col = tooltip.labelColors?.[i];
      const bg = col?.backgroundColor || '#0F2942';
      b.lines.forEach(line => {
        if (!line || !line.trim()) return;
        html += `<div class="cgt-row"><span class="cgt-swatch" style="background:${bg}"></span><span>${line.trim()}</span></div>`;
      });
    });
  }
  el.innerHTML = html;
  const rect = chart.canvas.getBoundingClientRect();
  const scrollX = window.scrollX || 0;
  const scrollY = window.scrollY || 0;
  el.style.opacity = '1';
  const tipW = el.offsetWidth || 180;
  const tipH = el.offsetHeight || 60;
  let left = rect.left + scrollX + tooltip.caretX + 12;
  if (left + tipW > scrollX + window.innerWidth - 12) {
    left = rect.left + scrollX + tooltip.caretX - tipW - 12;
  }
  let top = rect.top + scrollY + tooltip.caretY - tipH / 2;
  top = Math.max(scrollY + 8, top);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

const TT = { enabled: false, external: glassTooltipHandler };
const LEG = { labels:{ color:'#475569',font:{family:'Inter',size:11.5,weight:'500'},boxWidth:10,usePointStyle:true,padding:16 } };
const SX = { ticks:{color:'#475569',font:{family:'Inter',size:11}},grid:{color:'#E2E8F0'} };
const SY = (ex={}) => ({ ticks:{color:'#475569',font:{family:'Inter',size:11},...ex},grid:{color:'#E2E8F0'} });

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
      label:'Tempo Médio',data:s.map(x=>+x.avg.toFixed(1)),
      borderColor:'#0F2942',backgroundColor:'rgba(15,41,66,0.08)',fill:true,tension:0.35,
      pointBackgroundColor:'#0F2942',pointBorderColor:'#FFFFFF',pointBorderWidth:2,pointRadius:5,pointHoverRadius:7,yAxisID:'y',
    },{
      label:'% Conform. ≤30min',data:s.map(x=>+x.compliance.toFixed(1)),
      borderColor:'#2F855A',backgroundColor:'transparent',fill:false,tension:0.35,borderDash:[6,3],
      pointBackgroundColor:'#2F855A',pointBorderColor:'#FFFFFF',pointBorderWidth:2,pointRadius:5,pointHoverRadius:7,yAxisID:'y2',
    }];
    if (baseKpis) {
      datasets.push({
        label:'Tempo Médio Ano Base',data:s.map(x=>{ const bm=baseKpis.monthStats.find(b=>b.month===x.month); return bm?+bm.avg.toFixed(1):null; }),
        borderColor:'#3B6E8C',backgroundColor:'transparent',fill:false,tension:0.35,borderDash:[4,4],
        pointBackgroundColor:'#3B6E8C',pointRadius:4,pointHoverRadius:7,yAxisID:'y',spanGaps:true,
      });
    }
    State.charts.monthly=new Chart(ctx,{type:'line',data:{labels:s.map(x=>CONFIG.MONTHS_SHORT[x.month-1]),datasets},
      options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
        plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>ctx.datasetIndex===0||ctx.datasetIndex===2?` ${U.fmtMin(ctx.parsed.y)}`:` ${ctx.parsed.y}%`}}},
        scales:{x:SX,y:{...SY({callback:v=>U.fmtMinShort(v)}),title:{display:true,text:'Tempo',color:'#0F2942',font:{size:11,weight:'600'}}},
          y2:{position:'right',min:0,max:100,ticks:{color:'#2F855A',callback:v=>v+'%'},grid:{display:false},title:{display:true,text:'Conformidade (%)',color:'#2F855A',font:{size:11,weight:'600'}}}}}});
  },

  yoy(currentData, baseData) {
    this.kill('yoy');
    const ctx = document.getElementById('chartYoY')?.getContext('2d');
    if (!ctx) return;
    const combined = [...currentData, ...baseData];
    const byYear = KPI.monthlyByYear(combined);
    const years = Object.keys(byYear).sort();
    const months = [...new Set(combined.map(d=>d.month))].sort((a,b)=>a-b);
    const colors = ['#3B6E8C','#0F2942'];
    const allVals = years.flatMap(yr => months.map(m => byYear[yr][m]).filter(v => v !== null && v !== undefined));
    const maxVal = Math.max(...allVals, 10);
    const datasets = years.map((yr,i)=>({
      label:`${yr}`,
      data:months.map(m=>byYear[yr][m]??null),
      backgroundColor:colors[i%2],
      maxBarThickness:32,
      borderRadius:{ topLeft:4, topRight:4, bottomLeft:0, bottomRight:0 },
      borderSkipped:'bottom',
    }));

    // Render legend in card header
    const legEl = document.getElementById('yoyLegend');
    if (legEl) {
      legEl.innerHTML = years.map((yr, i) =>
        `<span class="yoy-leg-item"><span class="yoy-leg-dot" style="background:${colors[i % 2]}"></span>${yr}</span>`
      ).join('');
    }

    // Populate executive side summary
    const curYr = years[years.length - 1];
    const baseYr = years.length >= 2 ? years[years.length - 2] : null;
    const curEntries = curYr ? Object.entries(byYear[curYr]).map(([m, v]) => ({ m: +m, v })).filter(x => x.v !== null && x.v !== undefined) : [];
    const avgCur = curEntries.length ? U.avg(curEntries.map(x => x.v)) : null;
    const bestCur = curEntries.length ? [...curEntries].sort((a, b) => a.v - b.v)[0] : null;
    const worstCur = curEntries.length ? [...curEntries].sort((a, b) => b.v - a.v)[0] : null;

    const avgEl = document.getElementById('yoyAvgVal');
    const bestEl = document.getElementById('yoyBestVal');
    const worstEl = document.getElementById('yoyWorstVal');
    const fourthLbl = document.getElementById('yoyFourthLabel');
    const fourthVal = document.getElementById('yoyFourthVal');

    if (avgEl) avgEl.textContent = avgCur !== null ? U.fmtMin(avgCur) : '—';
    if (bestEl) bestEl.textContent = bestCur ? `${CONFIG.MONTHS_SHORT[bestCur.m - 1]} · ${U.fmtMin(bestCur.v)}` : '—';
    if (worstEl) worstEl.textContent = worstCur ? `${CONFIG.MONTHS_SHORT[worstCur.m - 1]} · ${U.fmtMin(worstCur.v)}` : '—';

    if (fourthLbl && fourthVal) {
      const baseEntries = baseYr ? Object.values(byYear[baseYr]).filter(v => v !== null && v !== undefined) : [];
      if (baseYr && baseEntries.length && avgCur !== null) {
        const avgBase = U.avg(baseEntries);
        const diff = avgCur - avgBase;
        const pct = avgBase > 0 ? (diff / avgBase) * 100 : 0;
        const sign = diff > 0 ? '+' : '';
        fourthLbl.textContent = `Variação vs. ${baseYr}`;
        fourthVal.textContent = `${diff > 0 ? '+' : ''}${U.fmtMin(diff)} (${sign}${pct.toFixed(1)}%)`;
        fourthVal.className = `yoy-stat-val tabular-num ${diff <= 0 ? 'yoy-val-good' : 'yoy-val-bad'}`;
      } else {
        fourthLbl.textContent = 'Meses com Dados';
        fourthVal.textContent = `${curEntries.length} de 12 meses`;
        fourthVal.className = 'yoy-stat-val tabular-num';
      }
    }

    State.charts.yoy=new Chart(ctx,{
      type:'bar',
      plugins:[ChartDataLabels],
      data:{labels:months.map(m=>CONFIG.MONTHS_SHORT[m-1]),datasets},
      options:{
        responsive:true,
        maintainAspectRatio:false,
        layout:{ padding:{ top:22, right:12, left:0, bottom:0 } },
        plugins:{
          legend:{ display:false },
          tooltip:{...TT,callbacks:{label:ctx=>` ${ctx.dataset.label}: ${U.fmtMin(ctx.parsed.y)}`}},
          datalabels:{
            anchor:'end',
            align:'top',
            offset:3,
            clamp:true,
            color:'#0F172A',
            font:{ family:'Inter', size:11, weight:'600' },
            formatter:v=>(v!==null&&v!==undefined)?U.fmtMinShort(v):''
          }
        },
        scales:{
          x:{
            grid:{ display:false },
            border:{ color:'#CBD5E1' },
            ticks:{ color:'#475569', font:{ family:'Inter', size:11, weight:'600' } }
          },
          y:{
            beginAtZero:true,
            suggestedMax:Math.ceil(maxVal*1.18),
            border:{ display:false, dash:[4,4] },
            grid:{ color:'#E2E8F0', tickLength:0 },
            ticks:{ color:'#475569', font:{ family:'Inter', size:11 }, callback:v=>U.fmtMinShort(v), padding:6 }
          }
        }
      }
    });
  },

  specialty(kpis) {
    this.kill('specialty');
    const ctx = document.getElementById('chartSpecialty')?.getContext('2d');
    if (!ctx||!kpis.specialtyStats.length) return;
    const st = kpis.specialtyStats.slice(0,10);
    const colors = st.map(s=>s.avg>CONFIG.ANAHP.waitTarget?'#B91C1C':'#2F855A');
    State.charts.specialty=new Chart(ctx,{type:'bar',data:{labels:st.map(s=>s.name),datasets:[{
      label:'Tempo Médio',data:st.map(s=>+s.avg.toFixed(1)),
      backgroundColor:colors,borderRadius:4,borderSkipped:false,
    }]},options:{indexAxis:'y',responsive:true,maintainAspectRatio:false,
      plugins:{legend:{display:false},tooltip:{...TT,callbacks:{label:ctx=>[` Tempo: ${U.fmtMin(ctx.parsed.x)}`,` Volume: ${st[ctx.dataIndex].count.toLocaleString('pt-BR')}`,` Conform.: ${st[ctx.dataIndex].compliance.toFixed(1)}%`]}}},
      scales:{x:{...SX,ticks:{...SX.ticks,callback:v=>U.fmtMinShort(v)}},y:{ticks:{color:'#0F172A',font:{family:'Inter',size:11,weight:'500'}},grid:{display:false}}}}});
  },

  convenioWait(kpis) {
    this.kill('convenioWait');
    const ctx = document.getElementById('chartConvenioWait')?.getContext('2d');
    if (!ctx || !kpis.convenioStats?.length) return;
    const list = kpis.convenioStats
      .filter(c => c.avgWait !== null)
      .sort((a, b) => b.avgWait - a.avgWait)
      .slice(0, 12);
    if (!list.length) return;
    const colors = list.map(c => c.avgWait > 90 ? '#B91C1C' : c.avgWait > 45 ? '#C27803' : '#0F2942');
    State.charts.convenioWait = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: list.map(c => c.name.length > 24 ? c.name.slice(0, 22) + '…' : c.name),
        datasets: [{
          label: 'Espera Média',
          data: list.map(c => c.avgWait),
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: {
            ...TT,
            callbacks: {
              title: items => list[items[0].dataIndex].name,
              label: ctx => {
                const c = list[ctx.dataIndex];
                return [
                  ` Espera Média: ${U.fmtMin(c.avgWait)}`,
                  ` Permanência Média: ${c.avgStay !== null ? U.fmtMin(c.avgStay) : '—'}`,
                  ` Volume: ${c.count.toLocaleString('pt-BR')} (${c.pct}%)`
                ];
              }
            }
          }
        },
        scales: {
          x: { ...SX, ticks: { ...SX.ticks, callback: v => U.fmtMinShort(v) } },
          y: { ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '500' } }, grid: { display: false } }
        }
      }
    });
  },

  distribution(data) {
    this.kill('distribution');
    const ctx = document.getElementById('chartDistribution')?.getContext('2d');
    if (!ctx) return;
    const vals = data.filter(d=>d.waitTime!==null).map(d=>d.waitTime);
    if (!vals.length) return;
    const BIN=10, MAX=130;
    const bins=[];
    for(let i=0;i<MAX;i+=BIN) bins.push({label:i>=MAX-BIN?`+${U.fmtMinShort(i)}`:`${U.fmtMinShort(i)}–${U.fmtMinShort(i+BIN)}`,min:i,count:0});
    vals.forEach(v=>{ const idx=Math.min(Math.floor(v/BIN),bins.length-1); if(idx>=0)bins[idx].count++; });
    const total=vals.length;
    State.charts.distribution=new Chart(ctx,{type:'bar',data:{labels:bins.map(b=>b.label),datasets:[{
      label:'% Atendimentos',data:bins.map(b=>+(b.count/total*100).toFixed(1)),
      backgroundColor:bins.map(b=>b.min<30?'#2F855A':b.min<60?'#C27803':'#B91C1C'),
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
      {type:'bar',label:'Volume',data:daily.map(d=>d.volume),backgroundColor:'rgba(59,110,140,0.32)',borderColor:'#3B6E8C',borderWidth:1,borderRadius:2,yAxisID:'y2'},
      {type:'line',label:'Tempo Médio Espera',data:daily.map(d=>d.avgWait),borderColor:'#C27803',backgroundColor:'transparent',fill:false,tension:0.3,pointRadius:0,pointHoverRadius:5,borderWidth:2,yAxisID:'y',spanGaps:true},
      {type:'line',label:'Média Móvel 7 Dias',data:ma,borderColor:'#0F2942',backgroundColor:'transparent',fill:false,tension:0.3,pointRadius:0,pointHoverRadius:4,borderWidth:2,borderDash:[4,4],yAxisID:'y',spanGaps:true},
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>ctx.datasetIndex===0?` Volume: ${ctx.parsed.y}`:ctx.datasetIndex===1?` Espera: ${U.fmtMin(ctx.parsed.y)}`:` Média Móvel 7d: ${U.fmtMin(ctx.parsed.y)}`}}},
      scales:{x:{...SX,ticks:{...SX.ticks,maxTicksLimit:20,maxRotation:45,font:{size:9.5}}},
        y:{...SY({callback:v=>U.fmtMinShort(v),color:'#C27803'}),title:{display:true,text:'Tempo',color:'#C27803',font:{size:11,weight:'600'}}},
        y2:{position:'right',ticks:{color:'#3B6E8C'},grid:{display:false},title:{display:true,text:'Volume',color:'#3B6E8C',font:{size:11,weight:'600'}}}}}});
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
      {type:'bar',label:'Tempo Médio',data:avgs,backgroundColor:avgs.map(v=>v>CONFIG.ANAHP.waitTarget?'#B91C1C':'#0F2942'),borderRadius:5,yAxisID:'y'},
      {type:'line',label:'Volume Total',data:labels.map(d=>M[d].vol),borderColor:'#C27803',backgroundColor:'transparent',pointBackgroundColor:'#C27803',pointBorderColor:'#FFFFFF',pointBorderWidth:2,pointRadius:6,tension:0.35,yAxisID:'y2'},
    ]},options:{responsive:true,maintainAspectRatio:false,
      plugins:{legend:LEG,tooltip:{...TT,callbacks:{label:ctx=>ctx.datasetIndex===0?` Espera: ${U.fmtMin(ctx.parsed.y)}`:` Volume: ${ctx.parsed.y.toLocaleString('pt-BR')}`}}},
      scales:{x:{...SX,ticks:{...SX.ticks,font:{size:11.5,weight:'600'}}},
        y:{...SY({callback:v=>U.fmtMinShort(v)}),title:{display:true,text:'Tempo',color:'#0F2942',font:{size:11,weight:'600'}}},
        y2:{position:'right',ticks:{color:'#C27803'},grid:{display:false},title:{display:true,text:'Volume',color:'#C27803',font:{size:11,weight:'600'}}}}}});
  },

  forecast(daily) {
    this.kill('forecast');
    const ctx=document.getElementById('chartForecast')?.getContext('2d');
    if(!ctx) return;
    const fc=KPI.forecast(daily, 30);
    if(!fc) { ctx.canvas.closest('.chart-body').innerHTML='<p style="padding:20px;color:var(--text-3);text-align:center">Dados insuficientes para projeção (mínimo 14 dias com registro)</p>'; return; }

    const histLabels = daily.slice(-60).map(d=>`${String(d.date.getDate()).padStart(2,'0')}/${String(d.date.getMonth()+1).padStart(2,'0')}`);
    const histVals   = daily.slice(-60).map(d=>d.avgWait);
    const fcLabels   = fc.predictions.map(p=>`${String(p.date.getDate()).padStart(2,'0')}/${String(p.date.getMonth()+1).padStart(2,'0')}`);
    const allLabels  = [...histLabels, ...fcLabels];
    const histData   = [...histVals, ...Array(fcLabels.length).fill(null)];
    const fcData     = [...Array(histLabels.length).fill(null), ...fc.predictions.map(p=>p.value)];
    const loData     = [...Array(histLabels.length).fill(null), ...fc.predictions.map(p=>p.lo)];
    const hiData     = [...Array(histLabels.length).fill(null), ...fc.predictions.map(p=>p.hi)];

    State.charts.forecast=new Chart(ctx,{type:'line',data:{labels:allLabels,datasets:[
      {label:'Histórico',data:histData,borderColor:'#0F2942',backgroundColor:'rgba(15,41,66,0.06)',fill:true,tension:0.3,pointRadius:0,pointHoverRadius:5,borderWidth:2,spanGaps:false},
      {label:'Projeção',data:fcData,borderColor:'#3B6E8C',backgroundColor:'rgba(59,110,140,0.08)',fill:false,tension:0.35,pointRadius:3.5,pointHoverRadius:6,borderWidth:2.5,borderDash:[],spanGaps:false},
      {label:'Banda Superior',data:hiData,borderColor:'rgba(59,110,140,0.35)',backgroundColor:'rgba(59,110,140,0.12)',fill:'+1',tension:0.35,pointRadius:0,borderWidth:1,borderDash:[3,3]},
      {label:'Banda Inferior',data:loData,borderColor:'rgba(59,110,140,0.35)',backgroundColor:'rgba(59,110,140,0.12)',fill:false,tension:0.35,pointRadius:0,borderWidth:1,borderDash:[3,3]},
    ]},options:{responsive:true,maintainAspectRatio:false,interaction:{mode:'index',intersect:false},
      plugins:{legend:{...LEG,labels:{...LEG.labels,filter:i=>i.datasetIndex<2}},tooltip:{...TT,callbacks:{
        label:ctx=>{ if(ctx.datasetIndex===0) return ` Histórico: ${U.fmtMin(ctx.parsed.y)}`; if(ctx.datasetIndex===1) return ` Projetado: ${U.fmtMin(ctx.parsed.y)}`; return ''; }
      }}},
      scales:{x:{...SX,ticks:{...SX.ticks,maxTicksLimit:18,maxRotation:45,font:{size:9.5}}},
        y:{...SY({callback:v=>U.fmtMinShort(v)})}}}});

    // Risk badges
    const badgeEl=document.getElementById('forecastRiskBadges');
    if(badgeEl){
      const weeks=[0,7,14,21].map(s=>({label:s===0?'Próx. 7d':s===7?'7–14d':s===14?'14–21d':'21–30d',avg:U.avg(fc.predictions.slice(s,s+7).map(p=>p.value))}));
      badgeEl.innerHTML=weeks.map(w=>{
        const cls=w.avg<=CONFIG.ANAHP.waitTarget?'risk-ok':w.avg<=CONFIG.ANAHP.waitTarget*1.5?'risk-warn':'risk-bad';
        return `<span class="risk-badge ${cls}">${w.label}: ${U.fmtMin(w.avg)}</span>`;
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
            backgroundColor: '#0F2942',
            borderRadius: 4,
            yAxisID: 'y',
            order: 2
          },
          {
            type: 'line',
            label: '% Acumulado',
            data: cumPercentages,
            borderColor: '#B91C1C',
            backgroundColor: 'transparent',
            pointBackgroundColor: '#B91C1C',
            pointBorderColor: '#FFFFFF',
            pointBorderWidth: 1.5,
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
          x: { ...SX, ticks: { ...SX.ticks, font: { size: 9.5 } } },
          y: { ...SY({ callback: v => v + 'h' }), title: { display: true, text: 'Espera Acumulada (h)', color: '#0F2942', font: { size: 10.5, weight: '600' } } },
          y2: {
            position: 'right',
            min: 0,
            max: 100,
            ticks: { color: '#B91C1C', callback: v => v + '%' },
            grid: { display: false },
            title: { display: true, text: '% Acumulado', color: '#B91C1C', font: { size: 10.5, weight: '600' } }
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
    // Track in #E2E8F0
    ctx.beginPath(); ctx.arc(cx,cy,r,start,end); ctx.strokeStyle='#E2E8F0'; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
    // Matte solid fill: Terracotta, Ochre, or Oxford Blue
    const filled=start+(end-start)*(Math.min(100,Math.max(0,score))/100);
    const fillCol = score >= 70 ? '#0F2942' : score >= 55 ? '#C27803' : '#B91C1C';
    ctx.beginPath(); ctx.arc(cx,cy,r,start,filled); ctx.strokeStyle=fillCol; ctx.lineWidth=14; ctx.lineCap='round'; ctx.stroke();
    // Score text
    const el=document.getElementById('oeeScore');
    if(el){ el.textContent=score.toFixed(1); el.style.color=fillCol; }
  },

  sectorTimes(kpis) {
    if (!State.charts.sectorTimes) {
      const ctx = document.getElementById('chartSectorTimes')?.getContext('2d');
      if (!ctx) return;
      State.charts.sectorTimes = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        plugins: [ChartDataLabels],
        options: {
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { top: 28, right: 8, left: 8, bottom: 0 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...TT,
              callbacks: {
                label: (ctx) => {
                  const v = ctx.parsed.y;
                  return v > 0 ? ` Permanência média: ${U.fmtMin(v)}` : ' Sem registros';
                }
              }
            },
            datalabels: {
              anchor: 'end',
              align: 'top',
              offset: 4,
              clamp: true,
              color: '#0F172A',
              font: { family: 'Inter', weight: '700', size: 12 },
              formatter: (val) => val > 0 ? U.fmtMin(val) : '—'
            }
          },
          scales: {
            y: { display: false, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: '#475569', font: { family: 'Inter', size: 11.5, weight: '600' } } }
          }
        }
      });
    }
    const chart = State.charts.sectorTimes;
    const reals = [kpis.avgSalaV, kpis.avgSorot, kpis.avgSutura].map(v => v === null ? 0 : v);
    const maxVal = Math.max(...reals, 10);

    chart.options.scales.y.suggestedMax = Math.ceil(maxVal * 1.18);
    chart.data.labels = ['Sala Vermelha', 'Soroterapia', 'Sutura'];
    chart.data.datasets = [{
      label: 'Permanência média',
      data: reals,
      backgroundColor: ['#0F2942', '#2C5282', '#4A7C9B'],
      borderRadius: 4,
      maxBarThickness: 56
    }];
    chart.update();
  },

  destinationDonut(kpis) {
    const stats = (kpis.destinationStats || []).filter(d => d.name !== 'Não Informado');
    if (!State.charts.destinationDonut) {
      const ctx = document.getElementById('chartDestinationDonut')?.getContext('2d');
      if (!ctx) return;
      State.charts.destinationDonut = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        plugins: [ChartDataLabels],
        options: {
          indexAxis: 'y',
          responsive: true,
          maintainAspectRatio: false,
          layout: { padding: { right: 96, top: 4, bottom: 4 } },
          plugins: {
            legend: { display: false },
            tooltip: {
              ...TT,
              callbacks: {
                label: (ctx) => {
                  const st = ctx.chart.$destStats?.[ctx.dataIndex];
                  const pctStr = st ? ` (${st.pct.toFixed(1).replace('.', ',')}%)` : '';
                  return ` ${ctx.parsed.x.toLocaleString('pt-BR')} pacientes${pctStr}`;
                }
              }
            },
            datalabels: {
              anchor: 'end',
              align: 'right',
              offset: 6,
              clip: false,
              color: '#0F172A',
              font: { family: 'Inter', weight: '600', size: 11 },
              formatter: (val, ctx) => {
                const st = ctx.chart.$destStats?.[ctx.dataIndex];
                const pctStr = st ? ` (${st.pct.toFixed(1).replace('.', ',')}%)` : '';
                return `${val.toLocaleString('pt-BR')}${pctStr}`;
              }
            }
          },
          scales: {
            x: { display: false, beginAtZero: true },
            y: { grid: { display: false }, ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '500' } } }
          }
        }
      });
    }
    const chart = State.charts.destinationDonut;
    const colors = ['#0F2942', '#3B6E8C', '#2F855A', '#C27803', '#B91C1C', '#64748B', '#1A3B5C'];
    const maxCount = Math.max(...stats.map(d => d.count), 1);

    chart.$destStats = stats;
    chart.options.scales.x.suggestedMax = Math.ceil(maxCount * 1.12);
    chart.data.labels = stats.map(d => d.name);
    chart.data.datasets = [{
      data: stats.map(d => d.count),
      backgroundColor: colors.slice(0, stats.length),
      borderRadius: 4,
      borderWidth: 0
    }];
    chart.update();
  },

  cycleEfficiency(data) {
    if (!State.charts.cycleEfficiency) {
      const ctx = document.getElementById('chartCycleEfficiency')?.getContext('2d');
      if (!ctx) return;
      State.charts.cycleEfficiency = new Chart(ctx, {
        type: 'bar',
        data: { labels: [], datasets: [] },
        options: {
          indexAxis: 'y',
          responsive: true, maintainAspectRatio: false,
          plugins: { 
            legend: { position: 'bottom', labels: { color: '#475569', font: { family: 'Inter', size: 11 }, boxWidth: 10, usePointStyle: true } },
            tooltip: { ...TT, callbacks: { label: ctx => ` ${ctx.dataset.label}: ${U.fmtMin(ctx.parsed.x)}` } },
            datalabels: { display: false }
          },
          scales: {
            x: { stacked: true, grid: { color: '#E2E8F0' }, ticks: { color: '#475569', font: { family: 'Inter', size: 10.5 }, callback: v => U.fmtMinShort(v) } },
            y: { stacked: true, grid: { display: false }, ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '500' } } }
          }
        }
      });
    }
    const chart = State.charts.cycleEfficiency;
    
    const bySpec = {};
    data.forEach(d => {
      const sp = d.specialty || 'Outros';
      if (!bySpec[sp]) bySpec[sp] = { sv: 0, sorot: 0, sutura: 0, wait: 0, count: 0 };
      if (d.salaVermelhaTime) bySpec[sp].sv += d.salaVermelhaTime;
      if (d.soroterapiaTime) bySpec[sp].sorot += d.soroterapiaTime;
      if (d.suturaTime) bySpec[sp].sutura += d.suturaTime;
      if (d.waitTime) bySpec[sp].wait += d.waitTime;
      bySpec[sp].count++;
    });

    const specEntries = Object.entries(bySpec)
      .filter(([s, v]) => v.count > 5 && s !== 'Outros')
      .sort((a, b) => b[1].count - a[1].count);
    
    const top7 = specEntries.slice(0, 7);
    const others = specEntries.slice(7);
    
    let otherData = { sv: 0, sorot: 0, sutura: 0, wait: 0, count: 0 };
    if (others.length > 0) {
      others.forEach(([s, v]) => {
        otherData.sv += v.sv; otherData.sorot += v.sorot; otherData.sutura += v.sutura; otherData.wait += v.wait; otherData.count += v.count;
      });
      if (bySpec['Outros']) {
         otherData.sv += bySpec['Outros'].sv; otherData.sorot += bySpec['Outros'].sorot; otherData.sutura += bySpec['Outros'].sutura; otherData.wait += bySpec['Outros'].wait; otherData.count += bySpec['Outros'].count;
      }
      top7.push(['Outros', otherData]);
    } else if (bySpec['Outros']) {
      top7.push(['Outros', bySpec['Outros']]);
    }

    const labels = top7.map(x => x[0]);
    
    chart.data.labels = labels;
    chart.data.datasets = [
      { label: 'Espera (Ficha-Médico)', data: top7.map(l => +(l[1].wait / l[1].count).toFixed(1)), backgroundColor: '#C27803' },
      { label: 'Sala Vermelha', data: top7.map(l => +(l[1].sv / l[1].count).toFixed(1)), backgroundColor: '#B91C1C' },
      { label: 'Soroterapia', data: top7.map(l => +(l[1].sorot / l[1].count).toFixed(1)), backgroundColor: '#3B6E8C' },
      { label: 'Sutura', data: top7.map(l => +(l[1].sutura / l[1].count).toFixed(1)), backgroundColor: '#2F855A' }
    ];
    chart.update();
  },

  triageFunnel(kpis) {
    if (!State.charts.triageFunnel) {
      const ctx = document.getElementById('chartTriageFunnel')?.getContext('2d');
      if (!ctx) return;
      State.charts.triageFunnel = new Chart(ctx, {
        type: 'bar',
        data: { labels: ['Ficha → Triagem', 'Triagem → Médico', 'Ficha → Médico (Total)'], datasets: [] },
        plugins: [ChartDataLabels],
        options: {
          responsive: true, maintainAspectRatio: false,
          plugins: { 
            legend: { display: false },
            tooltip: TT,
            datalabels: {
              color: '#FFFFFF',
              font: { family: 'Inter', weight: 'bold', size: 13 },
              formatter: (val) => val > 0 ? U.fmtMinShort(val) : ''
            }
          },
          scales: { 
            y: { display: false, beginAtZero: true },
            x: { grid: { display: false }, ticks: { color: '#475569', font: { family: 'Inter', size: 11 } } }
          }
        }
      });
    }
    const chart = State.charts.triageFunnel;
    
    chart.data.datasets = [{
      data: [kpis.avgTriageWait || 0, kpis.avgTriageToDocWait || 0, kpis.avgWait || 0],
      backgroundColor: ['#C27803', '#3B6E8C', '#B91C1C'],
      borderWidth: 0,
      borderRadius: 4
    }];
    chart.update();
  }
};

// ================================================================
// RENDERERS
// ================================================================
const Heatmap = {
  render(data) {
    const el=document.getElementById('heatmapContainer');
    if(!el) return;
    const M=KPI.heatmap(data);
    // Also build a daily index for clicks
    Heatmap._data = data;
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
        const color=c.count>0?U.heatColor(ratio):'#F8FAFC';
        const txtColor=ratio>=0.52?'#FFFFFF':'#0F172A';
        const avgW=c.count>0?Math.round(c.sum/c.count):null;
        const hasData = c.count>0;
        const clickAttr = hasData ? `data-hm-day="${day}" data-hm-hour="${h}" data-hm-count="${c.count}" data-hm-avg="${avgW}"` : '';
        const cursorStyle = hasData ? 'cursor:pointer;' : '';
        const label = hasData ? c.count : '';
        html+=`<div class="hm-cell${hasData?' hm-cell-active':''}" style="background:${color};color:${txtColor};${cursorStyle}" ${clickAttr}>${label}</div>`;
      }
      html+=`</div></div>`;
    });
    html+=`</div><div class="heatmap-scale"><span>Menor fluxo</span><div class="hm-scale-bar"></div><span>Maior fluxo</span></div></div>`;
    el.innerHTML=html;

    // Floating tooltip
    let tip = document.getElementById('hmTooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'hmTooltip';
      tip.className = 'hm-tooltip';
      document.body.appendChild(tip);
    }

    el.addEventListener('mousemove', e => {
      const cell = e.target.closest('.hm-cell-active');
      if (!cell) { tip.classList.remove('hm-tooltip-visible'); return; }
      const day   = cell.dataset.hmDay;
      const hour  = +cell.dataset.hmHour;
      const count = +cell.dataset.hmCount;
      const avg   = +cell.dataset.hmAvg;
      const compN = M[day]?.[hour]?.compliantCount ?? null;
      const compliance = count > 0 && M[day]?.[hour]?.compliantCount !== undefined
        ? Math.round(M[day][hour].compliantCount/count*100) : null;
      const statusColor = avg <= CONFIG.ANAHP.waitTarget ? '#166534' : avg <= 50 ? '#B45309' : '#B91C1C';
      const statusLabel = avg <= CONFIG.ANAHP.waitTarget ? 'Dentro da meta' : avg <= 50 ? 'Atenção' : 'Crítico';
      tip.innerHTML = `
        <div class="hm-tip-header">${day} · ${String(hour).padStart(2,'0')}h – ${String(hour+1).padStart(2,'0')}h</div>
        <div class="hm-tip-row"><span>Atendimentos</span><strong>${count}</strong></div>
        <div class="hm-tip-row"><span>Espera média</span><strong style="color:${statusColor}">${U.fmtMin(avg)}</strong></div>
        ${compliance!==null?`<div class="hm-tip-row"><span>Conformidade</span><strong>${compliance}%</strong></div>`:''}
        <div class="hm-tip-status" style="color:${statusColor}">${statusLabel}</div>
        <div class="hm-tip-hint">Clique para ver detalhes do horário</div>
      `;
      const r = cell.getBoundingClientRect();
      const scrollY = window.scrollY || 0;
      const scrollX = window.scrollX || 0;
      tip.style.top  = (r.top + scrollY - tip.offsetHeight - 10) + 'px';
      tip.style.left = Math.min(r.left + scrollX + r.width/2 - 110, window.innerWidth - 240) + 'px';
      tip.classList.add('hm-tooltip-visible');
    });
    el.addEventListener('mouseleave', () => tip.classList.remove('hm-tooltip-visible'));

    // Click: open DayDetailModal filtered by day-of-week + hour
    el.addEventListener('click', e => {
      const cell = e.target.closest('.hm-cell-active');
      if (!cell) return;
      const day  = cell.dataset.hmDay;
      const hour = +cell.dataset.hmHour;
      const dayData = data.filter(d => d.dow === day && d.entryHour === hour);
      DayDetailModal.openFromHeatmap(day, hour, dayData, data);
    });
  },
  _data: null,
};

const AnnualCalendar = {
  render(data) {
    const el=document.getElementById('annualCalendar');
    if(!el) return;
    AnnualCalendar._data = data;
    // Build daily maps
    const ww=data.filter(d=>d.waitTime!==null);
    const byDate=U.groupKey(data, d=>U.dateKey(d));
    const byDateWait=U.groupKey(ww, d=>U.dateKey(d));
    const dayMap={};
    Object.entries(byDate).forEach(([k,items])=>{
      const waitItems = byDateWait[k] || [];
      const avg = waitItems.length ? U.avg(waitItems.map(d=>d.waitTime)) : null;
      const compliant = waitItems.filter(d=>d.waitTime<=CONFIG.ANAHP.waitTarget).length;
      const compliance = waitItems.length ? Math.round(compliant/waitItems.length*100) : null;
      dayMap[k] = { count: items.length, avg, compliance, date: items[0].date, dow: items[0].dow };
    });
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
        const info=dayMap[key];
        let cls='cal-none';
        let dataAttrs='';
        let title=`${d}/${m}: sem dados`;
        if(info && info.avg !== null){
          cls=info.avg<=30?'cal-good':info.avg<=60?'cal-warn':'cal-bad';
          title=`${d}/${m}: ${U.fmtMin(info.avg)} de espera — ${info.count} atendimentos`;
          dataAttrs=`data-cal-key="${key}" data-cal-count="${info.count}" data-cal-avg="${info.avg.toFixed(1)}" data-cal-compliance="${info.compliance ?? ''}" data-cal-day="${d}" data-cal-month="${m}" data-cal-dow="${info.dow}"  `;
        } else if(info) {
          cls='cal-none';
          title=`${d}/${m}: ${info.count} atendimentos (sem tempo registrado)`;
          dataAttrs=`data-cal-key="${key}" data-cal-count="${info.count}" data-cal-avg="" data-cal-compliance="" data-cal-day="${d}" data-cal-month="${m}" data-cal-dow="${info.dow}"  `;
        }
        const hasData = !!info;
        html+=`<div class="cal-cell ${cls}${hasData?' cal-clickable':''}" title="${title}" ${dataAttrs}></div>`;
      }
      html+=`</div></div>`;
    });
    html+='</div>';
    el.innerHTML=html;

    // Floating tooltip for calendar
    let calTip = document.getElementById('calTooltip');
    if (!calTip) {
      calTip = document.createElement('div');
      calTip.id = 'calTooltip';
      calTip.className = 'hm-tooltip';
      document.body.appendChild(calTip);
    }

    el.addEventListener('mousemove', e => {
      const cell = e.target.closest('.cal-clickable');
      if (!cell) { calTip.classList.remove('hm-tooltip-visible'); return; }
      const count = +cell.dataset.calCount;
      const avgRaw = cell.dataset.calAvg;
      const avg = avgRaw ? +avgRaw : null;
      const comp = cell.dataset.calCompliance;
      const d    = cell.dataset.calDay;
      const m    = cell.dataset.calMonth;
      const dow  = cell.dataset.calDow;
      const statusColor = avg===null ? '#64748B' : avg<=30 ? '#166534' : avg<=60 ? '#B45309' : '#B91C1C';
      const statusLabel = avg===null ? 'Sem espera registrada' : avg<=30 ? 'Meta atingida' : avg<=60 ? 'Atenção' : 'Crítico';
      calTip.innerHTML = `
        <div class="hm-tip-header">${dow} · ${d}/${m}</div>
        <div class="hm-tip-row"><span>Atendimentos</span><strong>${count}</strong></div>
        ${avg!==null ? `<div class="hm-tip-row"><span>Espera média</span><strong style="color:${statusColor}">${U.fmtMin(+avgRaw)}</strong></div>` : ''}
        ${comp ? `<div class="hm-tip-row"><span>Conformidade</span><strong>${comp}%</strong></div>` : ''}
        <div class="hm-tip-status" style="color:${statusColor}">${statusLabel}</div>
        <div class="hm-tip-hint">Clique para ver detalhes do dia</div>
      `;
      const r = cell.getBoundingClientRect();
      const scrollY = window.scrollY || 0;
      calTip.style.top  = (r.top + scrollY - calTip.offsetHeight - 10) + 'px';
      calTip.style.left = Math.min(r.left + (window.scrollX||0) + r.width/2 - 110, window.innerWidth - 240) + 'px';
      calTip.classList.add('hm-tooltip-visible');
    });
    el.addEventListener('mouseleave', () => calTip.classList.remove('hm-tooltip-visible'));

    // Click: open DayDetailModal for the specific date
    el.addEventListener('click', e => {
      const cell = e.target.closest('.cal-clickable');
      if (!cell) return;
      const key = cell.dataset.calKey;
      const d   = cell.dataset.calDay;
      const m   = cell.dataset.calMonth;
      const dow = cell.dataset.calDow;
      DayDetailModal.openFromCalendar(key, +d, +m, dow, data);
      // Highlight selected cell
      el.querySelectorAll('.cal-cell.cal-selected').forEach(c=>c.classList.remove('cal-selected'));
      cell.classList.add('cal-selected');
    });
  },
  _data: null,
};

// ================================================================
// DAY DETAIL MODAL
// ================================================================
const DayDetailModal = {
  _selectedDateKey: null,

  openFromCalendar(dateKey, day, month, dow, allData) {
    const dayData = allData.filter(d => {
      const k = U.dateKey(d);
      return k === dateKey;
    });
    const label = `${dow}, ${day}/${month}`;
    this._selectedDateKey = dateKey;
    this._open(label, dayData, allData, dateKey);
  },

  openFromHeatmap(dow, hour, daySliceData, allData) {
    const label = `${dow} · ${String(hour).padStart(2,'0')}h–${String(hour+1).padStart(2,'0')}h`;
    this._selectedDateKey = null;
    this._open(label, daySliceData, allData, null, dow, hour);
  },

  _open(label, dayData, allData, dateKey, dow, hour) {
    const modal = document.getElementById('dayDetailModal');
    if (!modal) return;

    const ww = dayData.filter(d => d.waitTime !== null && d.waitTime >= 0);
    const avgWait = ww.length ? U.avg(ww.map(d => d.waitTime)) : null;
    const compliance = ww.length ? Math.round(ww.filter(d => d.waitTime <= CONFIG.ANAHP.waitTarget).length / ww.length * 100) : null;
    const avgStay = dayData.filter(d=>d.stayTime!==null).length
      ? U.avg(dayData.filter(d=>d.stayTime!==null).map(d=>d.stayTime)) : null;

    // Peak hour within this slice
    const hourMap = {};
    dayData.forEach(d => { if(d.entryHour!==null) hourMap[d.entryHour]=(hourMap[d.entryHour]||0)+1; });
    const peakEntry = Object.entries(hourMap).sort((a,b)=>b[1]-a[1])[0];
    const peakHour = peakEntry ? +peakEntry[0] : null;
    const peakLabel = peakHour!==null
      ? `${String(peakHour).padStart(2,'0')}h–${String(peakHour+1).padStart(2,'0')}h (${peakEntry[1]} atend.)`
      : '—';

    // Top shift
    const shiftMap = { 'Manhã':0, 'Tarde':0, 'Noite':0 };
    dayData.forEach(d => {
      if (d.entryHour===null) return;
      const sh = CONFIG.SHIFTS.find(s=>s.hours.includes(d.entryHour));
      if (sh) shiftMap[sh.label]++;
    });
    const peakShiftEntry = Object.entries(shiftMap).sort((a,b)=>b[1]-a[1])[0];
    const peakShift = peakShiftEntry ? `${peakShiftEntry[0]} (${peakShiftEntry[1]} atend.)` : '—';

    // Specialty breakdown (top 5)
    const specMap = {};
    dayData.forEach(d => { specMap[d.specialty]=(specMap[d.specialty]||0)+1; });
    const topSpecs = Object.entries(specMap).sort((a,b)=>b[1]-a[1]).slice(0,5);
    const maxSpec = topSpecs.length ? topSpecs[0][1] : 1;

    // YoY comparison (base data from State)
    let yoyHtml = '';
    if (dateKey && State.baseData) {
      const baseYear = State.baseData.length ? State.baseData[0].year : null;
      const curYear  = dayData.length ? dayData[0].year : null;
      if (baseYear && curYear && baseYear !== curYear) {
        const baseKey = dateKey.replace(String(curYear), String(baseYear));
        const baseDayWw = State.baseData.filter(d => U.dateKey(d) === baseKey && d.waitTime !== null);
        if (baseDayWw.length) {
          const baseAvg = U.avg(baseDayWw.map(d => d.waitTime));
          const delta = avgWait !== null ? (avgWait - baseAvg) : null;
          const deltaColor = delta === null ? '#64748B' : delta <= 0 ? '#166534' : '#B91C1C';
          const deltaIcon  = delta === null ? '' : delta <= 0 ? '▼' : '▲';
          yoyHtml = `
            <div class="ddm-yoy-bar">
              <span class="ddm-yoy-label">vs Ano Base (${baseYear})</span>
              <span class="ddm-yoy-val" style="color:${deltaColor}">${deltaIcon} ${delta!==null ? U.fmtMin(Math.abs(delta)) : '—'}</span>
              <span class="ddm-yoy-base">${U.fmtMin(baseAvg)} (${baseYear}) · ${baseDayWw.length} atend.</span>
            </div>`;
        }
      }
    }

    // Status
    const statusColor = avgWait===null?'#64748B':avgWait<=30?'#166534':avgWait<=50?'#B45309':'#B91C1C';
    const statusLabel = avgWait===null?'Sem dados':avgWait<=30?'Meta Atingida':avgWait<=50?'Atenção':'Crítico';

    document.getElementById('ddmTitle').textContent = label;
    document.getElementById('ddmBody').innerHTML = `
      <div class="ddm-kpis">
        <div class="ddm-kpi">
          <span class="ddm-kpi-val">${dayData.length}</span>
          <span class="ddm-kpi-label">Atendimentos</span>
        </div>
        <div class="ddm-kpi">
          <span class="ddm-kpi-val" style="color:${statusColor}">${avgWait!==null?U.fmtMin(avgWait):'—'}</span>
          <span class="ddm-kpi-label">Espera Média</span>
        </div>
        <div class="ddm-kpi">
          <span class="ddm-kpi-val" style="color:${compliance!==null&&compliance>=80?'#166534':compliance!==null&&compliance>=60?'#B45309':'#B91C1C'}">${compliance!==null?compliance+'%':'—'}</span>
          <span class="ddm-kpi-label">Conformidade</span>
        </div>
        <div class="ddm-kpi">
          <span class="ddm-kpi-val">${avgStay!==null?U.fmtMin(avgStay):'—'}</span>
          <span class="ddm-kpi-label">Permanência</span>
        </div>
        <div class="ddm-kpi">
          <span class="ddm-kpi-val" style="font-size:12.5px">${peakShift}</span>
          <span class="ddm-kpi-label">Turno de Pico</span>
        </div>
        <div class="ddm-kpi">
          <span class="ddm-kpi-val" style="font-size:12.5px">${peakLabel}</span>
          <span class="ddm-kpi-label">Hora de Pico</span>
        </div>
      </div>

      <div class="ddm-status-bar" style="border-color:${statusColor};color:${statusColor}">${statusLabel}</div>

      ${yoyHtml}

      <div class="ddm-section-title">Distribuição por Especialidade</div>
      <div class="ddm-specs">
        ${topSpecs.length ? topSpecs.map(([name,cnt])=>{
          const ratio = cnt/maxSpec;
          const pct   = dayData.length ? Math.round(cnt/dayData.length*100) : 0;
          return `<div class="ddm-spec-row">
            <span class="ddm-spec-name">${name}</span>
            <div class="ddm-spec-bar-wrap"><div class="ddm-spec-bar" style="width:${(ratio*100).toFixed(0)}%"></div></div>
            <span class="ddm-spec-cnt">${cnt} <span style="color:#64748B;font-size:10px">(${pct}%)</span></span>
          </div>`;
        }).join('') : '<p style="color:#64748B;font-size:12px;padding:8px 0">Sem dados</p>'}
      </div>

      <div class="ddm-footer-actions">
        <button class="ddm-btn-filter" onclick="DayDetailModal.filterAudit()">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none"><path d="M3 4h18M7 12h10M11 20h2" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>
          ${dateKey ? 'Ver atendimentos do dia na Auditoria' : 'Ver atendimentos do horário na Auditoria'}
        </button>
        <button class="ddm-btn-close" onclick="DayDetailModal.close()">
          Fechar
        </button>
      </div>
    `;

    DayDetailModal._currentDayData = dayData;
    DayDetailModal._currentDateKey = dateKey;
    DayDetailModal._currentDow = dow || null;
    DayDetailModal._currentHour = (hour !== undefined && hour !== null) ? hour : null;
    modal.classList.remove('hidden');
  },

  filterAudit() {
    // Store filter intent and close modal, then scroll to audit section
    const key = DayDetailModal._currentDateKey;
    const dow = DayDetailModal._currentDow;
    const hour = DayDetailModal._currentHour;
    this.close();
    if (!key && (!dow || hour === null || hour === undefined)) return;

    if (key && AuditPanel && typeof AuditPanel.filterByDate === 'function') {
      AuditPanel.filterByDate(key, true);
    } else if (dow && hour !== null && hour !== undefined && AuditPanel && typeof AuditPanel.filterBySlot === 'function') {
      AuditPanel.filterBySlot(dow, hour, true);
    }
  },

  close() {
    const modal = document.getElementById('dayDetailModal');
    if (modal) modal.classList.add('hidden');
    // Remove calendar selection highlight
    document.querySelectorAll('.cal-cell.cal-selected').forEach(c => c.classList.remove('cal-selected'));
  },

  _currentDayData: null,
  _currentDateKey: null,
  _currentDow: null,
  _currentHour: null,
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
    if(badge) badge.textContent=`${anom.length} registro${anom.length===1?'':'s'}`;
    if(!anom.length){
      el.innerHTML='<p style="padding:20px;color:var(--text-3);font-size:13px;text-align:center">Nenhum dia fora do padrão registrado neste período</p>';
      return;
    }
    let html='<table class="data-table"><thead><tr><th>Data</th><th>Dia</th><th>Média</th><th>Desvio</th><th>Volume</th></tr></thead><tbody>';
    anom.forEach(d=>{
      const cls=d.z>3?'time-bad':'time-warn';
      const dk=U.dateKey(d);
      html+=`<tr class="${d.z>3?'row-critical':'row-warning'}" style="cursor:pointer;" title="Clique para ver os atendimentos de ${U.fmtDate(d.date)} na Auditoria" onclick="AuditPanel.filterByDate('${dk}', true)">
        <td><strong>${U.fmtDate(d.date)}</strong></td><td>${d.dow}</td>
        <td class="${cls}">${U.fmtMin(d.avg)}</td>
        <td class="anomaly-sigma">+${d.z.toFixed(2)}σ</td>
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
      const dk=U.dateKey(d);
      html+=`<tr class="${row}" style="cursor:pointer;" title="Clique para ver os atendimentos de ${U.fmtDate(d.date)} na Auditoria" onclick="AuditPanel.filterByDate('${dk}', true)"><td class="rank-cell">${i+1}°</td><td><strong>${U.fmtDate(d.date)}</strong></td><td>${d.dow}</td><td class="${cls}">${U.fmtMin(d.avg)}</td><td>${d.volume}</td><td class="${d.compliance>=80?'time-good':d.compliance>=60?'time-warn':'time-bad'}">${d.compliance.toFixed(1)}%</td></tr>`;
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
    const statusType=kpis.avgWait<=CONFIG.ANAHP.waitTarget?'good':kpis.avgWait<=40?'warn':'bad';
    insights.push({
      title:'Status Geral do Período',type:statusType,
      body:`Tempo médio de espera: <strong>${U.fmtMin(kpis.avgWait)}</strong>. Meta ANAHP: ≤ 30min. Conformidade: <strong>${kpis.compliance}%</strong>.`,
    });

    // 2. Best month
    if(kpis.bestMonth){
      insights.push({
        title:'Melhor Desempenho Mensal',type:'good',
        body:`<strong>${kpis.bestMonth.name}</strong> registrou o menor tempo médio (<strong>${U.fmtMin(kpis.bestMonth.avg)}</strong>) com conformidade de <strong>${kpis.bestMonth.compliance.toFixed(1)}%</strong>.`,
      });
    }

    // 3. Worst month
    if(kpis.worstMonth&&kpis.worstMonth.month!==kpis.bestMonth?.month){
      const wtype=kpis.worstMonth.avg>45?'bad':'warn';
      insights.push({
        title:'Mês Mais Crítico',type:wtype,
        body:`<strong>${kpis.worstMonth.name}</strong> registrou o maior tempo de espera: <strong>${U.fmtMin(kpis.worstMonth.avg)}</strong> e conformidade de <strong>${kpis.worstMonth.compliance.toFixed(1)}%</strong>.`,
      });
    }

    // 4. Worst & best specialty (prioritize relevant volume >= 10 when available)
    if(kpis.specialtyStats.length){
      const minVol = 10;
      const relevant = kpis.specialtyStats.filter(s => s.count >= minVol);
      const pool = relevant.length >= 2 ? relevant : kpis.specialtyStats;
      const ws = [...pool].sort((a,b) => b.avg - a.avg || b.count - a.count)[0];
      const bs = [...pool].sort((a,b) => a.avg - b.avg || b.compliance - a.compliance || b.count - a.count)[0];
      if(ws){
        const pctOver = ((ws.avg/CONFIG.ANAHP.waitTarget-1)*100).toFixed(0);
        const diffLabel = ws.avg > CONFIG.ANAHP.waitTarget ? ` — <strong>${pctOver}%</strong> acima da meta` : ' (dentro da meta)';
        insights.push({
          title:'Especialidade Crítica',type: ws.avg > CONFIG.ANAHP.waitTarget ? 'bad' : 'warn',
          body:`<strong>${ws.name}</strong> apresentou a maior espera média: <strong>${U.fmtMin(ws.avg)}</strong>${diffLabel}, em ${ws.count.toLocaleString('pt-BR')} atendimentos.`,
        });
      }
      if(bs && (!ws || bs.name !== ws.name)){
        insights.push({
          title:'Especialidade Destaque',type:'good',
          body:`<strong>${bs.name}</strong> manteve o menor tempo médio: <strong>${U.fmtMin(bs.avg)}</strong> com conformidade de <strong>${bs.compliance.toFixed(1)}%</strong> (${bs.count.toLocaleString('pt-BR')} atendimentos).`,
        });
      }
    }

    // 5. Peak hour
    if(kpis.peakHour!==null){
      insights.push({
        title:'Horário de Pico',type:'warn',
        body:`O maior volume de chegadas ocorre às <strong>${String(kpis.peakHour).padStart(2,'0')}h</strong>. Recomenda-se reforço de escala neste intervalo para manter a meta ANAHP.`,
      });
    }

    // 6. Volume
    insights.push({
      title:'Volume de Atendimentos',type:'info',
      body:`Total de <strong>${kpis.total.toLocaleString('pt-BR')}</strong> atendimentos em <strong>${kpis.totalDays}</strong> dias. Média diária: <strong>${kpis.avgDaily}</strong> atendimentos/dia.`,
    });

    // 7. Out-of-pattern days
    const anom=KPI.anomalies(data);
    if(anom.length){
      insights.push({
        title:'Dias Fora do Padrão',type:'bad',
        body:`<strong>${anom.length}</strong> dia${anom.length>1?'s':' '} com pico atípico de espera. Data mais crítica: <strong>${U.fmtDate(anom[0].date)}</strong> (${U.fmtMin(anom[0].avg)}).`,
      });
    } else {
      insights.push({
        title:'Estabilidade Operacional',type:'good',
        body:'Nenhum dia com pico atípico de espera registrado no período — fluxo operacional estável.',
      });
    }

    el.innerHTML=insights.map(i=>`<div class="report-insight insight-${i.type}"><div class="ri-header"><span class="ri-title">${i.title}</span></div><div class="ri-body">${i.body}</div></div>`).join('');
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
        target: `≤ ${U.fmtMin(CONFIG.ANAHP.waitTarget)}`,
        avgVal: U.fmtMin(kpis.avgWait),
        statusFn: v => v <= CONFIG.ANAHP.waitTarget ? 'good' : v <= 40 ? 'warn' : 'bad'
      },
      {
        name: 'Conformidade de Espera',
        target: `≥ ${CONFIG.ANAHP.complianceTarget}%`,
        avgVal: `${kpis.compliance.toFixed(1)}%`,
        statusFn: v => v >= CONFIG.ANAHP.complianceTarget ? 'good' : v >= 70 ? 'warn' : 'bad'
      },
      {
        name: 'Tempo Médio de Permanência',
        target: `≤ ${U.fmtMin(CONFIG.ANAHP.stayTarget)}`,
        avgVal: U.fmtMin(kpis.avgStay),
        statusFn: v => v <= CONFIG.ANAHP.stayTarget ? 'good' : v <= 300 ? 'warn' : 'bad'
      },
      {
        name: 'Volume de Atendimentos',
        target: '—',
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
          valStr = U.fmtMin(s.avgWait);
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
      
      html += `<td class="${genCls}"><strong>${r.avgVal}</strong></td>
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
    ctx.beginPath(); ctx.arc(cx, cy, r, start, end); ctx.strokeStyle = '#E2E8F0'; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
    const filled = start + (end - start) * (Math.min(100, Math.max(0, score)) / 100);
    const fillCol = score >= 70 ? '#0F2942' : score >= 55 ? '#C27803' : '#B91C1C';
    ctx.beginPath(); ctx.arc(cx, cy, r, start, filled); ctx.strokeStyle = fillCol; ctx.lineWidth = 14; ctx.lineCap = 'round'; ctx.stroke();
    
    const el = document.getElementById('simOeeScore');
    if (el) {
      el.textContent = score.toFixed(1);
      el.style.color = fillCol;
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
    const cx = 180, cy = 176, r = 128, start = Math.PI, end = 2 * Math.PI;
    ctx.clearRect(0, 0, 360, 200);
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 360, 200);

    ctx.beginPath();
    ctx.arc(cx, cy, r, start, end);
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.stroke();

    const scoreVal = Math.min(100, Math.max(0, score || 0));
    const filled = start + (end - start) * (scoreVal / 100);
    const fillCol = scoreVal >= 70 ? '#0F2942' : scoreVal >= 55 ? '#B45309' : '#9B1C1C';

    ctx.beginPath();
    ctx.arc(cx, cy, r, start, filled);
    ctx.strokeStyle = fillCol;
    ctx.lineWidth = 24;
    ctx.lineCap = 'round';
    ctx.stroke();

    return canvas.toDataURL('image/png');
  },

  monthly(kpis, baseKpis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 440;
    const ctx = canvas.getContext('2d');
    const s = kpis.monthStats;
    if (!s.length) return '';

    const datasets = [{
      label: 'Tempo Médio',
      data: s.map(x => +x.avg.toFixed(1)),
      borderColor: '#0F2942',
      backgroundColor: 'rgba(15, 41, 66, 0.08)',
      fill: true,
      tension: 0.35,
      pointBackgroundColor: '#0F2942',
      pointBorderColor: '#FFFFFF',
      pointBorderWidth: 2,
      pointRadius: 5,
      yAxisID: 'y',
    }, {
      label: 'Conformidade ≤ 30min (%)',
      data: s.map(x => +x.compliance.toFixed(1)),
      borderColor: '#166534',
      backgroundColor: 'transparent',
      fill: false,
      tension: 0.35,
      borderDash: [6, 3],
      pointBackgroundColor: '#166534',
      pointBorderColor: '#FFFFFF',
      pointBorderWidth: 2,
      pointRadius: 5,
      yAxisID: 'y2',
    }];

    if (baseKpis) {
      datasets.push({
        label: 'Tempo Médio Ano Base',
        data: s.map(x => {
          const bm = baseKpis.monthStats.find(b => b.month === x.month);
          return bm ? +bm.avg.toFixed(1) : null;
        }),
        borderColor: '#3B6E8C',
        backgroundColor: 'transparent',
        fill: false,
        tension: 0.35,
        borderDash: [4, 4],
        pointBackgroundColor: '#3B6E8C',
        pointRadius: 4,
        yAxisID: 'y',
        spanGaps: true,
      });
    }

    const chart = new Chart(ctx, {
      type: 'line',
      plugins: [printBgPlugin],
      data: { labels: s.map(x => CONFIG.MONTHS_SHORT[x.month - 1]), datasets },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: { display: true, labels: { color: '#0F172A', font: { family: 'Inter', size: 12, weight: '600' }, usePointStyle: true, padding: 16 } }
        },
        scales: {
          x: { ticks: { color: '#475569', font: { family: 'Inter', size: 11 } }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#0F2942', font: { family: 'Inter', size: 11 }, callback: v => U.fmtMinShort(v) }, grid: { color: '#E2E8F0' }, title: { display: true, text: 'Tempo Médio', color: '#0F2942', font: { family: 'Inter', size: 11, weight: 'bold' } } },
          y2: { position: 'right', min: 0, max: 100, ticks: { color: '#166534', font: { family: 'Inter', size: 11 }, callback: v => v + '%' }, grid: { display: false }, title: { display: true, text: 'Conformidade (%)', color: '#166534', font: { family: 'Inter', size: 11, weight: 'bold' } } }
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
    canvas.height = 460;
    const ctx = canvas.getContext('2d');
    const st = kpis.specialtyStats.slice(0, 10);
    if (!st.length) return '';

    const colors = st.map(s => s.avg > CONFIG.ANAHP.waitTarget ? '#9B1C1C' : '#166534');
    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels: st.map(s => s.name),
        datasets: [{
          label: 'Tempo Médio',
          data: st.map(s => +s.avg.toFixed(1)),
          backgroundColor: colors,
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, callback: v => U.fmtMinShort(v) }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '600' } }, grid: { display: false } }
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
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    const vals = data.filter(d => d.waitTime !== null).map(d => d.waitTime);
    if (!vals.length) return '';

    const BIN = 10, MAX = 130;
    const bins = [];
    for (let i = 0; i < MAX; i += BIN) bins.push({ label: i >= MAX - BIN ? `+${U.fmtMinShort(i)}` : `${U.fmtMinShort(i)}–${U.fmtMinShort(i + BIN)}`, min: i, count: 0 });
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
          backgroundColor: bins.map(b => b.min < 30 ? '#166534' : b.min < 60 ? '#B45309' : '#9B1C1C'),
          borderRadius: 4,
          borderSkipped: false,
        }]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { display: false } },
        scales: {
          x: { ticks: { color: '#475569', font: { family: 'Inter', size: 10.5 }, maxRotation: 45 }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, callback: v => v + '%' }, grid: { color: '#E2E8F0' } }
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
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!daily.length) return '';

    const labels = daily.map(d => `${String(d.date.getDate()).padStart(2, '0')}/${String(d.date.getMonth() + 1).padStart(2, '0')}`);
    const ma = [];
    for (let i = 0; i < daily.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - 6); j <= i; j++) {
        if (daily[j].avgWait !== null) { sum += daily[j].avgWait; count++; }
      }
      ma.push(count > 0 ? +(sum / count).toFixed(1) : null);
    }

    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels,
        datasets: [
          { type: 'bar', label: 'Volume Diário', data: daily.map(d => d.volume), backgroundColor: 'rgba(59, 110, 140, 0.35)', borderColor: '#3B6E8C', borderWidth: 1, borderRadius: 2, yAxisID: 'y2' },
          { type: 'line', label: 'Espera Média', data: daily.map(d => d.avgWait), borderColor: '#B45309', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2, yAxisID: 'y', spanGaps: true },
          { type: 'line', label: 'Média Móvel 7 Dias', data: ma, borderColor: '#0F2942', backgroundColor: 'transparent', fill: false, tension: 0.3, pointRadius: 0, borderWidth: 2.2, borderDash: [5, 4], yAxisID: 'y', spanGaps: true }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { display: true, labels: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '600' }, usePointStyle: true, padding: 14 } } },
        scales: {
          x: { ticks: { color: '#475569', font: { family: 'Inter', size: 10 }, maxTicksLimit: 20, maxRotation: 45 }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#B45309', font: { family: 'Inter', size: 11 }, callback: v => U.fmtMinShort(v) }, grid: { color: '#E2E8F0' }, title: { display: true, text: 'Tempo', color: '#B45309', font: { family: 'Inter', size: 11, weight: 'bold' } } },
          y2: { position: 'right', ticks: { color: '#3B6E8C', font: { family: 'Inter', size: 11 } }, grid: { display: false }, title: { display: true, text: 'Volume', color: '#3B6E8C', font: { family: 'Inter', size: 11, weight: 'bold' } } }
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
    canvas.height = 420;
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
          { type: 'bar', label: 'Tempo Médio', data: avgs, backgroundColor: avgs.map(v => v > CONFIG.ANAHP.waitTarget ? '#9B1C1C' : '#0F2942'), borderRadius: 5, yAxisID: 'y' },
          { type: 'line', label: 'Volume Total', data: labels.map(d => M[d].vol), borderColor: '#B45309', backgroundColor: 'transparent', pointBackgroundColor: '#B45309', pointBorderColor: '#FFFFFF', pointBorderWidth: 2, pointRadius: 6, tension: 0.35, yAxisID: 'y2' }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { display: true, labels: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '600' }, usePointStyle: true, padding: 14 } } },
        scales: {
          x: { ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: 'bold' } }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, callback: v => U.fmtMinShort(v) }, grid: { color: '#E2E8F0' }, title: { display: true, text: 'Tempo', color: '#0F2942', font: { family: 'Inter', size: 11, weight: 'bold' } } },
          y2: { position: 'right', ticks: { color: '#B45309', font: { family: 'Inter', size: 11 } }, grid: { display: false }, title: { display: true, text: 'Volume', color: '#B45309', font: { family: 'Inter', size: 11, weight: 'bold' } } }
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
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    if (!kpis.specialtyStats.length) return '';

    const specs = kpis.specialtyStats.map(s => ({ name: s.name, totalWait: s.avg * s.count }))
      .sort((a, b) => b.totalWait - a.totalWait).slice(0, 7);

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
          { type: 'bar', label: 'Espera Acumulada (h)', data: specs.map(s => +(s.totalWait / 60).toFixed(1)), backgroundColor: '#0F2942', borderRadius: 4, yAxisID: 'y', order: 2 },
          { type: 'line', label: '% Acumulado', data: cumPercentages, borderColor: '#9B1C1C', backgroundColor: 'transparent', pointBackgroundColor: '#9B1C1C', pointBorderColor: '#FFFFFF', pointBorderWidth: 1.5, pointRadius: 5, tension: 0.2, yAxisID: 'y2', order: 1 }
        ]
      },
      options: {
        responsive: false,
        animation: false,
        plugins: { legend: { display: true, labels: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '600' }, usePointStyle: true, padding: 14 } } },
        scales: {
          x: { ticks: { color: '#475569', font: { family: 'Inter', size: 10 } }, grid: { color: '#E2E8F0' } },
          y: { ticks: { color: '#0F2942', font: { family: 'Inter', size: 11 }, callback: v => v + 'h' }, grid: { color: '#E2E8F0' }, title: { display: true, text: 'Horas Acumuladas', color: '#0F2942', font: { family: 'Inter', size: 11, weight: 'bold' } } },
          y2: { position: 'right', min: 0, max: 100, ticks: { color: '#9B1C1C', font: { family: 'Inter', size: 11 }, callback: v => v + '%' }, grid: { display: false }, title: { display: true, text: '% Acumulado', color: '#9B1C1C', font: { family: 'Inter', size: 11, weight: 'bold' } } }
        }
      }
    });

    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  sectorTimes(kpis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 320;
    const ctx = canvas.getContext('2d');
    const items = [
      { label: 'Sala Vermelha', val: kpis.avgSalaV, color: '#9B1C1C' },
      { label: 'Soroterapia', val: kpis.avgSorot, color: '#0F2942' },
      { label: 'Sutura', val: kpis.avgSutura, color: '#B45309' }
    ].filter(x => x.val !== null && x.val > 0);
    if (!items.length) return '';

    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels: items.map(x => x.label),
        datasets: [{
          label: 'Tempo Médio',
          data: items.map(x => x.val),
          backgroundColor: items.map(x => x.color),
          borderRadius: 5,
          barPercentage: 0.55
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'right',
            color: '#0F172A',
            font: { family: 'Inter', size: 12, weight: 'bold' },
            formatter: v => U.fmtMin(v)
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: Math.max(...items.map(x => x.val)) * 1.18,
            ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, callback: v => U.fmtMinShort(v) },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 12, weight: '600' } },
            grid: { display: false }
          }
        }
      }
    });

    const img = canvas.toDataURL('image/png');
    chart.destroy();
    return img;
  },

  convenioWait(kpis) {
    const canvas = document.createElement('canvas');
    canvas.width = 1200;
    canvas.height = 420;
    const ctx = canvas.getContext('2d');
    const list = (kpis.convenioStats || [])
      .filter(c => c.avgWait !== null)
      .sort((a, b) => b.avgWait - a.avgWait)
      .slice(0, 12);
    if (!list.length) return '';

    const maxVal = Math.max(...list.map(c => c.avgWait), 30);
    const chart = new Chart(ctx, {
      type: 'bar',
      plugins: [printBgPlugin],
      data: {
        labels: list.map(c => c.name.length > 28 ? c.name.slice(0, 26) + '…' : c.name),
        datasets: [{
          label: 'Espera Média (Ficha → Médico)',
          data: list.map(c => c.avgWait),
          backgroundColor: list.map(c => c.avgWait > 90 ? '#9B1C1C' : c.avgWait > 45 ? '#B45309' : '#0F2942'),
          borderRadius: 4,
          barPercentage: 0.72
        }]
      },
      options: {
        indexAxis: 'y',
        responsive: false,
        animation: false,
        plugins: {
          legend: { display: false },
          datalabels: {
            display: true,
            anchor: 'end',
            align: 'right',
            color: '#0F172A',
            font: { family: 'Inter', size: 11, weight: 'bold' },
            formatter: v => U.fmtMinShort(v)
          }
        },
        scales: {
          x: {
            beginAtZero: true,
            suggestedMax: Math.ceil(maxVal * 1.16),
            ticks: { color: '#475569', font: { family: 'Inter', size: 11 }, callback: v => U.fmtMinShort(v) },
            grid: { color: '#E2E8F0' }
          },
          y: {
            ticks: { color: '#0F172A', font: { family: 'Inter', size: 11, weight: '600' } },
            grid: { display: false }
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
  buildFilterLabel() {
    const parts = [];
    const c = State.filters.convenio || 'TODOS';
    if (c === 'TODOS') parts.push('Todos os Convênios');
    else if (c === 'TIPO:SUS' || c === 'SUS') parts.push('Apenas SUS');
    else if (c === 'TIPO:CONVÊNIOS' || c === 'CONVÊNIOS') parts.push('Todos os Privados / Convênios');
    else if (c.startsWith('OP:')) parts.push(c.slice(3));
    else parts.push(c);

    if (State.filters.specialty && State.filters.specialty !== 'all') {
      parts.push(State.filters.specialty);
    }
    if (State.filters.month && State.filters.month !== 'all') {
      parts.push(CONFIG.MONTHS[+State.filters.month - 1] || '');
    }
    return parts.filter(Boolean).join(' · ');
  },

  buildDestinationTable(kpis) {
    const list = (kpis.destinationStats || []).filter(d => d.name !== 'Não Informado').slice(0, 10);
    if (!list.length) return '<p class="empty-msg">Sem dados de desfecho registrados.</p>';
    const rows = list.map(d => `<tr>
      <td><strong>${d.name}</strong></td>
      <td class="num">${d.count.toLocaleString('pt-BR')}</td>
      <td class="num"><strong>${d.pct}%</strong></td>
      <td class="num">${d.avgWait !== null ? U.fmtMin(d.avgWait) : '—'}</td>
    </tr>`).join('');
    return `<table class="data-table">
      <thead>
        <tr>
          <th>Desfecho / Destino</th>
          <th class="num">Pacientes</th>
          <th class="num">% do Total</th>
          <th class="num">Espera Média</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  },

  buildConvenioTable(kpis) {
    const list = kpis.convenioStats || [];
    if (!list.length) return '<p class="empty-msg">Sem dados de convênio disponíveis.</p>';
    const rows = list.map((c, idx) => {
      const waitCls = c.avgWait === null ? '' : c.avgWait > 90 ? 'time-bad' : c.avgWait > 45 ? 'time-warn' : 'time-good';
      return `<tr>
        <td class="rank-cell">${idx + 1}</td>
        <td class="spec-cell"><strong>${c.name}</strong></td>
        <td class="num">${c.count.toLocaleString('pt-BR')}</td>
        <td class="num muted">${c.pct}%</td>
        <td class="num ${waitCls}">${c.avgWait !== null ? U.fmtMin(c.avgWait) : '—'}</td>
        <td class="num">${c.avgStay !== null ? U.fmtMin(c.avgStay) : '—'}</td>
        <td class="num">${c.waitGt60Pct}%</td>
        <td class="num">${c.internRate}%</td>
      </tr>`;
    }).join('');
    return `<table class="data-table">
      <thead>
        <tr>
          <th style="width:24pt;">#</th>
          <th>Convênio / Operadora</th>
          <th class="num">Atend.</th>
          <th class="num">% Vol.</th>
          <th class="num">Espera Méd.</th>
          <th class="num">Permanência</th>
          <th class="num">&gt; 1h</th>
          <th class="num">Intern.</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>`;
  },
  buildPeriodInfo(data, kpis) {
    const months = [...new Set(data.map(d => d.month))].sort((a, b) => a - b);
    const firstM = CONFIG.MONTHS_SHORT[(months[0] || 1) - 1];
    const lastM = CONFIG.MONTHS_SHORT[(months[months.length - 1] || 1) - 1];
    const years = [...new Set(data.map(d => d.year))].sort((a, b) => a - b);
    const yrLabel = years.length > 1 ? `${years[0]}–${years[years.length - 1]}` : `${years[0] || new Date().getFullYear()}`;
    const rangeLabel = firstM === lastM ? `${firstM} ${yrLabel}` : `${firstM}–${lastM} ${yrLabel}`;
    const daysWord = kpis.totalDays === 1 ? 'dia' : 'dias';
    return `${rangeLabel} (${kpis.totalDays} ${daysWord})`;
  },

  buildScorecardTable(kpis, data) {
    const byMonth = U.groupKey(data, d => d.month);
    const monthsInData = Object.keys(byMonth).map(Number).sort((a, b) => a - b);
    if (!monthsInData.length) return '<p class="empty-msg">Sem dados mensais disponíveis.</p>';

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

    const waitCls = v => v <= CONFIG.ANAHP.waitTarget ? 'time-good' : v <= 40 ? 'time-warn' : 'time-bad';
    const compCls = v => v >= CONFIG.ANAHP.complianceTarget ? 'time-good' : v >= 70 ? 'time-warn' : 'time-bad';
    const stayCls = v => v <= CONFIG.ANAHP.stayTarget ? 'time-good' : v <= 300 ? 'time-warn' : 'time-bad';

    return `<table class="data-table scorecard-table">
      <thead>
        <tr>
          <th class="sc-ind">Indicador</th>
          ${monthlyStats.map(s => `<th class="num">${s.name}</th>`).join('')}
          <th class="num sc-tot">Período</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <td class="sc-ind"><strong>Tempo Médio Espera</strong></td>
          ${monthlyStats.map(s => s.avgWait !== null ? `<td class="num ${waitCls(s.avgWait)}">${U.fmtMinShort(s.avgWait)}</td>` : '<td class="num">—</td>').join('')}
          <td class="num ${waitCls(kpis.avgWait)}"><strong>${U.fmtMinShort(kpis.avgWait)}</strong></td>
        </tr>
        <tr>
          <td class="sc-ind"><strong>Conform. (&le; 30m)</strong></td>
          ${monthlyStats.map(s => `<td class="num ${compCls(s.compliance)}">${s.compliance.toFixed(1)}%</td>`).join('')}
          <td class="num ${compCls(kpis.compliance)}"><strong>${kpis.compliance.toFixed(1)}%</strong></td>
        </tr>
        <tr>
          <td class="sc-ind"><strong>Permanência Média</strong></td>
          ${monthlyStats.map(s => s.avgStay !== null ? `<td class="num ${stayCls(s.avgStay)}">${U.fmtMinShort(s.avgStay)}</td>` : '<td class="num">—</td>').join('')}
          <td class="num ${stayCls(kpis.avgStay)}"><strong>${U.fmtMinShort(kpis.avgStay)}</strong></td>
        </tr>
        <tr>
          <td class="sc-ind"><strong>Atendimentos</strong></td>
          ${monthlyStats.map(s => `<td class="num">${s.volume.toLocaleString('pt-BR')}</td>`).join('')}
          <td class="num"><strong>${kpis.total.toLocaleString('pt-BR')}</strong></td>
        </tr>
      </tbody>
    </table>`;
  },

  buildDistributionTable(data) {
    const vals = data.filter(d => d.waitTime !== null).map(d => d.waitTime);
    if (!vals.length) return '<p class="empty-msg">Sem dados de espera.</p>';
    const BIN = 10, MAX = 130;
    const bins = [];
    for (let i = 0; i < MAX; i += BIN) bins.push({ label: i >= MAX - BIN ? `Mais de ${U.fmtMin(i)}` : `${U.fmtMin(i)} a ${U.fmtMin(i + BIN)}`, min: i, count: 0 });
    vals.forEach(v => { const idx = Math.min(Math.floor(v / BIN), bins.length - 1); if (idx >= 0) bins[idx].count++; });
    const total = vals.length;

    let html = `<table class="data-table">
      <colgroup><col style="width:46%"><col style="width:27%"><col style="width:27%"></colgroup>
      <thead><tr><th>Faixa de Espera</th><th class="num">Pacientes</th><th class="num">% Represent.</th></tr></thead>
      <tbody>`;
    bins.forEach(b => {
      const pct = +(b.count / total * 100).toFixed(1);
      const cls = b.min < 30 ? 'time-good' : b.min < 60 ? 'time-warn' : 'time-bad';
      html += `<tr><td><strong>${b.label}</strong></td><td class="num">${b.count.toLocaleString('pt-BR')}</td><td class="num ${cls}">${pct.toFixed(1)}%</td></tr>`;
    });
    html += '</tbody></table>';
    return html;
  },

  buildSpecialtyTable(kpis) {
    const stats = kpis.specialtyStats;
    if (!stats.length) return '<p class="empty-msg">Sem dados de especialidades.</p>';

    let html = `<table class="data-table fixed-table">
      <colgroup>
        <col style="width:46%">
        <col style="width:18%">
        <col style="width:18%">
        <col style="width:18%">
      </colgroup>
      <thead>
        <tr>
          <th>Especialidade</th>
          <th class="num">Volume</th>
          <th class="num">Tempo Médio</th>
          <th class="num">Conform.</th>
        </tr>
      </thead>
      <tbody>`;
    stats.forEach(s => {
      const cls = s.avg <= 30 ? 'time-good' : s.avg <= 40 ? 'time-warn' : 'time-bad';
      const cCls = s.compliance >= 80 ? 'time-good' : s.compliance >= 60 ? 'time-warn' : 'time-bad';
      html += `<tr>
        <td class="spec-cell"><strong>${s.name}</strong></td>
        <td class="num">${s.count.toLocaleString('pt-BR')}</td>
        <td class="num ${cls}">${U.fmtMin(s.avg)}</td>
        <td class="num ${cCls}">${s.compliance.toFixed(1)}%</td>
      </tr>`;
    });
    html += '</tbody></table>';
    return html;
  },

  buildWorstDaysTable(data) {
    const worst = KPI.worstDays(data, 10);
    if (!worst.length) return '<p class="empty-msg">Sem dados de dias críticos.</p>';

    let html = `<table class="data-table fixed-table">
      <colgroup>
        <col style="width:8%">
        <col style="width:20%">
        <col style="width:12%">
        <col style="width:22%">
        <col style="width:18%">
        <col style="width:20%">
      </colgroup>
      <thead>
        <tr>
          <th>#</th>
          <th>Data</th>
          <th>Dia</th>
          <th class="num">Média</th>
          <th class="num">Volume</th>
          <th class="num">Conform.</th>
        </tr>
      </thead>
      <tbody>`;
    worst.forEach((d, i) => {
      const avg = Math.round(d.avg);
      const cls = avg > CONFIG.ANAHP.waitTarget * 2 ? 'time-bad' : avg > CONFIG.ANAHP.waitTarget ? 'time-warn' : 'time-good';
      const row = avg > CONFIG.ANAHP.waitTarget * 2 ? 'row-critical' : avg > CONFIG.ANAHP.waitTarget ? 'row-warning' : '';
      const cCls = d.compliance >= 80 ? 'time-good' : d.compliance >= 60 ? 'time-warn' : 'time-bad';
      html += `<tr class="${row}">
        <td class="rank-cell">${i + 1}&ordm;</td>
        <td>${U.fmtDate(d.date)}</td>
        <td>${d.dow}</td>
        <td class="num ${cls}">${U.fmtMin(d.avg)}</td>
        <td class="num">${d.volume.toLocaleString('pt-BR')}</td>
        <td class="num ${cCls}">${d.compliance.toFixed(1)}%</td>
      </tr>`;
    });
    html += '</tbody></table>';
    return html;
  },

  buildAnomalyTable(data) {
    const anom = KPI.anomalies(data, 2);
    if (!anom.length) {
      return '<p class="empty-msg">Nenhum dia fora do padrão registrado neste período.</p>';
    }

    let html = `<table class="data-table fixed-table">
      <colgroup>
        <col style="width:22%">
        <col style="width:12%">
        <col style="width:24%">
        <col style="width:22%">
        <col style="width:20%">
      </colgroup>
      <thead>
        <tr>
          <th>Data</th>
          <th>Dia</th>
          <th class="num">Média</th>
          <th class="num">Desvio</th>
          <th class="num">Volume</th>
        </tr>
      </thead>
      <tbody>`;
    anom.forEach(d => {
      const cls = d.z > 3 ? 'time-bad' : 'time-warn';
      const row = d.z > 3 ? 'row-critical' : 'row-warning';
      html += `<tr class="${row}">
        <td>${U.fmtDate(d.date)}</td>
        <td>${d.dow}</td>
        <td class="num ${cls}">${U.fmtMin(d.avg)}</td>
        <td class="num muted">+${d.z.toFixed(2)}&sigma;</td>
        <td class="num">${d.volume.toLocaleString('pt-BR')}</td>
      </tr>`;
    });
    html += '</tbody></table>';
    return html;
  },

  buildCapacityTable(data) {
    const factor = parseFloat(document.getElementById('capacitySeasonFactor')?.value || '1.0');
    const cap = KPI.capacity(data);
    const computed = {};
    CONFIG.WEEKDAYS.forEach(d => {
      computed[d] = {};
      CONFIG.SHIFTS.forEach(s => {
        computed[d][s.label] = Math.round((cap[d]?.[s.label] || 0) * factor);
      });
    });
    const allVals = CONFIG.WEEKDAYS.flatMap(d => CONFIG.SHIFTS.map(s => computed[d][s.label]));
    const mx = Math.max(...allVals) || 1;

    let html = `<table class="data-table fixed-table">
      <colgroup><col style="width:22%"><col style="width:26%"><col style="width:26%"><col style="width:26%"></colgroup>
      <thead><tr><th>Dia</th>${CONFIG.SHIFTS.map(s => `<th class="num">${s.label}</th>`).join('')}</tr></thead>
      <tbody>`;
    CONFIG.WEEKDAYS.filter(d => cap[d]).forEach(d => {
      html += `<tr><td><strong>${d}</strong></td>`;
      CONFIG.SHIFTS.forEach(s => {
        const v = computed[d][s.label];
        const r = v / mx;
        const cls = r < 0.4 ? 'cap-low' : r < 0.7 ? 'cap-med' : 'cap-high';
        html += `<td class="num"><span class="cap-pill ${cls}">${v}</span></td>`;
      });
      html += '</tr>';
    });
    html += '</tbody></table>';
    return html;
  },

  buildMonthlyNarrative(kpis, data) {
    const parts = [];
    const totalInMonth = (m) => data ? data.filter(d => d.month === m).length : 0;
    if (kpis.worstMonth && kpis.bestMonth && kpis.worstMonth.month !== kpis.bestMonth.month) {
      const worstTotal = totalInMonth(kpis.worstMonth.month) || kpis.worstMonth.count;
      parts.push(
        `No período filtrado, o maior tempo médio de espera ocorreu em <strong>${kpis.worstMonth.name}</strong> (${U.fmtMin(kpis.worstMonth.avg)}, conformidade de ${kpis.worstMonth.compliance.toFixed(1)}% em ${worstTotal.toLocaleString('pt-BR')} atendimentos), enquanto o melhor desempenho foi registrado em <strong>${kpis.bestMonth.name}</strong> (${U.fmtMin(kpis.bestMonth.avg)}, conformidade de ${kpis.bestMonth.compliance.toFixed(1)}%).`
      );
    } else if (kpis.bestMonth) {
      const bestTotal = totalInMonth(kpis.bestMonth.month) || kpis.bestMonth.count;
      parts.push(
        `No mês de <strong>${kpis.bestMonth.name}</strong>, o tempo médio de espera foi de <strong>${U.fmtMin(kpis.bestMonth.avg)}</strong> com conformidade de <strong>${kpis.bestMonth.compliance.toFixed(1)}%</strong> em ${bestTotal.toLocaleString('pt-BR')} atendimentos.`
      );
    }

    const metaStatus = `A conformidade acumulada no período registrou <strong>${kpis.compliance.toFixed(1)}%</strong> dos atendimentos com tempo de espera até 30 minutos.`;
    parts.push(metaStatus);
    return parts;
  },

  buildSummaryCards(kpis, data) {
    const items = [];
    const statusType = kpis.avgWait <= CONFIG.ANAHP.waitTarget ? 'good' : kpis.avgWait <= 40 ? 'warn' : 'bad';
    items.push({
      title: 'Status Geral do Período',
      type: statusType,
      body: `Tempo médio de espera: <strong>${U.fmtMin(kpis.avgWait)}</strong>. Conformidade: <strong>${kpis.compliance.toFixed(1)}%</strong>.`
    });
    if (kpis.bestMonth) {
      items.push({
        title: 'Melhor Desempenho Mensal',
        type: 'good',
        body: `<strong>${kpis.bestMonth.name}</strong> apresentou o menor tempo médio (<strong>${U.fmtMin(kpis.bestMonth.avg)}</strong>) e conformidade de <strong>${kpis.bestMonth.compliance.toFixed(1)}%</strong>.`
      });
    }
    if (kpis.worstMonth && kpis.worstMonth.month !== kpis.bestMonth?.month) {
      items.push({
        title: 'Mês Mais Crítico',
        type: kpis.worstMonth.avg > 45 ? 'bad' : 'warn',
        body: `<strong>${kpis.worstMonth.name}</strong> registrou o maior tempo médio: <strong>${U.fmtMin(kpis.worstMonth.avg)}</strong> e conformidade de <strong>${kpis.worstMonth.compliance.toFixed(1)}%</strong>.`
      });
    }
    if (kpis.specialtyStats.length) {
      const relevant = kpis.specialtyStats.filter(s => s.count >= 10);
      const pool = relevant.length >= 2 ? relevant : kpis.specialtyStats;
      const ws = [...pool].sort((a, b) => b.avg - a.avg || b.count - a.count)[0];
      const bs = [...pool].sort((a, b) => a.avg - b.avg || b.compliance - a.compliance || b.count - a.count)[0];
      if (ws) {
        const ratio = ws.avg / CONFIG.ANAHP.waitTarget;
        const pctOver = ((ratio - 1) * 100).toFixed(0);
        const diffTxt = ws.avg <= CONFIG.ANAHP.waitTarget
          ? ' (dentro da meta)'
          : ratio >= 3
            ? ` (${ratio.toFixed(1).replace('.', ',')}&times; acima da meta)`
            : ` — <strong>${pctOver}%</strong> acima da meta`;
        items.push({
          title: 'Especialidade Crítica',
          type: ws.avg > CONFIG.ANAHP.waitTarget ? 'bad' : 'warn',
          body: `<strong>${ws.name}</strong> teve a maior espera média: <strong>${U.fmtMin(ws.avg)}</strong>${diffTxt} (${ws.count.toLocaleString('pt-BR')} atendimentos).`
        });
      }
      if (bs && (!ws || bs.name !== ws.name)) {
        items.push({
          title: 'Especialidade Destaque',
          type: 'good',
          body: `<strong>${bs.name}</strong> manteve o menor tempo médio: <strong>${U.fmtMin(bs.avg)}</strong> com conformidade de <strong>${bs.compliance.toFixed(1)}%</strong> (${bs.count.toLocaleString('pt-BR')} atendimentos).`
        });
      }
    }
    if (kpis.peakHour !== null) {
      items.push({
        title: 'Horário de Pico',
        type: 'warn',
        body: `Maior volume de chegadas às <strong>${String(kpis.peakHour).padStart(2, '0')}h</strong> (${kpis.peakVol.toLocaleString('pt-BR')} atendimentos no período).`
      });
    }
    const anom = KPI.anomalies(data);
    items.push(anom.length ? {
      title: 'Dias Fora do Padrão',
      type: 'bad',
      body: `<strong>${anom.length}</strong> ${anom.length > 1 ? 'dias' : 'dia'} com pico atípico de espera. Data mais crítica: <strong>${U.fmtDate(anom[0].date)}</strong> (${U.fmtMin(anom[0].avg)}, +${anom[0].z.toFixed(2)}&sigma;).`
    } : {
      title: 'Estabilidade Operacional',
      type: 'good',
      body: 'Nenhum dia fora do padrão registrado no período — fluxo operacional estável.'
    });

    return items.map(i => `<div class="summary-item summary-${i.type}"><div class="si-title">${i.title}</div><div class="si-body">${i.body}</div></div>`).join('');
  },

  export() {
    const currentData = State.filtered || State.data;
    if (!currentData || !currentData.length) {
      UI.toast('Nenhum dado carregado para exportar.', 'error');
      return;
    }

    UI.loading(true, 'Preparando relatório A4 para impressão...');

    setTimeout(() => {
      try {
        const kpis = KPI.calc(currentData);
        const oee = KPI.oee(kpis);
        const baseKpis = State.baseData ? KPI.calc(State.baseData) : null;
        const daily = KPI.dailyEvolution(currentData);

        const oeeGaugeImg = PrintCharts.oeeGauge(oee.score);
        const sectorTimesImg = PrintCharts.sectorTimes(kpis);
        const convenioWaitImg = PrintCharts.convenioWait(kpis);
        const monthlyImg = PrintCharts.monthly(kpis, baseKpis);
        const dailyImg = PrintCharts.daily(daily);
        const weekdayImg = PrintCharts.weekday(currentData);
        const distributionImg = PrintCharts.distribution(currentData);
        const paretoImg = PrintCharts.pareto(kpis);

        const periodClean = this.buildPeriodInfo(currentData, kpis);
        const filterLabel = this.buildFilterLabel();
        const issuedAt = `${new Date().toLocaleDateString('pt-BR')} às ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
        const seasonText = document.getElementById('capacitySeasonFactor')?.options[document.getElementById('capacitySeasonFactor')?.selectedIndex]?.text || 'Cenário: Normal (1.0x)';

        const scorecardHTML = this.buildScorecardTable(kpis, currentData);
        const destinationTableHTML = this.buildDestinationTable(kpis);
        const convenioTableHTML = this.buildConvenioTable(kpis);
        const distributionTableHTML = this.buildDistributionTable(currentData);
        const specialtyTableHTML = this.buildSpecialtyTable(kpis);
        const worstDaysTableHTML = this.buildWorstDaysTable(currentData);
        const capacityTableHTML = this.buildCapacityTable(currentData);
        const anomalyTableHTML = this.buildAnomalyTable(currentData);
        const summaryCardsHTML = this.buildSummaryCards(kpis, currentData);
        const narrativeParts = this.buildMonthlyNarrative(kpis, currentData);

        const win = window.open('', '_blank');
        if (!win) {
          UI.toast('Bloqueador de popups detectado! Ative popups para este site.', 'error');
          UI.loading(false);
          return;
        }

        win.document.write(`<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="utf-8">
  <title>Hospital São Carlos — Indicadores de Tempo e Fluxo — Pronto Socorro</title>
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    @page {
      size: A4 portrait;
      margin: 14mm 14mm 17mm 14mm;
      @bottom-left {
        content: "Hospital São Carlos · VitalFlow PS";
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 8pt;
        color: #64748B;
        border-top: 0.75pt solid #CBD5E1;
        padding-top: 5pt;
        vertical-align: top;
        white-space: nowrap;
      }
      @bottom-center {
        content: "";
        border-top: 0.75pt solid #CBD5E1;
        padding-top: 5pt;
      }
      @bottom-right {
        content: "Página " counter(page) " de " counter(pages);
        font-family: 'Inter', -apple-system, BlinkMacSystemFont, sans-serif;
        font-size: 8pt;
        font-weight: 600;
        color: #475569;
        border-top: 0.75pt solid #CBD5E1;
        padding-top: 5pt;
        vertical-align: top;
        white-space: nowrap;
      }
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }

    body {
      font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Helvetica Neue', Arial, sans-serif;
      color: #0F172A;
      background: #FFFFFF;
      font-size: 9.5pt;
      line-height: 1.42;
    }

    .doc-shell {
      width: 100%;
      max-width: 182mm;
      margin: 0 auto;
      background: #FFFFFF;
    }

    /* Institutional Header (Page 1, no cover page) */
    .doc-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: 9pt;
      margin-bottom: 12pt;
      border-bottom: 2px solid #0F2942;
      gap: 10pt;
    }
    .doc-brand {
      display: flex;
      align-items: center;
      gap: 9pt;
      min-width: 0;
    }
    .doc-logo {
      width: 30pt;
      height: 30pt;
      background: #0F2942;
      border-radius: 5pt;
      display: flex;
      align-items: center;
      justify-content: center;
      flex-shrink: 0;
    }
    .doc-title {
      font-size: 12.5pt;
      font-weight: 800;
      color: #0F2942;
      letter-spacing: -0.3px;
      line-height: 1.2;
      white-space: nowrap;
    }
    .doc-institution {
      font-size: 9.5pt;
      font-weight: 600;
      color: #475569;
      margin-top: 2pt;
    }
    .doc-meta {
      text-align: right;
      font-size: 8.5pt;
      color: #475569;
      line-height: 1.45;
      font-variant-numeric: tabular-nums;
      flex-shrink: 0;
    }
    .doc-meta strong { color: #0F172A; font-weight: 700; }

    /* Sections */
    .section {
      margin-bottom: 14pt;
    }
    .page-break {
      page-break-before: always;
      break-before: page;
    }
    .section-head {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      border-bottom: 1px solid #CBD5E1;
      padding-bottom: 4pt;
      margin-bottom: 9pt;
      break-after: avoid;
      page-break-after: avoid;
    }
    .section-head h2 {
      font-size: 11pt;
      font-weight: 800;
      color: #0F2942;
      letter-spacing: -0.2px;
    }
    .section-head span {
      font-size: 8pt;
      color: #64748B;
      font-weight: 600;
    }

    /* OEE Block */
    .oee-block {
      display: flex;
      align-items: center;
      gap: 16pt;
      border: 1px solid #E2E8F0;
      border-radius: 6pt;
      padding: 10pt 14pt 10pt 17pt;
      margin-bottom: 11pt;
      position: relative;
      overflow: hidden;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .oee-block::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 0;
      width: 4pt;
      background: #0F2942;
    }
    .oee-gauge-box {
      width: 110pt;
      text-align: center;
      flex-shrink: 0;
    }
    .oee-gauge-box img {
      width: 104pt;
      height: auto;
      display: block;
      margin: 0 auto;
    }
    .oee-score-line {
      margin-top: -12pt;
      font-variant-numeric: tabular-nums;
    }
    .oee-score-num {
      font-size: 18pt;
      font-weight: 800;
      color: ${oee.score >= 70 ? '#0F2942' : oee.score >= 55 ? '#B45309' : '#9B1C1C'};
    }
    .oee-score-unit { font-size: 8.5pt; color: #64748B; font-weight: 600; }
    .oee-details { flex: 1; min-width: 0; }
    .oee-top-row {
      display: flex;
      align-items: center;
      gap: 8pt;
    }
    .oee-title {
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.4px;
      color: #475569;
    }
    .oee-badge {
      font-size: 8.5pt;
      font-weight: 800;
      padding: 2pt 8pt;
      border-radius: 4pt;
      border: 1px solid #CBD5E1;
      background: #F8FAFC;
      color: #0F2942;
    }

    /* KPI Grids (4x2 principal + 3x1 / 4x1 fluxo) */
    .kpi-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 7pt;
      margin-bottom: 11pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .kpi-grid-3 {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 7pt;
      margin-bottom: 8pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .kpi-grid-4 {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 7pt;
      margin-bottom: 10pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .kpi-box {
      position: relative;
      overflow: hidden;
      border: 1px solid #E2E8F0;
      border-radius: 5pt;
      padding: 7pt 9pt 7pt 12pt;
      background: #FFFFFF;
    }
    .kpi-box::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 0;
      width: 3pt;
      background: #0F2942;
    }
    .kpi-box.status-good::before { background: #166534; }
    .kpi-box.status-warn::before { background: #B45309; }
    .kpi-box.status-bad::before  { background: #9B1C1C; }
    .kpi-label {
      font-size: 6.9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.3px;
      color: #475569;
      margin-bottom: 3pt;
    }
    .kpi-val {
      font-size: 13.5pt;
      font-weight: 800;
      color: #0F172A;
      font-variant-numeric: tabular-nums;
      line-height: 1.15;
    }
    .kpi-meta {
      font-size: 7.2pt;
      color: #64748B;
      margin-top: 2pt;
      font-variant-numeric: tabular-nums;
    }

    /* Editorial Cards & Charts */
    .card {
      border: 1px solid #E2E8F0;
      border-radius: 5pt;
      padding: 9pt 11pt;
      background: #FFFFFF;
      margin-bottom: 10pt;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .card-flow {
      border: 1px solid #E2E8F0;
      border-radius: 5pt;
      padding: 9pt 11pt;
      background: #FFFFFF;
      margin-bottom: 10pt;
    }
    .card h3, .card-flow h3 {
      font-size: 9pt;
      font-weight: 700;
      color: #0F2942;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      border-bottom: 1px solid #E2E8F0;
      padding-bottom: 4pt;
      margin-bottom: 7pt;
      break-after: avoid;
      page-break-after: avoid;
    }
    .chart-img {
      width: 100%;
      max-height: 76mm;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .chart-img-sm {
      width: 100%;
      max-height: 58mm;
      object-fit: contain;
      display: block;
      margin: 0 auto;
    }
    .narrative-box {
      border-left: 3pt solid #3B6E8C;
      background: #F8FAFC;
      padding: 7pt 10pt;
      margin-top: 8pt;
      font-size: 8.5pt;
      color: #334155;
      line-height: 1.48;
      break-inside: avoid;
    }
    .narrative-box p + p { margin-top: 4pt; }
    .narrative-box strong { color: #0F172A; }

    /* Tables */
    .data-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 8.2pt;
      color: #0F172A;
    }
    .fixed-table { table-layout: fixed; }
    .data-table thead { display: table-header-group; }
    .data-table tr {
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .data-table th {
      background: #F8FAFC;
      color: #475569;
      font-size: 7.3pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.35px;
      padding: 5pt 6pt;
      border-top: 1px solid #CBD5E1;
      border-bottom: 1px solid #CBD5E1;
      text-align: left;
      white-space: nowrap;
    }
    .data-table td {
      padding: 4.5pt 6pt;
      border-bottom: 0.75pt solid #E2E8F0;
      vertical-align: middle;
      text-align: left;
    }
    .data-table th.num,
    .data-table td.num {
      text-align: right;
      font-variant-numeric: tabular-nums;
      white-space: nowrap;
    }
    .scorecard-table {
      table-layout: auto;
      font-size: 7.2pt;
    }
    .scorecard-table th,
    .scorecard-table td {
      padding: 4pt 3.5pt;
    }
    .scorecard-table th {
      font-size: 6.7pt;
      letter-spacing: 0.2px;
    }
    .scorecard-table .sc-ind {
      width: 19%;
      white-space: nowrap;
    }
    .scorecard-table .sc-meta {
      width: 9%;
    }
    .scorecard-table .sc-tot {
      background: #F1F5F9;
    }
    .spec-cell {
      word-break: break-word;
      overflow-wrap: anywhere;
    }
    .muted { color: #64748B; }
    .rank-cell { font-weight: 700; color: #0F2942; font-variant-numeric: tabular-nums; }
    .time-good { color: #166534; font-weight: 700; }
    .time-warn { color: #B45309; font-weight: 700; }
    .time-bad  { color: #9B1C1C; font-weight: 700; }
    tr.row-critical td { background: #FEF2F2; }
    tr.row-warning td  { background: #FFFBEB; }

    .cap-pill {
      display: inline-block;
      min-width: 28pt;
      text-align: right;
      padding: 1.5pt 5pt;
      border-radius: 3pt;
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    .cap-low  { background: #F0FDF4; color: #166534; border: 0.5pt solid #BBF7D0; }
    .cap-med  { background: #FFFBEB; color: #B45309; border: 0.5pt solid #FDE68A; }
    .cap-high { background: #FEF2F2; color: #9B1C1C; border: 0.5pt solid #FECACA; }

    .footnote {
      font-size: 7.5pt;
      color: #64748B;
      margin-top: 5pt;
    }
    .empty-msg {
      padding: 10pt;
      text-align: center;
      color: #64748B;
      font-size: 8.5pt;
    }

    /* Summary Grid */
    .summary-grid {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 7pt;
    }
    .summary-item {
      position: relative;
      overflow: hidden;
      border: 1px solid #E2E8F0;
      border-radius: 4pt;
      padding: 6.5pt 9pt 6.5pt 11pt;
      background: #FFFFFF;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .summary-item::before {
      content: '';
      position: absolute;
      top: 0; bottom: 0; left: 0;
      width: 3pt;
      background: #0F2942;
    }
    .summary-good::before { background: #166534; }
    .summary-warn::before { background: #B45309; }
    .summary-bad::before  { background: #9B1C1C; }
    .si-title {
      font-size: 8pt;
      font-weight: 700;
      color: #0F2942;
      margin-bottom: 2pt;
    }
    .si-body {
      font-size: 8pt;
      color: #334155;
      line-height: 1.38;
    }
    .si-body strong { color: #0F172A; }

    .preview-bar { display: none; }

    @media screen {
      body { background: #E2E8F0; padding: 18mm 12px 18mm; }
      .preview-bar {
        display: flex;
        align-items: center;
        justify-content: space-between;
        position: fixed;
        top: 0; left: 0; right: 0;
        height: 44px;
        padding: 0 20px;
        background: #0F2942;
        color: #FFFFFF;
        font-size: 12.5px;
        font-weight: 600;
        box-shadow: 0 2px 10px rgba(15, 41, 66, 0.2);
        z-index: 9999;
      }
      .preview-bar-actions { display: flex; gap: 8px; }
      .preview-btn {
        border: none;
        border-radius: 5px;
        padding: 6px 14px;
        font-size: 12px;
        font-weight: 700;
        cursor: pointer;
        font-family: inherit;
      }
      .preview-btn-primary { background: #FFFFFF; color: #0F2942; }
      .preview-btn-primary:hover { background: #F1F5F9; }
      .preview-btn-secondary { background: rgba(255,255,255,0.14); color: #FFFFFF; }
      .preview-btn-secondary:hover { background: rgba(255,255,255,0.24); }
      .doc-shell {
        background: #FFFFFF;
        padding: 15mm;
        border: 1px solid #CBD5E1;
        border-radius: 6px;
        box-shadow: 0 8px 30px rgba(15, 41, 66, 0.12);
      }
      .page-break {
        border-top: 2px dashed #CBD5E1;
        padding-top: 14pt;
        margin-top: 18pt;
      }
    }
  </style>
</head>
<body>
<div class="preview-bar">
  <span>Pré-visualização A4 — Hospital São Carlos · VitalFlow PS</span>
  <div class="preview-bar-actions">
    <button class="preview-btn preview-btn-primary" onclick="window.print()">Imprimir / Salvar PDF</button>
    <button class="preview-btn preview-btn-secondary" onclick="window.close()">Fechar</button>
  </div>
</div>
<div class="doc-shell">

  <!-- ==================== PÁGINA 1: CABEÇALHO + OEE + 8 KPIS + SCORECARD ==================== -->
  <header class="doc-header">
    <div class="doc-brand">
      <div class="doc-logo">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
          <path d="M3 12h3l3-9 4 18 3-12h5" stroke="#FFFFFF" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      </div>
      <div>
        <div class="doc-title">Indicadores de Tempo e Fluxo — Pronto Socorro</div>
        <div class="doc-institution">Hospital São Carlos</div>
      </div>
    </div>
    <div class="doc-meta">
      <div><strong>Período:</strong> ${periodClean}</div>
      <div><strong>Recorte:</strong> ${filterLabel}</div>
      <div><strong>Volume:</strong> ${kpis.total.toLocaleString('pt-BR')} atendimentos · <strong>Emissão:</strong> ${issuedAt}</div>
    </div>
  </header>

  <section class="section">
    <div class="oee-block">
      <div class="oee-gauge-box">
        <img src="${oeeGaugeImg}" alt="Eficiência Operacional">
        <div class="oee-score-line">
          <span class="oee-score-num">${oee.score.toFixed(1)}</span>
          <span class="oee-score-unit">/100</span>
        </div>
      </div>
      <div class="oee-details">
        <div class="oee-top-row">
          <span class="oee-title">Eficiência Operacional</span>
          <span class="oee-badge">Classe ${oee.cls}</span>
        </div>
      </div>
    </div>

    <div class="kpi-grid">
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Ficha &rarr; Triagem</div>
        <div class="kpi-val">${kpis.avgTriageWait !== null ? U.fmtMin(kpis.avgTriageWait) : '—'}</div>
        <div class="kpi-meta">Média Recepção</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Triagem &rarr; Médico</div>
        <div class="kpi-val">${kpis.avgTriageToDocWait !== null ? U.fmtMin(kpis.avgTriageToDocWait) : '—'}</div>
        <div class="kpi-meta">Média Espera Médica</div>
      </div>
      <div class="kpi-box status-${kpis.avgWait <= 30 ? 'good' : kpis.avgWait <= 40 ? 'warn' : 'bad'}">
        <div class="kpi-label">Ficha &rarr; Médico</div>
        <div class="kpi-val">${U.fmtMin(kpis.avgWait)}</div>
      </div>
      <div class="kpi-box status-${kpis.compliance >= 80 ? 'good' : kpis.compliance >= 70 ? 'warn' : 'bad'}">
        <div class="kpi-label">Conformidade (&le; 30m)</div>
        <div class="kpi-val">${kpis.compliance.toFixed(1)}%</div>
      </div>
      <div class="kpi-box status-${kpis.avgStay <= 240 ? 'good' : kpis.avgStay <= 300 ? 'warn' : 'bad'}">
        <div class="kpi-label">Permanência Total</div>
        <div class="kpi-val">${U.fmtMin(kpis.avgStay)}</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Total Atendimentos</div>
        <div class="kpi-val">${kpis.total.toLocaleString('pt-BR')}</div>
        <div class="kpi-meta">Média: ${kpis.avgDaily.toLocaleString('pt-BR')}/dia</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Horário de Pico</div>
        <div class="kpi-val">${kpis.peakHour !== null ? String(kpis.peakHour).padStart(2, '0') + ':00h' : '—'}</div>
        <div class="kpi-meta">${kpis.peakVol.toLocaleString('pt-BR')} atendimentos</div>
      </div>
      <div class="kpi-box status-good">
        <div class="kpi-label">Melhor Mês</div>
        <div class="kpi-val">${kpis.bestMonth ? CONFIG.MONTHS_SHORT[kpis.bestMonth.month - 1] : '—'}</div>
        <div class="kpi-meta">Média: ${kpis.bestMonth ? U.fmtMin(kpis.bestMonth.avg) : '—'}</div>
      </div>
    </div>

    <div class="card">
      <h3>1. Evolução Mensal de Indicadores</h3>
      ${scorecardHTML}
    </div>
  </section>

  <!-- ==================== SEÇÃO 2: FLUXO ASSISTENCIAL POR SETOR & DESFECHOS ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>2. Fluxo Assistencial por Setor e Desfechos</h2>
      <span>Tempos por setor clínico e desfechos de atendimento</span>
    </div>

    <div class="kpi-grid-3">
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Tempo Médio Sala Vermelha</div>
        <div class="kpi-val">${kpis.avgSalaV !== null ? U.fmtMin(kpis.avgSalaV) : '—'}</div>
        <div class="kpi-meta">${kpis.salaVCount > 0 ? kpis.salaVCount.toLocaleString('pt-BR') + ' casos' : 'Sem dados'}</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Tempo Médio Soroterapia</div>
        <div class="kpi-val">${kpis.avgSorot !== null ? U.fmtMin(kpis.avgSorot) : '—'}</div>
        <div class="kpi-meta">${kpis.sorotCount > 0 ? kpis.sorotCount.toLocaleString('pt-BR') + ' casos' : 'Sem dados'}</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Tempo Médio Sutura</div>
        <div class="kpi-val">${kpis.avgSutura !== null ? U.fmtMin(kpis.avgSutura) : '—'}</div>
        <div class="kpi-meta">${kpis.suturaCount > 0 ? kpis.suturaCount.toLocaleString('pt-BR') + ' casos' : 'Sem dados'}</div>
      </div>
    </div>

    <div class="kpi-grid-4">
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Taxa de Internação</div>
        <div class="kpi-val">${kpis.internRate !== null ? kpis.internRate + '%' : '—'}</div>
        <div class="kpi-meta">Pacientes internados</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Taxa de Evasão</div>
        <div class="kpi-val">${kpis.evasionRate !== null ? kpis.evasionRate + '%' : '—'}</div>
        <div class="kpi-meta">Desistência de atendimento</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Alta Domiciliar</div>
        <div class="kpi-val">${kpis.homeRate !== null ? kpis.homeRate + '%' : '—'}</div>
        <div class="kpi-meta">Pacientes com alta</div>
      </div>
      <div class="kpi-box status-neutral">
        <div class="kpi-label">Taxa de Mortalidade PS</div>
        <div class="kpi-val">${kpis.deathRate !== null ? kpis.deathRate + '%' : '—'}</div>
        <div class="kpi-meta">Óbitos no setor</div>
      </div>
    </div>

    ${sectorTimesImg ? `<div class="card">
      <h3>Tempos Médios por Setor Clínico</h3>
      <img src="${sectorTimesImg}" class="chart-img-sm" alt="Tempos por Setor Clínico">
    </div>` : ''}

    <div class="card">
      <h3>Distribuição de Desfechos do Atendimento</h3>
      ${destinationTableHTML}
    </div>
  </section>

  <!-- ==================== SEÇÃO 3: DESEMPENHO POR CONVÊNIO / OPERADORA ==================== -->
  ${kpis.convenioStats?.length ? `<section class="section page-break">
    <div class="section-head">
      <h2>3. Desempenho por Convênio / Operadora</h2>
      <span>${kpis.convenioStats.length} ${kpis.convenioStats.length === 1 ? 'operadora' : 'operadoras'} no recorte</span>
    </div>
    ${convenioWaitImg ? `<div class="card">
      <h3>Espera Média por Operadora (Ficha &rarr; Médico)</h3>
      <img src="${convenioWaitImg}" class="chart-img-sm" alt="Espera Média por Convênio">
    </div>` : ''}
    <div class="card-flow">
      <h3>Ranking Comparativo por Convênio / Operadora</h3>
      ${convenioTableHTML}
    </div>
  </section>` : ''}

  <!-- ==================== SEÇÃO 4: TENDÊNCIA MENSAL ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>4. Tendência Mensal de Espera e Conformidade</h2>
      <span>${periodClean}</span>
    </div>
    <div class="card">
      <img src="${monthlyImg}" class="chart-img" alt="Tendência Mensal">
      <div class="narrative-box">
        ${narrativeParts.map(p => `<p>${p}</p>`).join('')}
      </div>
    </div>
  </section>

  <!-- ==================== SEÇÃO 5: EVOLUÇÃO DIÁRIA & TOP 10 DIAS CRÍTICOS ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>5. Evolução Diária e Top 10 Dias Críticos</h2>
      <span>Volume diário e espera média (média móvel 7 dias)</span>
    </div>
    <div class="card">
      <img src="${dailyImg}" class="chart-img" alt="Evolução Diária">
    </div>
    <div class="card">
      <h3>Top 10 Dias com Maior Tempo Médio de Espera</h3>
      ${worstDaysTableHTML}
    </div>
  </section>

  <!-- ==================== SEÇÃO 6: DISTRIBUIÇÃO ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>6. Distribuição dos Tempos de Espera</h2>
      <span>Percentual de atendimentos por faixa de espera</span>
    </div>
    <div class="card">
      <img src="${distributionImg}" class="chart-img" alt="Distribuição dos Tempos de Espera">
    </div>
    <div class="card">
      <h3>Tabela de Faixas de Espera</h3>
      ${distributionTableHTML}
    </div>
  </section>

  <!-- ==================== SEÇÃO 7: GARGALOS & ESPECIALIDADES ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>7. Gargalos Operacionais (80/20) e Especialidades</h2>
      <span>Concentração de horas acumuladas de espera</span>
    </div>
    <div class="card">
      <img src="${paretoImg}" class="chart-img" alt="Gargalos Operacionais (80/20)">
    </div>
    <div class="card-flow">
      <h3>Performance e Métricas por Especialidade</h3>
      ${specialtyTableHTML}
    </div>
  </section>

  <!-- ==================== SEÇÃO 8: CAPACIDADE & TURNOS ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>8. Demanda por Dia da Semana e Dimensionamento por Turno</h2>
      <span>${seasonText}</span>
    </div>
    <div class="card">
      <img src="${weekdayImg}" class="chart-img" alt="Demanda por Dia da Semana">
    </div>
    <div class="card">
      <h3>Grade de Dimensionamento por Turno (Média Diária Esperada)</h3>
      ${capacityTableHTML}
      <p class="footnote">Valores calculados conforme o multiplicador sazonal selecionado no painel (${seasonText}).</p>
    </div>
  </section>

  <!-- ==================== SEÇÃO 9: PANORAMA & DIAS FORA DO PADRÃO ==================== -->
  <section class="section page-break">
    <div class="section-head">
      <h2>9. Panorama do Plantão e Dias Fora do Padrão</h2>
      <span>Síntese operacional e picos atípicos (&gt; 2<span style="text-transform:none">&sigma;</span>)</span>
    </div>
    <div class="card">
      <h3>Síntese Operacional do Período</h3>
      <div class="summary-grid">
        ${summaryCardsHTML}
      </div>
    </div>
    <div class="card-flow">
      <h3>Dias Fora do Padrão (Desvio &gt; 2<span style="text-transform:none">&sigma;</span>)</h3>
      ${anomalyTableHTML}
    </div>
  </section>

</div>
</body>
</html>`);

        win.document.close();

        setTimeout(() => {
          win.print();
          UI.loading(false);
        }, 900);
      } catch (err) {
        console.error('PDF Generation Error:', err);
        UI.toast('Erro ao gerar relatório em PDF.', 'error');
        UI.loading(false);
      }
    }, 250);
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

    // Super Filtro de Convênios (Visão Geral + Por Operadora)
    const convCounts = {};
    data.forEach(d => {
      const k = (d.convenio || d.tipoConvenio || 'NÃO INFORMADO').trim();
      convCounts[k] = (convCounts[k] || 0) + 1;
    });
    const sortedConvs = Object.entries(convCounts).sort((a, b) => b[1] - a[1]);

    const cSel = document.getElementById('convenioFilter');
    if (cSel) {
      const prev = State.filters.convenio || 'TODOS';
      cSel.innerHTML = '';
      const grpGeneral = document.createElement('optgroup');
      grpGeneral.label = 'Visão Geral';
      [
        ['TODOS', 'Todos os Convênios'],
        ['TIPO:SUS', 'Apenas SUS'],
        ['TIPO:CONVÊNIOS', 'Todos os Privados / Convênios']
      ].forEach(([val, lbl]) => {
        const o = document.createElement('option');
        o.value = val; o.textContent = lbl;
        grpGeneral.appendChild(o);
      });
      cSel.appendChild(grpGeneral);

      if (sortedConvs.length > 0) {
        const grpOps = document.createElement('optgroup');
        grpOps.label = 'Por Operadora / Convênio';
        sortedConvs.forEach(([name, cnt]) => {
          const o = document.createElement('option');
          o.value = `OP:${name}`;
          o.textContent = `${name} (${cnt.toLocaleString('pt-BR')})`;
          grpOps.appendChild(o);
        });
        cSel.appendChild(grpOps);
      }
      cSel.value = prev;
      if (!cSel.value) cSel.value = 'TODOS';
    }

    // Filtro de Convênios local no Painel de Auditoria
    const aSel = document.getElementById('auditConvenioFilter');
    if (aSel) {
      aSel.innerHTML = '<option value="all">Todos os Convênios</option>';
      sortedConvs.forEach(([name, cnt]) => {
        const o = document.createElement('option');
        o.value = name;
        o.textContent = `${name} (${cnt.toLocaleString('pt-BR')})`;
        aSel.appendChild(o);
      });
    }
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
    this._kpi('kpiTriageWait', kpis.avgTriageWait!==null?U.fmtMin(kpis.avgTriageWait):'—', 'Média Recepção', 'neutral', null);
    this._kpi('kpiTriageToDocWait', kpis.avgTriageToDocWait!==null?U.fmtMin(kpis.avgTriageToDocWait):'—', 'Média Espera Médica', 'neutral', null);

    this._kpi('kpiWait', U.fmtMin(kpis.avgWait), '',
      kpis.avgWait<=CONFIG.ANAHP.waitTarget?'good':kpis.avgWait<=40?'warn':'bad', null);
    this._kpi('kpiCompliance', `${kpis.compliance.toFixed(1)}%`, '',
      kpis.compliance>=CONFIG.ANAHP.complianceTarget?'good':kpis.compliance>=70?'warn':'bad', null);
    this._kpi('kpiStay', U.fmtMin(kpis.avgStay), '',
      kpis.avgStay<=CONFIG.ANAHP.stayTarget?'good':kpis.avgStay<=300?'warn':'bad', null);
    this._kpi('kpiVolume', kpis.total.toLocaleString('pt-BR'), `Média: ${kpis.avgDaily} at/dia · ${kpis.totalDays} dias`, 'neutral', null);
    this._kpi('kpiPeak', kpis.peakHour!==null?`${String(kpis.peakHour).padStart(2,'0')}:00h`:'—', kpis.peakHour!==null?`${kpis.peakVol} atend. no pico`:'Sem dados', 'neutral', null);
    this._kpi('kpiBestMonth', kpis.bestMonth?CONFIG.MONTHS_SHORT[kpis.bestMonth.month-1]:'—', kpis.bestMonth?`Média: ${U.fmtMin(kpis.bestMonth.avg)}`:'—', 'good', null);
  },
  _kpi(id, val, target, status, delta, unit, lowerIsBetter) {
    const card=document.getElementById(id);
    if(!card) return;
    card.classList.remove('status-good','status-warn','status-bad','status-neutral');
    card.classList.add(`status-${status}`);
    const vEl=document.getElementById(`${id}Value`);
    const tEl=document.getElementById(`${id}Target`);
    const dEl=document.getElementById(`${id}Delta`);
    if(vEl) vEl.textContent=val;
    if(tEl) tEl.textContent=target;
    if(dEl&&delta!==null&&delta!==undefined){
      const isGood=(lowerIsBetter&&delta<0)||(!lowerIsBetter&&delta>0);
      const sign=delta>0?'+':'';
      dEl.className=`kpi-delta ${isGood?'pos':'neg'}`;
      const deltaFmt = unit === 'min'
        ? (delta > 0 ? `+${U.fmtMin(delta)}` : U.fmtMin(delta))
        : `${sign}${typeof delta==='number'?delta.toFixed(1):''}${unit}`;
      dEl.textContent=`${deltaFmt} vs ano base`;
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
  convenioFilter: 'all',
  severityFilter: 'all', // 'all', 'warn' (>30m), 'intern', 'evasion'

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

    // Local convenio filter event
    const convSelect = document.getElementById('auditConvenioFilter');
    if (convSelect) {
      convSelect.addEventListener('change', (e) => {
        this.convenioFilter = e.target.value;
        this.page = 1;
        this.render();
      });
    }

    // Export CSV button
    const btnExport = document.getElementById('btnExportAuditCSV');
    if (btnExport) {
      btnExport.addEventListener('click', () => this.exportCSV());
    }

    // Severity and Destination buttons
    const btnAll = document.getElementById('btnAuditAll');
    const btnWarn = document.getElementById('btnAuditWarn');
    const btnIntern = document.getElementById('btnAuditIntern');
    const btnEvasion = document.getElementById('btnAuditEvasion');

    const updateBtns = (activeBtn) => {
      [btnAll, btnWarn, btnIntern, btnEvasion].forEach(btn => btn?.classList.remove('active'));
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

    btnIntern?.addEventListener('click', () => {
      updateBtns(btnIntern);
      this.severityFilter = 'intern';
      this.page = 1;
      this.render();
    });

    btnEvasion?.addEventListener('click', () => {
      updateBtns(btnEvasion);
      this.severityFilter = 'evasion';
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
      // 0. Date filter (from Calendar / AnomalyTable / WorstTable click)
      if (this._dateFilter) {
        const k = U.dateKey(d);
        if (k !== this._dateFilter) return false;
      }

      // 0a. Slot filter (from Heatmap day-of-week + hour click)
      if (this._slotFilter) {
        if (d.dow !== this._slotFilter.dow || d.entryHour !== this._slotFilter.hour) return false;
      }

      // 0b. Local convenio filter
      if (this.convenioFilter && this.convenioFilter !== 'all') {
        const recConv = (d.convenio || d.tipoConvenio || 'NÃO INFORMADO').toUpperCase();
        if (recConv !== this.convenioFilter.toUpperCase()) return false;
      }

      // 1. Text filter
      let matchText = true;
      if (this.searchQuery) {
        const name = d.name ? d.name.toLowerCase() : '';
        const id = d.id ? d.id.toLowerCase() : '';
        const conv = (d.convenio || d.tipoConvenio || '').toLowerCase();
        matchText = name.includes(this.searchQuery) || id.includes(this.searchQuery) || conv.includes(this.searchQuery);
      }

      // 2. Severity & Destination filter
      let matchSeverity = true;
      if (this.severityFilter === 'warn') {
        matchSeverity = d.waitTime !== null && d.waitTime > 30;
      } else if (this.severityFilter === 'intern') {
        matchSeverity = d.destination && d.destination.toUpperCase() === 'INTERNADO';
      } else if (this.severityFilter === 'evasion') {
        const dest = d.destination ? d.destination.toUpperCase() : '';
        matchSeverity = dest === 'EVASÃO' || dest === 'ÓBITO' || dest === 'EVASAO' || dest === 'OBITO';
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
      pagInfo.innerHTML = `Exibindo <strong style="color: #0F172A;">${startIdx + 1}-${endIdx}</strong> de <strong style="color: #0F172A;">${total.toLocaleString('pt-BR')}</strong> registros | Página <strong style="color: #0F172A;">${this.page}</strong> de <strong style="color: #0F172A;">${maxPages}</strong>`;
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
      const entryDisplay = d.entryTime || (d.entryHour !== null ? `${String(d.entryHour).padStart(2, '0')}:00` : '--:--');
      const formattedDate = U.fmtDate(d.date) + '<br/><span style="color:#64748B;">' + entryDisplay + '</span>';

      // Build Journey Tags
      let journeyHtml = '<div class="journey-tags">';
      if (d.salaVermelhaTime > 0) journeyHtml += `<span class="journey-tag journey-tag-sv">SV: ${U.fmtMin(d.salaVermelhaTime)}</span>`;
      if (d.soroterapiaTime > 0) journeyHtml += `<span class="journey-tag journey-tag-so">Sorot: ${U.fmtMin(d.soroterapiaTime)}</span>`;
      if (d.suturaTime > 0) journeyHtml += `<span class="journey-tag journey-tag-su">Sutura: ${U.fmtMin(d.suturaTime)}</span>`;
      if (d.salaVermelhaTime === 0 && d.soroterapiaTime === 0 && d.suturaTime === 0) {
        journeyHtml += `<span class="journey-tag">Fluxo Padrão</span>`;
      }
      journeyHtml += '</div>';

      // Build Destination Badge
      let destClass = 'dest-other';
      const upperDest = d.destination ? d.destination.toUpperCase() : '';
      if (upperDest === 'INTERNADO' || upperDest === 'INTERNAÇÃO') destClass = 'dest-intern';
      else if (upperDest.includes('ALTA')) destClass = 'dest-alta';
      else if (upperDest === 'EVASÃO' || upperDest === 'ÓBITO' || upperDest === 'EVASAO' || upperDest === 'OBITO') destClass = 'dest-evasion';

      const convLabel = d.convenio || d.tipoConvenio || 'NÃO INFORMADO';
      html += `<tr data-index="${startIdx + i}">
        <td>
          <div class="patient-name-col">
            <span class="patient-name">${d.name || 'PACIENTE ANÔNIMO'}</span>
            <span class="patient-spec">${d.specialty} &bull; <strong style="color:var(--oxford)">${convLabel}</strong></span>
          </div>
        </td>
        <td style="font-family: monospace; font-size: 11px;">${formattedDate}</td>
        <td>${journeyHtml}</td>
        <td>
          <div style="display:flex; flex-direction: column; gap: 4px;">
            <span class="audit-badge ${badgeClass}" style="width:fit-content;" title="Fila: ${U.fmtMin(d.waitTime)}">Espera: ${U.fmtMin(d.waitTime)}</span>
            <span style="font-size: 11px; color: #475569;">Total: <strong style="color:var(--text-1)">${U.fmtMin(d.stayTime)}</strong></span>
          </div>
        </td>
        <td><span class="dest-badge ${destClass}">${d.destination || 'N/A'}</span></td>
        <td style="text-align: right;">
          <button class="audit-btn-view">Detalhes</button>
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
    const stayEl = document.getElementById('auditPatientStay');
    if (stayEl) stayEl.textContent = U.fmtMin(d.stayTime);

    const convName = d.convenio || d.tipoConvenio || 'NÃO INFORMADO';
    const convText = (d.convenio && d.tipoConvenio && d.convenio.toUpperCase() !== d.tipoConvenio.toUpperCase())
      ? `${d.convenio} (${d.tipoConvenio})`
      : convName;
    document.getElementById('auditPatientConvenio').textContent = convText;

    // 1. TIMELINE CALCULATIONS
    const steps = [];
    let currentMin = 0;
    const baseMin = U.timeToMin(d.entryTime, d.entryHour);
    
    const formatTime = (offsetMin) => {
      if (baseMin === null) return '--:--';
      const total = Math.round(baseMin + offsetMin);
      const h = ((Math.floor(total / 60) % 24) + 24) % 24;
      const m = ((total % 60) + 60) % 60;
      return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    };

    // Ficha
    steps.push({
      label: 'Entrada / Ficha',
      time: formatTime(0),
      color: '#0F2942',
      subText: null
    });
    
    // Triagem
    if (d.triageWait > 0) {
      currentMin += d.triageWait;
      steps.push({
        label: 'Triagem',
        time: formatTime(currentMin),
        color: '#2F855A', 
        subText: `Fila: ${U.fmtMin(d.triageWait)}`
      });
    }

    // Atendimento Médico
    if (d.waitTime !== null) {
      currentMin = d.waitTime; // waitTime is total from Ficha to Medico
      const queueTime = d.triageWait > 0 ? d.waitTime - d.triageWait : d.waitTime;
      steps.push({
        label: 'Médico',
        time: formatTime(currentMin),
        color: '#2F855A', 
        subText: `Fila: ${U.fmtMin(queueTime)}`
      });
    }

    // Intermediários
    if (d.salaVermelhaTime > 0) {
      currentMin += d.salaVermelhaTime;
      steps.push({
        label: 'S. Vermelha',
        time: formatTime(currentMin),
        color: '#B91C1C', 
        subText: `Tempo: ${U.fmtMin(d.salaVermelhaTime)}`
      });
    }
    
    if (d.soroterapiaTime > 0) {
      currentMin += d.soroterapiaTime;
      steps.push({
        label: 'Soroterapia',
        time: formatTime(currentMin),
        color: '#3B6E8C', 
        subText: `Tempo: ${U.fmtMin(d.soroterapiaTime)}`
      });
    }
    
    if (d.suturaTime > 0) {
      currentMin += d.suturaTime;
      steps.push({
        label: 'Sutura',
        time: formatTime(currentMin),
        color: '#C27803', 
        subText: `Tempo: ${U.fmtMin(d.suturaTime)}`
      });
    }

    // Alta / Conclusão
    if (d.stayTime !== null) {
      const dest = d.destination ? d.destination.toUpperCase() : '';
      let destColor = '#64748B';
      if (dest === 'INTERNADO' || dest === 'INTERNAÇÃO') destColor = '#3B6E8C';
      else if (dest.includes('ALTA') || dest.includes('CASA')) destColor = '#2F855A';
      else if (dest === 'EVASÃO' || dest === 'ÓBITO' || dest === 'EVASAO' || dest === 'OBITO') destColor = '#B91C1C';
      
      const outTime = d.exitTime || formatTime(Math.max(d.stayTime, currentMin));
      
      steps.push({
        label: d.destination || 'Desfecho',
        time: outTime,
        color: destColor,
        subText: `Permanência: ${U.fmtMin(d.stayTime)}`
      });
    }

    const tContainer = document.getElementById('auditTimelineContainer');
    if (tContainer) {
      const padding = 100 / (steps.length * 2);
      let tHtml = `
        <div class="timeline-line" style="position: absolute; top: 12px; left: ${padding}%; right: ${padding}%; height: 2px; background: #CBD5E1; z-index: 1;"></div>
        <div id="timelineProgressLine" style="position: absolute; top: 12px; left: ${padding}%; width: 0%; height: 2px; background: #0F2942; z-index: 2; transition: width 0.6s ease-in-out;"></div>
      `;
      
      steps.forEach((s) => {
        tHtml += `
          <div class="timeline-step" style="flex: 1; text-align: center; z-index: 3; position: relative;">
            <div class="timeline-dot" style="width: 24px; height: 24px; border-radius: 50%; background: #FFFFFF; border: 2.5px solid ${s.color}; margin: 0 auto 8px; display: flex; align-items: center; justify-content: center;">
              <span style="width: 8px; height: 8px; border-radius: 50%; background: ${s.color};"></span>
            </div>
            <span style="font-weight: 700; color: #0F172A; display: block; font-size: 11px;">${s.label}</span>
            <span style="font-size: 10.5px; color: #475569; font-variant-numeric: tabular-nums;">${s.time}</span>
            ${s.subText ? `<span style="display:block;font-size:9.5px;color:#64748B;margin-top:2px;">${s.subText}</span>` : ''}
          </div>
        `;
      });
      tContainer.innerHTML = tHtml;
      
      setTimeout(() => {
        const prog = document.getElementById('timelineProgressLine');
        if (prog) prog.style.width = `${100 - padding * 2}%`;
      }, 100);
    }

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
        zBadge.style.background = '#FEF2F2';
        zBadge.style.color = '#B91C1C';
        zBadge.style.borderColor = '#FECACA';
        zTitle.textContent = 'Espera Fora do Padrão (Crítica)';
        zTitle.style.color = '#B91C1C';
        zDesc.textContent = `Atraso incomum (${zVal} desvios padrão acima da média da clínica).`;
      } else if (zScore > 1) {
        zBadge.style.background = '#FFFBEB';
        zBadge.style.color = '#B45309';
        zBadge.style.borderColor = '#FDE68A';
        zTitle.textContent = 'Desvio Moderado';
        zTitle.style.color = '#B45309';
        zDesc.textContent = `Tempo de espera acima do normal para a especialidade (${zVal} desvios padrão).`;
      } else {
        zBadge.style.background = '#F0FDF4';
        zBadge.style.color = '#166534';
        zBadge.style.borderColor = '#BBF7D0';
        zTitle.textContent = 'Tempo Conforme';
        zTitle.style.color = '#166534';
        zDesc.textContent = `Tempo de espera dentro do padrão esperado para o setor (${zVal}σ).`;
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
        cBadge.style.background = '#FEF2F2';
        cBadge.style.color = '#B91C1C';
        cBadge.style.borderColor = '#FECACA';
      } else if (activeVolume > 12) {
        loadText = 'Alto Fluxo no Setor';
        cBadge.style.background = '#FFFBEB';
        cBadge.style.color = '#B45309';
        cBadge.style.borderColor = '#FDE68A';
      } else {
        loadText = 'Fluxo Regular';
        cBadge.style.background = '#EFF4F8';
        cBadge.style.color = '#0F2942';
        cBadge.style.borderColor = '#CBD5E1';
      }
      cDesc.innerHTML = `<strong style="color:#0F172A;">${loadText}</strong> (${activeVolume} pacientes ativos na clínica no mesmo turno e dia).`;
    }

    modal.classList.remove('hidden');
  },

  closeModal() {
    const modal = document.getElementById('auditDetailModal');
    if (modal) {
      modal.classList.add('hidden');
    }
  },

  filterByDate(dateKey, scroll = false) {
    AuditPanel._slotFilter = null;
    AuditPanel._dateFilter = dateKey;
    // Show badge
    const badge = document.getElementById('auditDateFilterBadge');
    const label = document.getElementById('auditDateFilterLabel');
    if (badge && label) {
      const [y, m, d] = dateKey.split('-');
      label.textContent = `${d}/${m}/${y} — Limpar`;
      badge.classList.remove('hidden');
    }
    AuditPanel.page = 1;
    AuditPanel.render();
    if (scroll) {
      setTimeout(() => {
        document.getElementById('auditCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  },

  filterBySlot(dow, hour, scroll = true) {
    AuditPanel._dateFilter = null;
    AuditPanel._slotFilter = { dow, hour };
    const badge = document.getElementById('auditDateFilterBadge');
    const label = document.getElementById('auditDateFilterLabel');
    if (badge && label) {
      const h1 = String(hour).padStart(2, '0');
      const h2 = String(hour + 1).padStart(2, '0');
      label.textContent = `${dow} · ${h1}h–${h2}h — Limpar`;
      badge.classList.remove('hidden');
    }
    AuditPanel.page = 1;
    AuditPanel.render();
    if (scroll) {
      setTimeout(() => {
        document.getElementById('auditCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 120);
    }
  },

  clearDateFilter() {
    AuditPanel._dateFilter = null;
    AuditPanel._slotFilter = null;
    const badge = document.getElementById('auditDateFilterBadge');
    if (badge) badge.classList.add('hidden');
    AuditPanel.page = 1;
    AuditPanel.render();
    // Also remove calendar selection highlight
    document.querySelectorAll('.cal-cell.cal-selected').forEach(c => c.classList.remove('cal-selected'));
  },

  filterByConvenio(name) {
    this.convenioFilter = name || 'all';
    const sel = document.getElementById('auditConvenioFilter');
    if (sel) sel.value = this.convenioFilter;
    this.page = 1;
    this.render();
    document.getElementById('auditCard')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  },

  exportCSV() {
    const rows = this.getFilteredData();
    if (!rows.length) {
      UI.toast('Nenhum registro filtrado para exportar.', 'warning');
      return;
    }
    const headers = [
      'DATA', 'DIA_SEMANA', 'ATENDIMENTO', 'TIPO_CONVENIO', 'CONVENIO', 'PACIENTE',
      'ESPECIALIDADE', 'DESTINO', 'HORA_ENTRADA', 'ESPERA_TRIAGEM', 'TRIAGEM_MEDICO',
      'ESPERA_TOTAL_MEDICO', 'SALA_VERMELHA', 'SOROTERAPIA', 'SUTURA', 'PERMANENCIA_TOTAL'
    ];
    const esc = v => {
      const s = (v === null || v === undefined ? '' : String(v)).replace(/"/g, '""');
      return s.includes(';') || s.includes('"') || s.includes('\n') ? `"${s}"` : s;
    };
    const lines = [headers.join(';')];
    rows.forEach(d => {
      lines.push([
        U.fmtDate(d.date),
        d.dow || '',
        d.id || '',
        d.tipoConvenio || '',
        d.convenio || d.tipoConvenio || '',
        d.name || '',
        d.specialty || '',
        d.destination || '',
        d.entryTime || (d.entryHour !== null ? `${String(d.entryHour).padStart(2, '0')}:00` : ''),
        d.triageWait !== null ? U.fmtMin(d.triageWait) : '',
        d.triageToDocWait !== null ? U.fmtMin(d.triageToDocWait) : '',
        d.waitTime !== null ? U.fmtMin(d.waitTime) : '',
        d.salaVermelhaTime !== null ? U.fmtMin(d.salaVermelhaTime) : '',
        d.soroterapiaTime !== null ? U.fmtMin(d.soroterapiaTime) : '',
        d.suturaTime !== null ? U.fmtMin(d.suturaTime) : '',
        d.stayTime !== null ? U.fmtMin(d.stayTime) : ''
      ].map(esc).join(';'));
    });
    const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const convSlug = (this.convenioFilter !== 'all' ? this.convenioFilter : (State.filters.convenio || 'todos'))
      .replace(/[^a-zA-Z0-9]+/g, '_').toLowerCase();
    a.href = url;
    a.download = `auditoria_${convSlug}_${new Date().toISOString().slice(0, 10)}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    UI.toast(`✓ ${rows.length.toLocaleString('pt-BR')} registros exportados para CSV!`);
  },

  _dateFilter: null,
  _slotFilter: null,
};

// ================================================================
// CONVENIO RANKING & AUDIT TABLE
// ================================================================
const ConvenioTable = {
  render(kpis) {
    const container = document.getElementById('convenioStatsTable');
    const badge = document.getElementById('convenioCountBadge');
    if (!container) return;
    const list = kpis.convenioStats || [];
    if (badge) badge.textContent = `${list.length} ${list.length === 1 ? 'operadora' : 'operadoras'}`;
    if (!list.length) {
      container.innerHTML = '<p style="padding:20px;text-align:center;color:var(--text-3);font-size:12.5px;">Sem dados de convênio disponíveis.</p>';
      return;
    }
    const rowsHtml = list.map(c => {
      const waitCls = c.avgWait === null ? '' : c.avgWait > 90 ? 'time-bad' : c.avgWait > 45 ? 'time-warn' : 'time-good';
      const safeName = c.name.replace(/'/g, "\\'").replace(/"/g, '&quot;');
      return `<tr>
        <td><strong>${c.name}</strong></td>
        <td class="tabular-num" style="text-align:right;">${c.count.toLocaleString('pt-BR')} <span style="color:var(--text-3);font-size:11px;">(${c.pct}%)</span></td>
        <td class="tabular-num ${waitCls}" style="text-align:right;font-weight:700;">${c.avgWait !== null ? U.fmtMin(c.avgWait) : '—'}</td>
        <td class="tabular-num" style="text-align:right;">${c.avgStay !== null ? U.fmtMin(c.avgStay) : '—'}</td>
        <td class="tabular-num" style="text-align:right;">${c.waitGt60Pct}%</td>
        <td class="tabular-num" style="text-align:right;">${c.internRate}%</td>
        <td style="text-align:right;">
          <button class="audit-btn-view" onclick="AuditPanel.filterByConvenio('${safeName}')">Auditar</button>
        </td>
      </tr>`;
    }).join('');
    container.innerHTML = `<table class="data-table">
      <thead>
        <tr>
          <th>Convênio / Operadora</th>
          <th style="text-align:right;">Atendimentos</th>
          <th style="text-align:right;">Espera Média</th>
          <th style="text-align:right;">Permanência</th>
          <th style="text-align:right;">&gt; 1h</th>
          <th style="text-align:right;">Intern.</th>
          <th style="text-align:right;">Auditoria</th>
        </tr>
      </thead>
      <tbody>${rowsHtml}</tbody>
    </table>`;
  },
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
  Charts.convenioWait(kpis);
  ConvenioTable.render(kpis);
  Charts.distribution(data);
  Charts.daily(daily);
  Charts.weekday(data);
  Charts.forecast(daily);
  Charts.pareto(kpis);

  // New flow charts
  Charts.sectorTimes(kpis);
  Charts.destinationDonut(kpis);
  Charts.cycleEfficiency(data);
  FlowPanel.render(kpis);

  Scorecard.render(kpis, baseKpis);
  if (Simulator.active) { Simulator.update(); }

  Heatmap.render(data);
  AnnualCalendar.render(data);
  DayDetailModal._selectedDateKey = null;
  AnomalyTable.render(data);
  CapacityGrid.render(data);
  WorstTable.render(data);
  AuditPanel.render();
}

// ================================================================
// FLOW PANEL – Fluxo de Pacientes section renderer
// ================================================================
const FlowPanel = {
  _set(id, val, good, bad) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = val;
    el.closest?.('.kpi-card')?.classList.remove('status-good','status-warn','status-bad','status-neutral');
    el.closest?.('.kpi-card')?.classList.add('status-neutral');
  },

  render(kpis) {
    // ── Sector time KPI cards ────────────────────────────────────────
    const sv = document.getElementById('kpiSalaVermelhaValue');
    if (sv) {
      sv.textContent = kpis.avgSalaV !== null ? U.fmtMin(kpis.avgSalaV) : '—';
      const card = sv.closest('.kpi-card');
      if (card) {
        card.classList.remove('status-good','status-warn','status-bad');
        card.classList.add('status-neutral');
      }
      const sub = document.getElementById('kpiSalaVermelhaCount');
      if (sub) sub.textContent = kpis.salaVCount > 0 ? `${kpis.salaVCount.toLocaleString('pt-BR')} casos` : 'Sem dados';
    }

    const sorot = document.getElementById('kpiSoroterapiaValue');
    if (sorot) {
      sorot.textContent = kpis.avgSorot !== null ? U.fmtMin(kpis.avgSorot) : '—';
      const card = sorot.closest('.kpi-card');
      if (card) {
        card.classList.remove('status-good','status-warn','status-bad');
        card.classList.add('status-neutral');
      }
      const sub = document.getElementById('kpiSoroterapiaCount');
      if (sub) sub.textContent = kpis.sorotCount > 0 ? `${kpis.sorotCount.toLocaleString('pt-BR')} casos` : 'Sem dados';
    }

    const sutura = document.getElementById('kpiSuturaValue');
    if (sutura) {
      sutura.textContent = kpis.avgSutura !== null ? U.fmtMin(kpis.avgSutura) : '—';
      const card = sutura.closest('.kpi-card');
      if (card) {
        card.classList.remove('status-good','status-warn','status-bad');
        card.classList.add('status-neutral');
      }
      const sub = document.getElementById('kpiSuturaCount');
      if (sub) sub.textContent = kpis.suturaCount > 0 ? `${kpis.suturaCount.toLocaleString('pt-BR')} casos` : 'Sem dados';
    }

    // ── Destination rate KPI cards ───────────────────────────────────
    const intern = document.getElementById('kpiInternRate');
    if (intern) intern.textContent = kpis.internRate !== null ? `${kpis.internRate}%` : '—';

    const evasion = document.getElementById('kpiEvasionRate');
    if (evasion) {
      evasion.textContent = kpis.evasionRate !== null ? `${kpis.evasionRate}%` : '—';
      const card = evasion.closest('.kpi-card');
      if (card) {
        card.classList.remove('status-good','status-warn','status-bad');
        card.classList.add('status-neutral');
      }
    }

    const home = document.getElementById('kpiHomeRate');
    if (home) home.textContent = kpis.homeRate !== null ? `${kpis.homeRate}%` : '—';

    const death = document.getElementById('kpiDeathRate');
    if (death) {
      death.textContent = kpis.deathRate !== null ? `${kpis.deathRate}%` : '—';
      const card = death.closest('.kpi-card');
      if (card) {
        card.classList.remove('status-good','status-warn','status-bad');
        card.classList.add('status-neutral');
      }
    }

    const tbody = document.getElementById('destTableBody');
    if (tbody && kpis.destinationStats?.length) {
      const rows = kpis.destinationStats
        .filter(d => d.name !== 'Não Informado')
        .slice(0, 10)
        .map(d => {
          const bar = `<div style="height:6px;border-radius:3px;background:var(--oxford);width:${d.pct}%;min-width:4px;max-width:100%;transition:width 0.4s"></div>`;
          const waitStr = d.avgWait !== null ? U.fmtMin(d.avgWait) : '—';
          return `<tr>
            <td style="font-weight:600;color:var(--text-1)">${d.name}</td>
            <td>${d.count.toLocaleString('pt-BR')}</td>
            <td style="min-width:80px">${bar}</td>
            <td style="font-weight:700;color:var(--text-1)">${d.pct}%</td>
            <td style="font-weight:600;color:var(--text-2);text-align:right;">${waitStr}</td>
          </tr>`;
        }).join('');
      tbody.innerHTML = rows || '<tr><td colspan="5" style="text-align:center;padding:16px;color:var(--text-3)">Sem dados de destino</td></tr>';
    }
  },
};

// ================================================================
// FILTERS
// ================================================================
function applyFilters() {
  const { month, specialty, convenio } = State.filters;
  State.filtered = State.data.filter(d => {
    const m = (month === 'all' || d.month === +month);
    const s = (specialty === 'all' || d.specialty === specialty);
    let c = true;
    if (convenio && convenio !== 'TODOS') {
      const recTipo = (d.tipoConvenio || '').toUpperCase();
      const recConv = (d.convenio || d.tipoConvenio || '').toUpperCase();
      if (convenio === 'SUS' || convenio === 'TIPO:SUS') {
        c = recTipo === 'SUS';
      } else if (convenio === 'CONVÊNIOS' || convenio === 'TIPO:CONVÊNIOS') {
        c = recTipo.includes('CONV');
      } else if (convenio.startsWith('OP:')) {
        c = recConv === convenio.slice(3).toUpperCase();
      } else {
        c = recConv === convenio.toUpperCase() || recTipo === convenio.toUpperCase();
      }
    }
    return m && s && c;
  });
  AuditPanel._dateFilter = null; // Clear day filter when global filters change
  AuditPanel._slotFilter = null;
  AuditPanel.convenioFilter = 'all';
  const aSel = document.getElementById('auditConvenioFilter');
  if (aSel) aSel.value = 'all';
  const badge = document.getElementById('auditDateFilterBadge');
  if (badge) badge.classList.add('hidden');
  render(State.filtered, State.baseData);
}

function handleConvenioFilterChange() {
  const el = document.getElementById('convenioFilter');
  if (el) {
    State.filters.convenio = el.value;
    applyFilters();
  }
}

// ================================================================
// FILE HANDLER
// ================================================================
async function handleFile(file, isBase) {
  if(!file?.name.toLowerCase().endsWith('.csv')){ UI.toast('Selecione um arquivo .csv válido.','error'); return; }
  UI.loading(true, isBase?'Carregando ano base...':'Processando dados do período atual...');
  try {
    const arrayBuffer = await file.arrayBuffer();
    const decoder = new TextDecoder('iso-8859-1');
    const text = decoder.decode(arrayBuffer);
    const data=await Parser.parse(text);
    if(!data.length){ UI.toast('Nenhum dado encontrado no arquivo.','error'); return; }
    if(isBase){
      State.baseData=data;
      State.baseFilename=file.name;
      document.getElementById('baseLoadedLabel').textContent='✓';
      try {
        await DB.upload(data, true);
        localStorage.removeItem('saved_base_data'); // Clear local fallback if successful
      } catch (dbErr) {
        console.warn('DB upload failed, using local storage fallback:', dbErr);
        try {
          localStorage.setItem('saved_base_data', JSON.stringify(data));
          UI.toast('Salvo localmente (Banco de dados offline/indisponível)','warning');
        } catch (storageErr) {
          console.error('Storage limit exceeded:', storageErr);
          UI.toast('Banco de dados indisponível e dados excedem limite do navegador.','error');
        }
      }
      localStorage.setItem('baseFilename', file.name);
      UI.toast(`✓ Ano base: ${data.length.toLocaleString('pt-BR')} atendimentos`,'info');
    } else {
      State.data=data;
      State.filtered=data;
      State.currentFilename=file.name;
      State.filters={month:'all',specialty:'all',convenio:'TODOS'};
      document.getElementById('filterMonth').value='all';
      document.getElementById('filterSpecialty').value='all';
      const cSel=document.getElementById('convenioFilter');
      if(cSel) cSel.value='TODOS';
      document.getElementById('currentLoadedLabel').textContent='✓';
      try {
        await DB.upload(data, false);
        localStorage.removeItem('saved_current_data'); // Clear local fallback if successful
      } catch (dbErr) {
        console.warn('DB upload failed, using local storage fallback:', dbErr);
        try {
          localStorage.setItem('saved_current_data', JSON.stringify(data));
          UI.toast('Salvo localmente (Banco de dados offline/indisponível)','warning');
        } catch (storageErr) {
          console.error('Storage limit exceeded:', storageErr);
          UI.toast('Banco de dados indisponível e dados excedem limite do navegador.','error');
        }
      }
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
        try {
          await DB.clear();
        } catch (e) {
          console.warn('Failed to clear database on server, clearing locally:', e);
        }
        
        // Always clear localStorage fallbacks
        localStorage.removeItem('saved_current_data');
        localStorage.removeItem('saved_base_data');
        localStorage.removeItem('currentFilename');
        localStorage.removeItem('baseFilename');

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
    let res = null;
    try {
      res = await DB.get();
    } catch (e) {
      console.warn('Failed to fetch from DB, attempting local storage fallback:', e);
    }
    
    // Check if we need local fallback
    if (!res || !res.current || res.current.length === 0) {
      const localCurrent = localStorage.getItem('saved_current_data');
      const localBase = localStorage.getItem('saved_base_data');
      if (localCurrent) {
        res = {
          current: JSON.parse(localCurrent),
          base: localBase ? JSON.parse(localBase) : []
        };
        console.log('Successfully loaded data from local fallback storage');
      }
    }

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
