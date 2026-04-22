const CSV_URLS = [
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT90OJ5N_pEt7acjyLMEOxeLNtIL4Zgls_XxlTeMfbS0U9_JwS4eTuDcH2dJUq4GxXNYRx-radX2E_V/pub?output=csv',
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vT90OJ5N_pEt7acjyLMEOxeLNtIL4Zgls_XxlTeMfbS0U9_JwS4eTuDcH2dJUq4GxXNYRx-radX2E_V/pub?gid=1548301242&single=true&output=csv',
];

function parseCSV(text) {
  const rows = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    const row = [];
    let cur = '', inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') { inQ && line[i+1] === '"' ? (cur += '"', i++) : (inQ = !inQ); }
      else if (ch === ',' && !inQ) { row.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    row.push(cur.trim());
    rows.push(row);
  }
  return rows;
}

const TIER_LABELS = {
  'Tier 1': 'Tier 1 – Strong Fit',
  'Tier 2': 'Tier 2 – Good Fit',
  'Tier 3': 'Tier 3 – Moderate Fit',
  'Tier 4': 'Tier 4 – Reach/Lower Priority',
};

function csvToPrograms(csvText, existingCount = 0) {
  const rows = parseCSV(csvText);
  if (rows.length < 2) return [];
  const headers = rows[0];
  const idx = {};
  headers.forEach((h, i) => idx[h.trim()] = i);
  return rows.slice(1).filter(r => r[idx['Program Name']]).map((r, i) => {
    const imgRaw = (r[idx['IMG']] || '').replace('%', '');
    const imgNum = parseFloat(imgRaw);
    const tier = (r[idx['Tier']] || '').trim();
    return {
      id: existingCount + i + 1,
      name: r[idx['Program Name']] || '',
      city: r[idx['City']] || '',
      state: r[idx['State']] || '',
      positions: r[idx['Positions']] || '—',
      imgPct: isNaN(imgNum) ? 'N/A' : (imgNum % 1 === 0 ? imgNum.toString() : imgNum.toFixed(1)),
      j1: r[idx['J-1']] || '',
      h1b: r[idx['H1-B']] || '',
      type: r[idx['Category']] || '',
      acgme: r[idx['Accreditation Language']] || 'No data',
      pd: r[idx['PD Name']] || '',
      email: r[idx['PD Email']] || '',
      score: parseFloat(r[idx['Original Score']]) || 0,
      currentTier: TIER_LABELS[tier] || tier,
      accContact: r[idx['ACC Contact']] || '',
      step2Finding: r[idx['Step 2 Finding']] || '',
      rationale: r[idx['Tiering Rationale']] || '',
    };
  });
}

const STATE_NAMES = {
  AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',
  CT:'Connecticut',DC:'Washington D.C.',DE:'Delaware',FL:'Florida',GA:'Georgia',
  HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',
  KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',
  MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',
  NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',
  NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',
  OR:'Oregon',PA:'Pennsylvania',PR:'Puerto Rico',RI:'Rhode Island',SC:'South Carolina',
  SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',
  VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming'
};
const GEO_STATES = new Set(['VA','WV','KY','TN','NC']);

const SUPABASE_URL = 'https://ikwhmdwynhomuofzoodr.supabase.co';
const SUPABASE_KEY = 'sb_publishable_pRikPvd5fJS-lfrEOMGAdg_nqN7oxxF';

function sbHeaders(extra = {}) {
  return { 'apikey': SUPABASE_KEY, 'Authorization': `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', ...extra };
}

let programs = [];
let currentFilter = 'all';
let currentAcgme = 'all';
let currentSort = 'rank';
let sortDir = { rank: 1, name: 1, state: 1, city: 1, tier: 1 };

// In-memory state — populated from Supabase on load
let shortlistIds = new Set();
let notesMap = {};

async function loadFromSupabase() {
  try {
    const [slRes, notesRes] = await Promise.all([
      fetch(`${SUPABASE_URL}/rest/v1/shortlist?select=program_id`, { headers: sbHeaders() }),
      fetch(`${SUPABASE_URL}/rest/v1/notes?select=program_id,note`, { headers: sbHeaders() }),
    ]);
    if (slRes.ok) {
      const data = await slRes.json();
      shortlistIds = new Set(data.map(r => r.program_id));
    }
    if (notesRes.ok) {
      const data = await notesRes.json();
      notesMap = {};
      data.forEach(r => { notesMap[r.program_id] = r.note; });
    }
  } catch (e) {
    console.warn('Supabase load failed:', e);
  }
}

function getNotes() { return notesMap; }

function saveNote(id, val) {
  if (val) {
    notesMap[id] = val;
    fetch(`${SUPABASE_URL}/rest/v1/notes`, {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ program_id: id, note: val }),
    });
  } else {
    delete notesMap[id];
    fetch(`${SUPABASE_URL}/rest/v1/notes?program_id=eq.${id}`, {
      method: 'DELETE', headers: sbHeaders(),
    });
  }
}

function getShortlist() { return shortlistIds; }

function toggleShortlist(id) {
  if (shortlistIds.has(id)) {
    shortlistIds.delete(id);
    fetch(`${SUPABASE_URL}/rest/v1/shortlist?program_id=eq.${id}`, {
      method: 'DELETE', headers: sbHeaders(),
    });
    return false;
  } else {
    shortlistIds.add(id);
    fetch(`${SUPABASE_URL}/rest/v1/shortlist`, {
      method: 'POST',
      headers: sbHeaders({ 'Prefer': 'resolution=merge-duplicates' }),
      body: JSON.stringify({ program_id: id }),
    });
    return true;
  }
}

function tierClass(tier) {
  const m = (tier || '').match(/\d/);
  return m ? 't' + m[0] : '';
}
function tierNum(tier) {
  const m = (tier || '').match(/\d/);
  return m ? parseInt(m[0]) : 9;
}

function escAttr(s) { return (s||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;'); }

function buildCard(p) {
  const tClass = tierClass(p.currentTier);
  const isGeo = GEO_STATES.has(p.state.toUpperCase());
  const stateName = STATE_NAMES[p.state.toUpperCase()] || p.state;
  const notes = getNotes();
  const savedNote = notes[p.id] || '';
  const isShortlisted = getShortlist().has(p.id);

  const emailLink = p.email
    ? `<a href="mailto:${p.email}" style="color:var(--accent);text-decoration:none;" onclick="event.stopPropagation()">${p.email}</a>`
    : '—';

  const j1Tag = p.j1 ? `<span class="visa-tag ${p.j1.toLowerCase()==='yes'?'visa-yes':'visa-no'}">J-1: ${p.j1}</span>` : '';
  const h1bTag = p.h1b ? `<span class="visa-tag ${p.h1b.toLowerCase()==='yes'?'visa-yes':'visa-no'}">H1-B: ${p.h1b}</span>` : '';

  return `<div class="program-card ${tClass}${isShortlisted ? ' shortlisted' : ''}" data-id="${p.id}" data-tier="${tClass}" data-acgme="${escAttr((p.type||'').toLowerCase())}" data-name="${p.name.toLowerCase()}" data-state="${stateName.toLowerCase()} ${p.state.toLowerCase()}" data-city="${p.city.toLowerCase()}">
  <div class="rank-num">${p.id}</div>
  <div class="program-info">
    <div class="program-name" title="${p.name}">${p.name}</div>
    <div class="program-meta">
      <span class="meta-tag ${isGeo ? 'geo-tag' : ''}">${p.city}, ${stateName}</span>
      <span class="meta-tag img-tag">IMG: ${p.imgPct}%</span>
      <span class="meta-tag">Pos: ${p.positions}</span>
      <span class="meta-tag">Score: ${p.score}</span>
    </div>
    <div class="expand-panel">
      <div class="acgme-info"><strong>Program Director</strong>${p.pd || '—'}</div>
      <div class="acgme-info"><strong>Email</strong>${emailLink}</div>
      <div class="acgme-info"><strong>Accreditation / Eligibility</strong>${p.acgme}</div>
      <div class="acgme-info" style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px;">${j1Tag}${h1bTag}</div>
      ${p.step2Finding ? `<div class="acgme-info"><strong>Step 2 CK</strong>${p.step2Finding}</div>` : ''}
      ${p.accContact ? `<div class="acgme-info"><strong>Contact / Notes</strong>${p.accContact}</div>` : ''}
      ${p.rationale ? `<div class="tier-reasoning"><div class="reasoning-label">Tiering rationale</div><p style="font-size:12px;color:var(--text);margin:0;line-height:1.6">${p.rationale}</p></div>` : ''}
      <div class="notes-section">
        <div class="notes-label">My notes <span class="notes-saved" id="saved-${p.id}"></span></div>
        <textarea class="notes-input" id="note-${p.id}" placeholder="Add your notes here... (auto-saves)" onclick="event.stopPropagation()" onkeydown="event.stopPropagation()">${savedNote}</textarea>
      </div>
    </div>
  </div>
  <div class="tier-right">
    <button class="shortlist-btn${isShortlisted ? ' active' : ''}" data-shortlist-id="${p.id}">${isShortlisted ? '★' : '☆'}</button>
    <span class="tier-badge">${p.currentTier}</span>
    ${savedNote ? '<span class="has-note">✏</span>' : ''}
  </div>
</div>`;
}

function updateStats() {
  const cards = document.querySelectorAll('.program-card');
  let visible = 0, withNotes = 0;
  const notes = getNotes();
  cards.forEach(c => {
    if (c.style.display !== 'none') visible++;
    if (notes[c.dataset.id]) withNotes++;
  });
  const shortlistCount = getShortlist().size;
  const shortlistFilterBtn = document.querySelector('.filter-btn.shortlist');
  if (shortlistFilterBtn) shortlistFilterBtn.textContent = `Shortlist (${shortlistCount})`;
  const t1 = programs.filter(p=>tierClass(p.currentTier)==='t1').length;
  const t2 = programs.filter(p=>tierClass(p.currentTier)==='t2').length;
  const t3 = programs.filter(p=>tierClass(p.currentTier)==='t3').length;
  const t4 = programs.filter(p=>tierClass(p.currentTier)==='t4').length;
  document.getElementById('stats-bar').innerHTML = `
    <div class="stat">Showing <span>${visible}</span></div>
    <div class="stat">T1 <span style="color:var(--t1)">${t1}</span></div>
    <div class="stat">T2 <span style="color:var(--t2)">${t2}</span></div>
    <div class="stat">T3 <span style="color:var(--t3)">${t3}</span></div>
    <div class="stat">T4 <span style="color:var(--t4)">${t4}</span></div>
    <div class="stat">With notes <span style="color:var(--accent)">${withNotes}</span></div>`;
}

function applyFilter() {
  const query = document.getElementById('search').value.toLowerCase();
  const shortlist = getShortlist();
  document.querySelectorAll('.program-card').forEach(card => {
    const tier = card.dataset.tier;
    const id = parseInt(card.dataset.id);
    let show = true;
    if (currentFilter === 'shortlist' && !shortlist.has(id)) show = false;
    if (['t1','t2','t3','t4'].includes(currentFilter) && tier !== currentFilter) show = false;
    if (currentAcgme !== 'all' && card.dataset.acgme !== currentAcgme) show = false;
    if (query && !card.dataset.name.includes(query) && !card.dataset.state.includes(query) && !card.dataset.city.includes(query)) show = false;
    card.style.display = show ? '' : 'none';
  });
  updateStats();
}

function renderGrid() {
  const sorted = [...programs].sort((a, b) => {
    const dir = sortDir[currentSort];
    if (currentSort === 'rank')  return dir * (a.id - b.id);
    if (currentSort === 'name')  return dir * a.name.localeCompare(b.name);
    if (currentSort === 'state') return dir * a.state.localeCompare(b.state) || a.name.localeCompare(b.name);
    if (currentSort === 'city')  return dir * a.city.localeCompare(b.city) || a.name.localeCompare(b.name);
    if (currentSort === 'tier')  return dir * (tierNum(a.currentTier) - tierNum(b.currentTier)) || a.name.localeCompare(b.name);
    return 0;
  });
  document.getElementById('program-grid').innerHTML = sorted.map(p => buildCard(p)).join('');
  applyFilter();
}

function attachGridListeners() {
  const grid = document.getElementById('program-grid');
  grid.addEventListener('click', e => {
    const shortlistBtn = e.target.closest('.shortlist-btn');
    if (shortlistBtn) {
      const id = parseInt(shortlistBtn.dataset.shortlistId);
      const added = toggleShortlist(id);
      shortlistBtn.textContent = added ? '★' : '☆';
      shortlistBtn.classList.toggle('active', added);
      shortlistBtn.closest('.program-card').classList.toggle('shortlisted', added);
      updateStats();
      return;
    }
    const card = e.target.closest('.program-card');
    if (!card || e.target.closest('a') || e.target.closest('textarea')) return;
    card.classList.toggle('expanded');
  });

  const saveTimers = {};
  grid.addEventListener('input', e => {
    const ta = e.target.closest('textarea.notes-input');
    if (!ta) return;
    const id = ta.id.replace('note-', '');
    const savedEl = document.getElementById('saved-' + id);
    if (savedEl) savedEl.textContent = 'saving...';
    clearTimeout(saveTimers[id]);
    saveTimers[id] = setTimeout(() => {
      saveNote(parseInt(id), ta.value);
      if (savedEl) { savedEl.textContent = 'saved ✓'; setTimeout(() => { if(savedEl) savedEl.textContent = ''; }, 2000); }
      const card = ta.closest('.program-card');
      const tierRight = card?.querySelector('.tier-right');
      if (tierRight) {
        let noteIcon = tierRight.querySelector('.has-note');
        if (ta.value.trim() && !noteIcon) {
          noteIcon = document.createElement('span');
          noteIcon.className = 'has-note';
          noteIcon.textContent = '✏';
          tierRight.appendChild(noteIcon);
        } else if (!ta.value.trim() && noteIcon) { noteIcon.remove(); }
      }
      updateStats();
    }, 600);
  });
}

async function init() {
  try {
    const fetches = CSV_URLS.map(url => fetch(url).then(r => r.text()));
    const csvTexts = await Promise.all(fetches);
    programs = [];
    csvTexts.forEach(text => {
      const batch = csvToPrograms(text, programs.length);
      programs = programs.concat(batch);
    });

    const total = programs.length;
    const t1 = programs.filter(p=>tierClass(p.currentTier)==='t1').length;
    const t2 = programs.filter(p=>tierClass(p.currentTier)==='t2').length;
    const t3 = programs.filter(p=>tierClass(p.currentTier)==='t3').length;
    const t4 = programs.filter(p=>tierClass(p.currentTier)==='t4').length;

    document.querySelector('[data-filter="all"]').textContent = `All (${total})`;
    document.querySelector('[data-filter="t1"]').textContent = `Tier 1 (${t1})`;
    document.querySelector('[data-filter="t2"]').textContent = `Tier 2 (${t2})`;
    document.querySelector('[data-filter="t3"]').textContent = `Tier 3 (${t3})`;
    document.querySelector('[data-filter="t4"]').textContent = `Tier 4 (${t4})`;
    document.querySelector('header p').textContent =
      `Tier review based on your applicant profile · ${total} programs`;

    await loadFromSupabase();

    document.getElementById('loading').style.display = 'none';
    document.getElementById('main').style.display = 'block';
    renderGrid();
    attachGridListeners();

    const acgmeVals = [...new Set(programs.map(p => (p.type || '').trim()).filter(v => v))].sort();
    if (acgmeVals.length > 1) {
      const acgmeRow = document.getElementById('acgme-row');
      acgmeRow.style.display = '';
      acgmeRow.innerHTML = `<span class="row-label">Category:</span><button class="filter-btn acgme-btn active" data-acgme="all">All</button>` +
        acgmeVals.map(v => {
          const label = v.length > 40 ? v.slice(0, 37) + '…' : v;
          return `<button class="filter-btn acgme-btn" data-acgme="${escAttr(v.toLowerCase())}">${label}</button>`;
        }).join('');
      acgmeRow.querySelectorAll('.acgme-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          acgmeRow.querySelectorAll('.acgme-btn').forEach(b => b.classList.remove('active'));
          btn.classList.add('active');
          currentAcgme = btn.dataset.acgme;
          applyFilter();
        });
      });
    }

    document.querySelectorAll('.filter-btn[data-filter]').forEach(btn => {
      btn.addEventListener('click', () => {
        document.querySelectorAll('.filter-btn[data-filter]').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        currentFilter = btn.dataset.filter;
        applyFilter();
      });
    });

    document.querySelectorAll('.sort-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.sort;
        if (currentSort === key) { sortDir[key] *= -1; }
        else { document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active')); currentSort = key; sortDir[key] = 1; }
        btn.classList.add('active');
        document.querySelectorAll('.sort-btn').forEach(b => {
          const k = b.dataset.sort;
          const arrow = document.getElementById(k + '-arrow');
          if (arrow) arrow.textContent = sortDir[k] === 1 ? '↑' : '↓';
        });
        renderGrid();
      });
    });

    document.getElementById('search').addEventListener('input', applyFilter);
    updateStats();
  } catch (err) {
    document.getElementById('loading').innerHTML =
      `<p style="color:var(--t4);font-size:14px;">Failed to load program data.<br><small>${err.message}</small><br><br><button onclick="init()" style="padding:8px 18px;background:var(--accent);color:#fff;border:none;border-radius:6px;cursor:pointer;font-size:13px;">Retry</button></p>`;
  }
}

init();
