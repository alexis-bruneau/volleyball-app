/* =========================================================
   app.js — State, localStorage, rendering, events
   ========================================================= */

'use strict';

/* ── Constants ──────────────────────────────────────────────── */

const STORAGE_KEY = 'vb_tournament_v2';

const DIV_CONFIG = {
  beginner: { id: 'beginner', name: 'Beginner 4s', icon: '🏐', playerCount: 4 },
  competitive: { id: 'competitive', name: 'Competitive 2s', icon: '⚡', playerCount: 2 },
};

const TEST_TEAMS = {
  beginner: [
    { name: 'Spikers', players: ['Alex M.', 'Jordan L.', 'Sam K.', 'Riley P.'] },
    { name: 'Blockers', players: ['Morgan T.', 'Casey R.', 'Jamie O.', 'Drew N.'] },
    { name: 'Diggers', players: ['Quinn A.', 'Taylor B.', 'Avery C.', 'Blake D.'] },
    { name: 'Setters', players: ['Parker E.', 'Reese F.', 'Logan G.', 'Harper H.'] },
    { name: 'Servers', players: ['Charlie I.', 'Finley J.', 'Skyler K.', 'Rowan L.'] },
    { name: 'Aces', players: ['Dakota M.', 'Emery N.', 'Sage O.', 'River P.'] },
    { name: 'Liberos', players: ['Phoenix Q.', 'Hayden R.', 'Corey S.', 'Peyton T.'] },
    { name: 'Smashers', players: ['Remy U.', 'Sloane V.', 'Tatum W.', 'Lennon X.'] },
  ],
  competitive: [
    { name: 'Thunder', players: ['Max A.', 'Zoe B.'] },
    { name: 'Lightning', players: ['Leo C.', 'Mia D.'] },
    { name: 'Storm', players: ['Noah E.', 'Emma F.'] },
    { name: 'Cyclone', players: ['Liam G.', 'Ava H.'] },
    { name: 'Viper', players: ['Ethan I.', 'Olivia J.'] },
    { name: 'Cobra', players: ['Lucas K.', 'Sophia L.'] },
    { name: 'Eagle', players: ['Mason M.', 'Isabella N.'] },
    { name: 'Falcon', players: ['Elijah O.', 'Charlotte P.'] },
  ],
};

/* Active team portal state (session only — not persisted) */
let TEAM_PORTAL = null; // null = admin mode | { teamId, divId } = team view mode
let HAS_ENTERED = false;

const PHASES = ['registration', 'qualifying', 'playoffs', 'complete'];
const PHASE_LABELS = { registration: 'Registration', qualifying: 'Qualifying', playoffs: 'Playoffs', complete: 'Complete' };
const PHASE_ICONS = { registration: '📋', qualifying: '🏅', playoffs: '🏆', complete: '🎉' };

const MEDALS = ['🥇', '🥈', '🥉', '4️⃣', '5️⃣', '6️⃣', '7️⃣', '8️⃣'];
const PLACE_NAMES = ['1st Place', '2nd Place', '3rd Place', '4th Place', '5th Place', '6th Place', '7th Place', '8th Place'];

/* ── State ──────────────────────────────────────────────────── */

function freshDivision(id) {
  return {
    id,
    teams: [],
    phase: 'registration',
    qualifyingRoundsCount: 3,
    qualifyingRounds: [],
    standings: [],
    bracket: null,
    finalRankings: [],
    teamIdCounter: 0,
    editingTeamId: null,
    expandedRosterId: null,   // which team roster is open in registration
    scoringRule: 'winByTwo',
  };
}

let STATE = {
  activeTab: 'beginner',
  activePage: 'division', // 'division' | 'teams'
  divisions: {
    beginner: freshDivision('beginner'),
    competitive: freshDivision('competitive'),
  },
};

/* ── Firebase / State Management ──────────────────────────────── */

const firebaseConfig = {
  apiKey: "AIzaSyDohCPIyQDOuoLPjoqVQpwSJPimdvAvNss",
  authDomain: "volleyball-tournament-baadf.firebaseapp.com",
  projectId: "volleyball-tournament-baadf",
  storageBucket: "volleyball-tournament-baadf.firebasestorage.app",
  messagingSenderId: "1054100658212",
  appId: "1:1054100658212:web:2e6d06609217b046cbe0b1"
};

// Fallback for databaseURL if missing from config snippet
if (!firebaseConfig.databaseURL) {
  firebaseConfig.databaseURL = `https://${firebaseConfig.projectId}-default-rtdb.firebaseio.com`;
}

firebase.initializeApp(firebaseConfig);
const db = firebase.database();

function saveState() {
  try {
    db.ref('tournament_v2').set(STATE);
  } catch (e) { 
    console.warn('Firebase save failed:', e); 
  }
}

function loadState() {
  db.ref('tournament_v2').on('value', (snapshot) => {
    const data = snapshot.val();
    if (data && data.divisions) {
      STATE = data;
      if (!STATE.activePage) STATE.activePage = 'division';
      for (const id in STATE.divisions) {
        const d = STATE.divisions[id];
        if (!d.scoringRule)            d.scoringRule = 'winByTwo';
        if (!d.qualifyingRoundsCount)  d.qualifyingRoundsCount = 3;
        if (!d.expandedRosterId)       d.expandedRosterId = null;
        // Back-compat: ensure all teams have a players array
        d.teams = (d.teams || []).map(t => ({ players: [], ...t }));
      }
    } else {
      // Database is empty, initialize it with local fresh STATE
      saveState();
    }
    // Re-render whenever state updates from cloud
    renderApp();
  });
}

/* ── Helpers ────────────────────────────────────────────────── */

const currentDiv = () => STATE.divisions[STATE.activeTab];

function nextTeamId(div) {
  div.teamIdCounter = (div.teamIdCounter || 0) + 1;
  return `t${ div.teamIdCounter } `;
}

function allQualComplete(div) {
  return div.qualifyingRounds.length > 0 &&
    div.qualifyingRounds.every(r => r.games.every(g => g.complete));
}

function esc(str) {
  return String(str ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function getSeed(team, standings) {
  if (!team || !standings) return null;
  const i = standings.findIndex(s => s.team.id === team.id);
  return i >= 0 ? i + 1 : null;
}

/* ── Toast ──────────────────────────────────────────────────── */

function toast(msg, type = 'info') {
  const c  = document.getElementById('toast-container');
  if (!c) return;
  const el = document.createElement('div');
  el.className = `toast ${ type } `;
  el.textContent = msg;
  c.appendChild(el);
  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3200);
}



/* =========================================================
   RENDER ENGINE
   ========================================================= */

let ENTRY_MODE = 'start'; // 'start' | 'register_choice'

function renderApp() {
  if (!HAS_ENTERED) {
    document.getElementById('app').innerHTML = renderEntryScreen();
    bindEvents();
    return;
  }
  
  // -- Capture dirty state and focus --
  const dirtyInputs = {};
  let activeId = null;
  let selectionStart = null;
  let selectionEnd = null;

  if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'SELECT')) {
    activeId = document.activeElement.id;
    if (document.activeElement.tagName === 'INPUT' && document.activeElement.type === 'text') {
      try {
        selectionStart = document.activeElement.selectionStart;
        selectionEnd = document.activeElement.selectionEnd;
      } catch(e) {}
    }
  }

  document.querySelectorAll('input[type="text"], input[type="number"]').forEach(inp => {
    if (inp.id && inp.value !== inp.defaultValue) {
      dirtyInputs[inp.id] = inp.value;
    }
  });
  // ------------------------------------

  const div = currentDiv();

  const html = [
    renderHeader(),
    STATE.activePage === 'teams' ? renderTeamsPage() : renderPhaseBar(div) + renderPhaseContent(div),
    TEAM_PORTAL ? renderTeamPortalPill() : '',
  ].join('');

  document.getElementById('app').innerHTML = html;
  
  // -- Restore dirty state and focus --
  for (const id in dirtyInputs) {
    const el = document.getElementById(id);
    if (el) el.value = dirtyInputs[id];
  }

  if (activeId) {
    const el = document.getElementById(activeId);
    if (el) {
      el.focus();
      if (el.setSelectionRange && selectionStart !== null) {
        try { el.setSelectionRange(selectionStart, selectionEnd); } catch(e) {}
      }
    }
  }
  // ------------------------------------

  bindEvents();
}

function renderEntryScreen() {
  if (ENTRY_MODE === 'register_choice') {
    return `
    <div style = "display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding: 24px;" >
        <div class="logo" style="margin-bottom: 32px;">
          <span class="logo-icon" style="font-size: 48px;">🏐</span>
          <div class="logo-wordmark">
            <span class="logo-name" style="font-size: 32px;">Tournament Manager</span>
          </div>
        </div>
        <div class="card" style="max-width: 500px; width: 100%; text-align: center; padding: 40px 24px;">
          <h2 style="margin-top: 0; margin-bottom: 24px;">Select Division to Register</h2>
          <div style="display: flex; gap: 16px; justify-content: center; flex-wrap: wrap;">
            <button class="btn btn-primary" data-action="entry-reg-div" data-div="beginner" style="flex: 1; padding: 20px; font-size: 16px; min-width: 140px;">
              🏐 Beginner 4s
            </button>
            <button class="btn btn-primary" data-action="entry-reg-div" data-div="competitive" style="flex: 1; padding: 20px; font-size: 16px; min-width: 140px;">
              ⚡ Competitive 2s
            </button>
          </div>
          <button class="btn btn-ghost" data-action="entry-back" style="margin-top: 24px;">← Back</button>
        </div>
      </div>
    `;
  }

  return `
    <div style = "display:flex; flex-direction:column; align-items:center; justify-content:center; min-height:100vh; padding: 24px;" >
      <div class="logo" style="margin-bottom: 32px;">
        <span class="logo-icon" style="font-size: 48px;">🏐</span>
        <div class="logo-wordmark">
          <span class="logo-name" style="font-size: 32px;">Tournament Manager</span>
        </div>
      </div>
      <div class="card" style="max-width: 400px; width: 100%; text-align: center; padding: 40px 24px;">
        <h2 style="margin-top: 0; margin-bottom: 8px;">Welcome!</h2>
        <p style="color: var(--text-muted); margin-bottom: 32px;">How would you like to proceed?</p>
        
        <div style="display: flex; flex-direction: column; gap: 12px;">
          <button class="btn btn-primary" data-action="entry-view-team" style="padding: 16px; font-size: 16px;">
            👤 View as Team
          </button>
          <button class="btn btn-secondary" data-action="entry-register-choice" style="padding: 16px; font-size: 16px;">
            📝 Register Team
          </button>
          <div class="divider" style="margin: 16px 0;"></div>
          <button class="btn btn-ghost" data-action="entry-organizer" style="padding: 12px; font-size: 15px;">
            ⚙️ Organizer Access
          </button>
        </div>
      </div>
    </div>
    `;
}

/* —— Header —— */
function renderHeader() {
  const div = currentDiv();
  const ruleText = 'Volleyball · Win to 21, by 2 · Cap 23';

  const divTabs = Object.values(DIV_CONFIG).map(cfg => {
    const d      = STATE.divisions[cfg.id];
    const active = STATE.activePage === 'division' && STATE.activeTab === cfg.id;
    return `
    <button class="tab ${active ? 'active' : ''}"
  id = "tab-${cfg.id}" data-action="tab" data-div="${cfg.id}" >
    ${ cfg.icon } ${ cfg.name }
  <span class="tab-count">${d.teams.length}</span>
      </button> `;
  }).join('');

  const teamsActive = STATE.activePage === 'teams';
  const totalTeams  = Object.values(STATE.divisions).reduce((s, d) => s + d.teams.length, 0);

  return `
    <div class="header" >
      <div class="header-top">
        <div class="logo">
          <span class="logo-icon">🏐</span>
          <div class="logo-wordmark">
            <span class="logo-name">Tournament Manager</span>
            <span class="logo-sub">${ruleText}</span>
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px;">
          <button class="btn btn-ghost btn-sm portal-login-btn" id="btn-team-login" data-action="team-login">
            ${TEAM_PORTAL ? '👤 ' + esc(TEAM_PORTAL.teamName) : '👤 Team Login'}
          </button>
          <button class="btn-reset" id="btn-reset-all" data-action="reset-all">↺ Reset All</button>
        </div>
      </div>
      <div class="tabs">
        ${divTabs}
        <button class="tab ${teamsActive ? 'active' : ''}" id="tab-teams" data-action="tab-teams">
          👥 Teams
          <span class="tab-count">${totalTeams}</span>
        </button>
      </div>
    </div> `;
}

/* ── Phase progress bar ── */
function renderPhaseBar(div) {
  const cur = PHASES.indexOf(div.phase);
  let html  = '<div class="phase-bar">';

  PHASES.forEach((ph, i) => {
    const done   = i < cur;
    const active = i === cur;
    const cls    = done ? 'done' : active ? 'active' : '';
    const icon   = done ? '✓' : active ? PHASE_ICONS[ph] : '○';
    html += `<div class="phase-step" >
    <div class="phase-label ${cls}">${icon} ${PHASE_LABELS[ph]}</div>
             </div> `;
    if (i < PHASES.length - 1)
      html += `<div class="phase-line ${done ? 'done' : ''}" ></div> `;
  });

  html += '</div>';
  return html;
}

/* ── Phase router ── */
function renderPhaseContent(div) {
  switch (div.phase) {
    case 'registration': return renderRegistration(div);
    case 'qualifying':   return renderQualifying(div);
    case 'playoffs':     return renderPlayoffs(div);
    case 'complete':     return renderComplete(div);
    default:             return '';
  }
}

/* =========================================================
   TEAMS PAGE & PORTAL
   ========================================================= */

function renderTeamsPage() {
  let html = `<div class="teams-page-container" >
    <div class="card" style="margin-bottom:24px;">
      <div class="card-title">👥 All Teams & Rosters</div>
      <div class="card-sub">View rosters across all divisions</div>
    </div>
  `;

  for (const divId in STATE.divisions) {
    const div = STATE.divisions[divId];
    const cfg = DIV_CONFIG[divId];
    
    html += `<div class="section-title" > ${ cfg.icon } ${ cfg.name } <span style="font-size:12px;font-weight:400;color:var(--text-muted);">(${div.teams.length})</span></div> `;
    
    if (div.teams.length === 0) {
      html += `<div class="empty-state" style = "margin-bottom:24px;" > <div class="empty-sub">No teams registered yet</div></div> `;
      continue;
    }
    
    html += `<div class="team-list" style = "margin-bottom:32px;" > `;
    div.teams.forEach((team, i) => {
      const expanded = div.expandedRosterId === team.id;
      const players = team.players || [];
      const maxPlayers = cfg.playerCount;
      
      let rosterHtml = '';
      if (expanded) {
        const slots = [];
        for (let p = 0; p < maxPlayers; p++) {
          const player = players[p];
          if (player) {
            slots.push(`<div class="roster-slot filled read-only" > <span class="roster-name">${esc(player)}</span></div> `);
          } else {
            slots.push(`<div class="roster-slot empty read-only" > <span class="roster-name" style="color:var(--text-muted);font-style:italic;">Open Slot</span></div> `);
          }
        }
        rosterHtml = `<div class="roster-editor" > ${ slots.join('') }</div> `;
      }

      const isMyTeam = TEAM_PORTAL && TEAM_PORTAL.teamId === team.id;
      html += `
    <div class="team-card" ${ isMyTeam ? 'style="border-color:var(--accent);"' : '' }>
      <div class="team-row" style="cursor:pointer;" data-action="toggle-roster" data-team-id="${team.id}" data-div="${div.id}">
        <div class="team-num">${i + 1}</div>
        <div class="team-name-group">
          <span class="team-name">${esc(team.name)} ${isMyTeam ? '👁️' : ''}</span>
          <span class="team-roster-count">${players.length}/${maxPlayers}</span>
        </div>
        <div class="team-btns">
          ${isMyTeam
            ? `<span class="pill pill-ok" style="margin-right:8px;">👁️ Viewing</span>`
            : `<button class="btn btn-ghost btn-sm" style="margin-right:8px;" onclick="event.stopPropagation()" data-action="login-as-team" data-team-id="${team.id}" data-div="${div.id}">👁️ View As</button>`}
          <span style="color:var(--text-sub);font-size:10px;margin-right:8px;">${expanded ? '▲' : '▼'}</span>
        </div>
      </div>
          ${ rosterHtml }
        </div> `;
    });
    html += `</div> `;
  }
  
  html += `</div> `;
  return html;
}

function renderTeamPortalPill() {
  if (!TEAM_PORTAL) return '';
  return `
    <div class="team-portal-pill" >
      <span>Viewing as: <strong>${esc(TEAM_PORTAL.teamName)}</strong></span>
      <button class="btn btn-ghost btn-xs" data-action="team-login">Exit</button>
    </div>
    `;
}

/* =========================================================
   REGISTRATION
   ========================================================= */

function renderRegistration(div) {
  const cfg     = DIV_CONFIG[div.id];
  const canStart = div.teams.length >= 2;

  const N = div.teams.length;
  const rounds = div.qualifyingRoundsCount || 3;

  let qualText = "0 sets";
  let playoffText = "0 sets";
  let totalText = "0 sets";

  if (N >= 2) {
    let minQual = rounds;
    let maxQual = rounds;
    if (N % 2 !== 0) {
      minQual = rounds - 1;
      maxQual = rounds;
    }

    let minPlay = 0;
    let maxPlay = 0;
    if (N === 2)      { minPlay = 1; maxPlay = 1; }
    else if (N === 3) { minPlay = 1; maxPlay = 2; }
    else if (N === 4) { minPlay = 2; maxPlay = 2; }
    else if (N === 5) { minPlay = 1; maxPlay = 3; }
    else if (N === 6) { minPlay = 2; maxPlay = 3; }
    else if (N === 7) { minPlay = 2; maxPlay = 3; }
    else if (N >= 8)  { minPlay = 3; maxPlay = 3; }

    const minTotal = minQual + minPlay;
    const maxTotal = maxQual + maxPlay;

    qualText = minQual === maxQual ? `${ minQual } sets` : `${ minQual } to ${ maxQual } sets(due to byes)`;
    playoffText = minPlay === maxPlay ? `${ minPlay } sets` : `${ minPlay } to ${ maxPlay } sets(depending on results / byes)`;
    totalText = minTotal === maxTotal ? `${ minTotal } sets` : `${ minTotal } to ${ maxTotal } sets`;
  } else {
    qualText = "0 sets (need ≥ 2 teams)";
  }

  let teamsHtml = '';
  if (div.teams.length === 0) {
    teamsHtml = `
    <div class="empty-state" >
        <div class="empty-icon">👥</div>
        <div class="empty-title">No teams yet</div>
        <div class="empty-sub">Add teams manually or use "Add Test Teams"</div>
      </div> `;
  } else {
    teamsHtml = '<div class="team-list">' +
      div.teams.map((team, i) => {
        const editing = div.editingTeamId === team.id;
        const expanded = div.expandedRosterId === team.id;
        const players = team.players || [];
        const maxPlayers = cfg.playerCount;
        
        let rosterHtml = '';
        if (expanded) {
          const slots = [];
          for (let p = 0; p < maxPlayers; p++) {
            const player = players[p];
            if (player) {
              slots.push(`
    <div class="roster-slot filled" >
                  <span class="roster-name">${esc(player)}</span>
                  <button class="btn btn-ghost btn-xs" data-action="remove-player" data-team-id="${team.id}" data-player-idx="${p}" data-div="${div.id}">✕</button>
                </div>
    `);
            } else {
              slots.push(`
    <div class="roster-slot empty" >
      <input type="text" class="roster-input" id="new-player-${team.id}-${p}" placeholder="Player ${p+1} Name" maxlength="40">
        <button class="btn btn-primary btn-xs" data-action="add-player" data-team-id="${team.id}" data-player-idx="${p}" data-div="${div.id}">Add</button>
      </div>
  `);
            }
          }
          rosterHtml = `<div class="roster-editor" > ${ slots.join('') }</div> `;
        }

        return `
    <div class="team-card" >
      <div class="team-row" style="cursor:pointer;" data-action="toggle-roster" data-team-id="${team.id}" data-div="${div.id}">
        <div class="team-num">${i + 1}</div>
        ${editing ? `
                <input type="text" class="team-edit-input"
                       id="edit-input-${team.id}"
                       value="${esc(team.name)}"
                       data-action="edit-input"
                       data-team-id="${team.id}" data-div="${div.id}"
                       maxlength="40"
                       onclick="event.stopPropagation()">
                <div class="team-btns" onclick="event.stopPropagation()">
                  <button class="btn btn-success btn-sm"
                          data-action="save-edit"
                          data-team-id="${team.id}" data-div="${div.id}">Save</button>
                  <button class="btn btn-ghost btn-sm"
                          data-action="cancel-edit" data-div="${div.id}">Cancel</button>
                </div>
              ` : `
                <div class="team-name-group">
                  <span class="team-name">${esc(team.name)}</span>
                  <span class="team-roster-count">${players.length}/${maxPlayers}</span>
                </div>
                <div class="team-btns" onclick="event.stopPropagation()">
                  <button class="btn btn-ghost btn-sm"
                          data-action="edit-team"
                          data-team-id="${team.id}" data-div="${div.id}">✏️</button>
                  <button class="btn btn-danger btn-sm"
                          data-action="delete-team"
                          data-team-id="${team.id}" data-div="${div.id}">✕</button>
                </div>
              `}
      </div>
            ${ rosterHtml }
          </div> `;
      }).join('') + '</div>';
  }

  return `
    <div class="card" style = "margin-bottom:16px;" >
      <div style="margin-bottom:16px;">
        <div class="card-title">${cfg.icon} ${cfg.name} — Registration</div>
        <div class="card-sub">Add your teams before starting the tournament</div>
      </div>

      <div class="settings-group">
        <div class="settings-title">Round Robin & Playoff Estimates</div>
        <div style="display:flex; align-items:center; gap:12px; margin-bottom:14px;">
          <label for="num-rounds-${div.id}" style="font-weight:600; font-size:13px; color:var(--text-sub);">Qualifying Rounds:</label>
          <select id="num-rounds-${div.id}" class="select-input" data-action="set-rounds" data-div="${div.id}" style="padding:6px 12px; border-radius:var(--r-sm); border:1px solid var(--border); background:rgba(255,255,255,0.035); color:var(--text); font-size:13px; outline:none; cursor:pointer;">
            <option value="1" ${rounds === 1 ? 'selected' : ''} style="background:var(--bg-surface);">1 Round</option>
            <option value="2" ${rounds === 2 ? 'selected' : ''} style="background:var(--bg-surface);">2 Rounds</option>
            <option value="3" ${rounds === 3 ? 'selected' : ''} style="background:var(--bg-surface);">3 Rounds (Default)</option>
            <option value="4" ${rounds === 4 ? 'selected' : ''} style="background:var(--bg-surface);">4 Rounds</option>
            <option value="5" ${rounds === 5 ? 'selected' : ''} style="background:var(--bg-surface);">5 Rounds</option>
          </select>
        </div>
        <div class="estimate-box" style="background:rgba(255,107,53,0.03); border:1px solid var(--border); border-radius:var(--r); padding:14px 16px;">
          <div style="font-weight:700; font-size:13px; color:var(--accent); margin-bottom:8px; display:flex; align-items:center; gap:6px;">
            📊 Estimated Sets Played per Team:
          </div>
          <div style="font-size:12px; color:var(--text-sub); line-height:1.6;">
            • <strong>Qualifying Round Robin:</strong> ${qualText}<br>
            • <strong>Playoff Bracket:</strong> ${playoffText}<br>
            • <strong>Total Sets per Team:</strong> <strong style="color:var(--text); font-size:13px;">${totalText}</strong>
          </div>
        </div>
      </div>

      <div class="reg-form">
        <input type="text" id="new-team-name"
               placeholder="Team name…" maxlength="40"
               style="flex:1;">
        <button class="btn btn-primary"
                id="btn-add-team" data-action="add-team" data-div="${div.id}">
          + Add Team
        </button>
      </div>

      <div class="reg-actions">
        <button class="btn btn-secondary btn-sm"
                data-action="add-test" data-div="${div.id}">
          🎲 Add 8 Test Teams
        </button>
        <button class="btn btn-ghost btn-sm"
                data-action="clear-teams" data-div="${div.id}">
          Clear All
        </button>
      </div>

      <div class="section-title">
        Teams
        <span style="font-size:12px;font-weight:400;color:var(--text-muted);">(${div.teams.length})</span>
      </div>
      ${teamsHtml}
    </div>

    <div style="display:flex;justify-content:flex-end;">
      <button class="btn btn-primary btn-xl"
              id="btn-start" data-action="start-tournament" data-div="${div.id}"
              ${canStart ? '' : 'disabled'}>
        🚀 Start Tournament ${canStart ? `· ${div.teams.length} teams` : '(need ≥ 2 teams)'}
      </button>
    </div>`;
}

/* =========================================================
   QUALIFYING
   ========================================================= */

function renderQualifying(div) {
  const standings   = Tournament.calculateStandings(div.teams, div.qualifyingRounds);
  const allDone     = allQualComplete(div);

  let html = `
    <div class="action-bar" >
      <div class="action-bar-info">📋 Enter scores — standings update live</div>
      <div class="action-bar-btns">
        ${allDone
          ? `<span class="pill pill-ok">✓ All games complete</span>
             <button class="btn btn-primary"
                     id="btn-gen-playoffs" data-action="gen-playoffs" data-div="${div.id}">
               🏆 Generate Playoffs
             </button>`
          : ''}
      </div>
    </div> `;

  /* Rounds */
  for (const round of div.qualifyingRounds) {
    const done  = round.games.filter(g => g.complete).length;
    const total = round.games.length;
    html += `
    <div class="round-block" >
        <div class="round-header">
          <span class="round-label">Round ${round.roundNumber}</span>
          <span class="round-status">${done}/${total} scored</span>
          ${round.byeTeam
            ? `<span class="pill pill-warn">🔄 BYE: ${esc(round.byeTeam.name)}</span>`
            : ''}
        </div>
        <div class="games-grid">
          ${round.games.map(g => renderQualGame(g, div.id)).join('')}
        </div>
      </div> `;
  }

  /* Standings table */
  html += `
    <div class="divider" ></div>
      <div class="section-title">
        Standings
        ${allDone ? '<span class="pill pill-ok" style="font-size:11px;">Final</span>' : ''}
      </div>
    ${ renderStandingsTable(standings) } `;

  return html;
}

function renderQualGame(game, divId) {
  const div = STATE.divisions[divId];
  const maxScore = 23; // div.scoringRule was removed

  const isPortalActive = !!TEAM_PORTAL;
  const isMyGame = isPortalActive && (game.teamA.id === TEAM_PORTAL.teamId || game.teamB.id === TEAM_PORTAL.teamId);
  const portalCls = isPortalActive ? (isMyGame ? ' portal-highlight' : ' portal-dim') : '';

  if (game.complete) {
    const aWon = game.scoreA > game.scoreB;
    return `
    <div class="game-card done${portalCls}" id="gc-${game.id}">
        <span class="gt ${aWon ? 'win' : 'loss'}">${esc(game.teamA.name)}</span>
        <div class="score-display">
          <span style="color:${aWon ? 'var(--green)' : 'var(--red)'}">${game.scoreA}</span>
          <span class="score-dash">–</span>
          <span style="color:${!aWon ? 'var(--green)' : 'var(--red)'}">${game.scoreB}</span>
        </div>
        <span class="gt ${!aWon ? 'win' : 'loss'}" style="text-align:right;">${esc(game.teamB.name)}</span>
        ${
    isPortalActive ? '' : `<button class="btn btn-ghost btn-sm"
                data-action="edit-qual-score"
                data-div="${divId}" data-game-id="${game.id}">✏️</button>`
  }
      </div> `;
  }

  return `
    <div class="game-card live${portalCls}" id="gc-${game.id}">
      <span class="gt">${esc(game.teamA.name)}</span>
      <div class="score-entry">
        <input type="number" class="score-input"
               id="qs-${game.id}-a" min="0" max="${maxScore}" placeholder="–" ${isPortalActive ? 'disabled' : ''}>
        <span class="score-sep">vs</span>
        <input type="number" class="score-input"
               id="qs-${game.id}-b" min="0" max="${maxScore}" placeholder="–" ${isPortalActive ? 'disabled' : ''}>
        ${isPortalActive ? '' : `<button class="btn btn-primary btn-sm"
                data-action="save-qual-score"
                data-div="${divId}" data-game-id="${game.id}">Save</button>`}
      </div>
      <span class="gt" style="text-align:right;">${esc(game.teamB.name)}</span>
    </div>`;
}

/* =========================================================
   STANDINGS TABLE (shared by Qualifying & Playoffs)
   ========================================================= */

function renderStandingsTable(standings) {
  if (!standings.length) return '<div class="empty-state"><div class="empty-title">No data yet</div></div>';

  const rows = standings.map((e, i) => {
    const rank  = i + 1;
    const rCls  = rank <= 3 ? `r${ rank } ` : '';
    const diff  = e.diff;
    const dStr  = diff > 0 ? `+ ${ diff } ` : `${ diff } `;
    const dCls  = diff > 0 ? 'diff-pos' : diff < 0 ? 'diff-neg' : '';
    return `
    <tr>
        <td><span class="rank-circle ${rCls}">${rank}</span></td>
        <td><strong>${esc(e.team.name)}</strong></td>
        <td>${e.wins}</td>
        <td>${e.losses}</td>
        <td class="${dCls}">${dStr}</td>
        <td>${e.pf}</td>
      </tr> `;
  }).join('');

  return `
    <div class="card" >
      <div class="standings-wrap">
        <table class="standings">
          <thead>
            <tr>
              <th>#</th><th>Team</th>
              <th>W</th><th>L</th><th>Diff</th><th>PF</th>
            </tr>
          </thead>
          <tbody>${rows}</tbody>
        </table>
      </div>
    </div> `;
}

/* =========================================================
   PLAYOFFS
   ========================================================= */

function renderPlayoffs(div) {
  const bracket = div.bracket;
  if (!bracket) return '<div class="empty-state"><div class="empty-title">No bracket</div></div>';

  const allDone = Tournament.isBracketComplete(bracket);

  let html = `
    <div class="action-bar" >
      <div class="action-bar-info">🏆 Enter bracket scores — teams advance automatically</div>
      <div class="action-bar-btns">
        ${allDone
          ? `<span class="pill pill-ok">✓ All done</span>
             <button class="btn btn-primary"
                     id="btn-finish" data-action="finish-tournament" data-div="${div.id}">
               🎉 View Final Rankings
             </button>`
          : ''}
      </div>
    </div> `;

  /* Main bracket — classic tree */
  html += `<div class="bracket-section" > `;
  html += `<div class="bracket-section-title" >🏆 Main Bracket</div> `;
  html += renderBracketTree(bracket, div);
  html += `</div> `;

  /* 3rd place */
  if (bracket.extraGames?.third_place) {
    const g = bracket.gameMap['third_place'];
    if (g && !g.isNA) {
      html += `
    <div class="bracket-section" >
          <div class="bracket-section-title">🥉 3rd Place Game</div>
          <div class="bracket-games">
            ${renderBracketGame(g, div)}
          </div>
        </div> `;
    }
  }

  /* Placement 5-8 */
  if (bracket.placementRounds?.length) {
    const hasAny = bracket.placementRounds.some(round =>
      round.gameIds.some(gid => {
        const g = bracket.gameMap[gid];
        return g && !g.isNA && (g.teamA || g.teamB || g.complete);
      })
    );
    if (hasAny) {
      html += `<div class="bracket-section" > `;
      html += `<div class="bracket-section-title" >📊 5th–8th Placement Bracket</div> `;
      for (const round of bracket.placementRounds) {
        html += renderBracketRound(round, bracket, div);
      }
      html += `</div> `;
    }
  }

  /* Qualifying standings reference */
  html += `
    <div class="divider" ></div>
      <div class="section-title">Qualifying Standings (Seeding Reference)</div>
    ${ renderStandingsTable(div.standings) } `;

  return html;
}

function renderBracketRound(round, bracket, div) {
  const games = round.gameIds
    .map(gid => bracket.gameMap[gid])
    .filter(g => g && !g.isNA);

  if (!games.length) return '';

  return `
    <div class="bracket-round" >
      <div class="bracket-round-label">${round.name}</div>
      <div class="bracket-games">
        ${games.map(g => renderBracketGame(g, div)).join('')}
      </div>
    </div> `;
}

function renderBracketGame(game, div) {
  const standings = div.standings;
  const maxScore = 23;

  if (game.isNA) return '';

  const isPortalActive = !!TEAM_PORTAL;
  const isMyGame = isPortalActive && (game.teamA?.id === TEAM_PORTAL.teamId || game.teamB?.id === TEAM_PORTAL.teamId);
  const portalCls = isPortalActive ? (isMyGame ? ' portal-highlight' : ' portal-dim') : '';

  const seedA = getSeed(game.teamA, standings);
  const seedB = getSeed(game.teamB, standings);

  const sba = seedA ? `<span class="seed-badge" > ${ seedA }</span> ` : '';
  const sbb = seedB ? `<span class="seed-badge" > ${ seedB }</span> ` : '';

  const na = (team) => team ? esc(team.name) : '<span class="bg-name tbd">TBD</span>';

  /* BYE game */
  if (game.isBye && game.winner) {
    return `
    <div class="bracket-game done${portalCls}" id = "bgc-${game.id}" >
        <div class="bg-side">
          ${sba}<span class="bg-name win">${na(game.teamA)}</span>
        </div>
        <div class="bg-center"><span class="pill pill-warn">BYE</span></div>
        <div class="bg-side right">
          <span class="bg-name tbd">—</span>
        </div>
      </div> `;
  }

  /* Completed game */
  if (game.complete) {
    const aWon = game.winner?.id === game.teamA?.id;
    return `
    <div class="bracket-game done" id = "bgc-${game.id}" >
        <div class="bg-side">
          ${sba}
          <span class="bg-name ${aWon ? 'win' : 'loss'}">${na(game.teamA)}</span>
        </div>
        <div class="bg-center">
          <div class="score-display">
            <span style="color:${aWon ? 'var(--green)' : 'var(--red)'}">${game.scoreA}</span>
            <span class="score-dash">–</span>
            <span style="color:${!aWon ? 'var(--green)' : 'var(--red)'}">${game.scoreB}</span>
          </div>
        </div>
        <div class="bg-side right">
          <span class="bg-name ${!aWon ? 'win' : 'loss'}">${na(game.teamB)}</span>
          ${sbb}
        </div>
        ${
    isPortalActive ? '' : `<button class="btn btn-ghost btn-sm"
                data-action="edit-bracket-score"
                data-div="${div.id}" data-game-id="${game.id}">✏️</button>`
  }
      </div> `;
  }

  /* Pending game */
  const canPlay = !!(game.teamA && game.teamB);
  const cls     = canPlay ? 'live' : '';

  return `
    <div class="bracket-game ${cls}${portalCls}" id = "bgc-${game.id}" >
      <div class="bg-side">
        ${sba}
        <span class="bg-name">${na(game.teamA)}</span>
      </div>
      <div class="bg-center score-entry">
        <input type="number" class="score-input"
               id="bs-${game.id}-a" min="0" max="${maxScore}" placeholder="–"
               ${!canPlay || isPortalActive ? 'disabled' : ''}>
        <span class="score-sep">vs</span>
        <input type="number" class="score-input"
               id="bs-${game.id}-b" min="0" max="${maxScore}" placeholder="–"
               ${!canPlay || isPortalActive ? 'disabled' : ''}>
        ${isPortalActive ? '' : `<button class="btn btn-primary btn-sm"
                data-action="save-bracket-score"
                data-div="${div.id}" data-game-id="${game.id}"
                ${!canPlay ? 'disabled' : ''}>Save</button>`}
      </div>
      <div class="bg-side right">
        <span class="bg-name">${na(game.teamB)}</span>
        ${sbb}
      </div>
    </div>`;
}

/* =========================================================
   BRACKET TREE (Classic Tournament Tree)
   ========================================================= */

function renderBracketTree(bracket, div) {
  /* Determine round structure based on bracket type */
  const hasQF = !!bracket.gameMap['qf_1'];
  const hasSF = !!bracket.gameMap['sf_1'];

  /* 2-team: no tree, just a single game card */
  if (!hasSF) {
    const g = bracket.gameMap['final_1'];
    if (!g) return '';
    return `<div class="bracket-games" > ${ renderBracketGame(g, div) }</div> `;
  }

  /* Build round definitions */
  const rounds = [];
  if (hasQF) {
    rounds.push({ name: 'Quarterfinals', games: ['qf_1', 'qf_2', 'qf_3', 'qf_4'] });
  }
  rounds.push({ name: 'Semifinals', games: ['sf_1', 'sf_2'] });
  rounds.push({ name: 'Championship', games: ['final_1'] });

  /* Calculate tree height based on first round */
  const firstRoundSize = rounds[0].games.length;
  const treeHeight = Math.max(firstRoundSize * 85, 200);

  /* Build the mobile scroll hint */
  let html = `<div class="bracket-tree-scroll" > `;
  html += `<div class="bracket-tree-hint" >← Swipe to see full bracket →</div> `;
  html += `<div class="bracket-tree" style = "min-height:${treeHeight}px;" > `;

  for (let r = 0; r < rounds.length; r++) {
    const round = rounds[r];
    const isLast = r === rounds.length - 1;

    /* Round column */
    html += `<div class="bt-round-col" > `;
    html += `<div class="bt-round-header" > ${ round.name }</div> `;
    html += `<div class="bt-round-body" > `;

    for (const gid of round.games) {
      const game = bracket.gameMap[gid];
      if (game && !game.isNA) {
        html += `<div class="bt-game-slot" > ${ renderBracketTreeCard(game, div) }</div> `;
      } else {
        html += `<div class="bt-game-slot bt-empty" > <div class="bt-game bt-na">—</div></div> `;
      }
    }

    html += `</div></div> `; /* close bt-round-body + bt-round-col */

    /* Connector column (between rounds, not after the last) */
    if (!isLast) {
      const numConnectors = Math.ceil(round.games.length / 2);
      html += `<div class="bt-conn-col" > `;
      html += `<div class="bt-conn-spacer" ></div> `;
      html += `<div class="bt-conn-body" > `;
      for (let c = 0; c < numConnectors; c++) {
        html += `<div class="bt-conn" ></div> `;
      }
      html += `</div></div> `;
    }
  }

  html += `</div></div> `; /* close bracket-tree + bracket-tree-scroll */
  return html;
}

function renderBracketTreeCard(game, div) {
  if (!game) return '<div class="bt-game bt-na">—</div>';

  const standings = div.standings;
  const isPortalActive = !!TEAM_PORTAL;
  const isMyGame = isPortalActive && (game.teamA?.id === TEAM_PORTAL.teamId || game.teamB?.id === TEAM_PORTAL.teamId);
  const portalCls = isPortalActive ? (isMyGame ? ' portal-highlight' : ' portal-dim') : '';

  const seedA = getSeed(game.teamA, standings);
  const seedB = getSeed(game.teamB, standings);
  const sba = seedA ? `<span class="bt-seed" > ${ seedA }</span> ` : '';
  const sbb = seedB ? `<span class="bt-seed" > ${ seedB }</span> ` : '';
  const teamName = (t) => t ? esc(t.name) : '<span class="bt-team bt-tbd">TBD</span>';

  /* BYE game */
  if (game.isBye && game.winner) {
    return `<div class="bt-game bt-bye${portalCls}" id="btg-${game.id}">
      <div class="bt-game-row bt-winner-row">
        ${sba}
        <span class="bt-team bt-win">${teamName(game.teamA)}</span>
        <span class="bt-bye-badge">BYE</span>
      </div>
      <div class="bt-game-row">
        <span class="bt-team bt-tbd">—</span>
      </div>
    </div> `;
  }

  /* Completed game */
  if (game.complete) {
    const aWon = game.winner?.id === game.teamA?.id;
    return `<div class="bt-game bt-done" id="btg-${game.id}">
      <div class="bt-game-row ${aWon ? 'bt-winner-row' : ''}">
        ${sba}
        <span class="bt-team ${aWon ? 'bt-win' : 'bt-loss'}">${teamName(game.teamA)}</span>
        <span class="bt-score" style="color:${aWon ? 'var(--green)' : 'var(--red)'}">${game.scoreA}</span>
      </div>
      <div class="bt-game-row ${!aWon ? 'bt-winner-row' : ''}">
        ${sbb}
        <span class="bt-team ${!aWon ? 'bt-win' : 'bt-loss'}">${teamName(game.teamB)}</span>
        <span class="bt-score" style="color:${!aWon ? 'var(--green)' : 'var(--red)'}">${game.scoreB}</span>
      </div>
      ${
    isPortalActive ? '' : `<button class="bt-edit-btn"
              data-action="edit-bracket-score"
              data-div="${div.id}" data-game-id="${game.id}">✏️</button>`
  }
    </div> `;
  }

  /* Pending game (with score inputs) */
  const canPlay = !!(game.teamA && game.teamB);
  const cls = canPlay ? 'bt-live' : '';

  return `<div class="bt-game ${cls}${portalCls}" id="btg-${game.id}">
    <div class="bt-game-row">
      ${sba}
      <span class="bt-team ${!game.teamA ? 'bt-tbd' : ''}">${teamName(game.teamA)}</span>
      <input type="number" class="bt-score-input" id="bs-${game.id}-a"
             min="0" max="23" placeholder="–" ${!canPlay || isPortalActive ? 'disabled' : ''}>
    </div>
    <div class="bt-game-row">
      ${sbb}
      <span class="bt-team ${!game.teamB ? 'bt-tbd' : ''}">${teamName(game.teamB)}</span>
      <input type="number" class="bt-score-input" id="bs-${game.id}-b"
             min="0" max="23" placeholder="–" ${!canPlay || isPortalActive ? 'disabled' : ''}>
    </div>
    ${
    isPortalActive ? '' : `<button class="bt-save-btn"
            data-action="save-bracket-score"
            data-div="${div.id}" data-game-id="${game.id}"
            ${!canPlay ? 'disabled' : ''}>Save Score</button>`
  }
  </div> `;
}

/* =========================================================
   COMPLETE
   ========================================================= */

function renderComplete(div) {
  const cfg     = DIV_CONFIG[div.id];
  const rankings = div.finalRankings;

  const cards = rankings.map(({ place, team }) => {
    const idx   = place - 1;
    const medal = MEDALS[idx]      ?? `${ place }.`;
    const label = PLACE_NAMES[idx] ?? `${ place }th Place`;
    const cls   = place <= 3 ? `p${ place } ` : '';
    return `
    <div class="ranking-card ${cls}" >
        <div class="ranking-emoji">${medal}</div>
        <div>
          <div class="ranking-name">${esc(team.name)}</div>
          <div class="ranking-place">${label}</div>
        </div>
      </div> `;
  }).join('');

  return `
    <div class="complete-banner" >
      <div class="trophy">🏆</div>
      <h1>Tournament Complete!</h1>
      <p>${cfg.icon} ${cfg.name} — Final Results</p>
    </div>

    <div class="rankings-grid">${cards}</div>

    <div class="divider"></div>
    <div class="section-title">Qualifying Standings</div>
    ${ renderStandingsTable(div.standings) }

  <div style="margin-top:24px;display:flex;justify-content:center;gap:12px;">
    <button class="btn btn-secondary"
      data-action="reset-division" data-div="${div.id}">
      ↺ Reset This Division
    </button>
  </div>`;
}

/* =========================================================
   EVENT BINDING
   ========================================================= */

function bindEvents() {
  const app = document.getElementById('app');

  // Remove stale listeners by replacing node
  const fresh = app.cloneNode(true);
  app.parentNode.replaceChild(fresh, app);
  const root = document.getElementById('app');

  root.addEventListener('click',   onAppClick);
  root.addEventListener('keydown', onAppKeydown);
  root.addEventListener('change',  onAppChange);
}

function onAppKeydown(e) {
  if (e.key !== 'Enter') return;
  const t = e.target;
  
  if (t.id === 'new-team-name') {
    const btn = document.querySelector('[data-action="add-team"]');
    if (btn) btn.click();
    return;
  }
  if (t.dataset.action === 'edit-input') {
    const btn = document.querySelector(`[data-action="save-edit"][data-team-id="${t.dataset.teamId}"]`);
    if (btn) btn.click();
    return;
  }
  if (t.classList.contains('roster-input')) {
    const parts = t.id.split('-');
    if (parts.length >= 4) {
      const idx = parts.pop();
      const teamId = parts.slice(2).join('-');
      const btn = document.querySelector(`[data-action="add-player"][data-team-id="${teamId}"][data-player-idx="${idx}"]`);
      if (btn) btn.click();
    }
    return;
  }
  if (t.classList.contains('score-input')) {
    const parts = t.id.split('-');
    if (parts.length >= 3) {
      const isQual = parts[0] === 'qs';
      const isPlayoff = parts[0] === 'bs';
      parts.shift();
      parts.pop();
      const gameId = parts.join('-');
      const btnAction = isQual ? 'save-qual-score' : (isPlayoff ? 'save-bracket-score' : '');
      if (btnAction) {
        const btn = document.querySelector(`[data-action="${btnAction}"][data-game-id="${gameId}"]`);
        if (btn) btn.click();
      }
    }
    return;
  }
}

function onAppChange(e) {
  const t = e.target;
  if (t.dataset.action === 'set-rounds') {
    const divId = t.dataset.div;
    STATE.divisions[divId].qualifyingRoundsCount = parseInt(t.value, 10);
    saveState();
    renderApp();
  }
}

function onAppClick(e) {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;

  const action = btn.dataset.action;
  const divId  = btn.dataset.div;

  switch (action) {

    /* ── Entry flow ── */
    case 'entry-view-team':
      HAS_ENTERED = true;
      STATE.activePage = 'teams';
      renderApp();
      break;
    case 'entry-register-choice':
      ENTRY_MODE = 'register_choice';
      renderApp();
      break;
    case 'entry-reg-div':
      HAS_ENTERED = true;
      STATE.activePage = 'division';
      STATE.activeTab = divId;
      renderApp();
      setTimeout(() => {
        const inp = document.getElementById('new-team-name');
        if (inp) inp.focus();
      }, 100);
      break;
    case 'entry-back':
      ENTRY_MODE = 'start';
      renderApp();
      break;
    case 'entry-organizer':
      HAS_ENTERED = true;
      renderApp();
      break;
      
    case 'login-as-team':
      const targetTeam = STATE.divisions[divId].teams.find(t => t.id === btn.dataset.teamId);
      if (targetTeam) {
        TEAM_PORTAL = { teamId: targetTeam.id, divId: divId, teamName: targetTeam.name };
        HAS_ENTERED = true;
        STATE.activePage = 'division';
        STATE.activeTab = divId;
        saveState(); renderApp();
        toast(`Logged in as ${ targetTeam.name } `, 'ok');
      }
      break;

    /* ── Tabs & global reset ── */
    case 'tab':
      STATE.activePage = 'division';
      STATE.activeTab = divId;
      saveState(); renderApp();
      break;

    case 'tab-teams':
      STATE.activePage = 'teams';
      saveState(); renderApp();
      break;
      
    case 'team-login':
      handleTeamLogin();
      break;

    case 'reset-all':
      if (confirm('Reset ALL tournament data for both divisions?\nThis cannot be undone.')) {
        STATE = { activeTab: STATE.activeTab,
                  divisions: { beginner: freshDivision('beginner'), competitive: freshDivision('competitive') } };
        saveState(); renderApp();
        toast('All data reset', 'info');
      }
      break;

    /* ── Registration ── */
    case 'add-team':      handleAddTeam(divId);      break;
    case 'add-test':      handleAddTest(divId);       break;
    case 'clear-teams':   handleClearTeams(divId);    break;
    case 'edit-team':
      STATE.divisions[divId].editingTeamId = btn.dataset.teamId;
      saveState(); renderApp();
      setTimeout(() => {
        const inp = document.getElementById(`edit-input-${btn.dataset.teamId}`);
        if (inp) { inp.focus(); inp.select(); }
      }, 30);
      break;

    case 'save-edit':     handleSaveEdit(divId, btn.dataset.teamId);   break;
    case 'cancel-edit':
      STATE.divisions[divId].editingTeamId = null;
      renderApp();
      break;

    case 'delete-team':
      STATE.divisions[divId].teams =
        STATE.divisions[divId].teams.filter(t => t.id !== btn.dataset.teamId);
      saveState(); renderApp();
      break;

    case 'toggle-roster':
      STATE.divisions[divId].expandedRosterId = 
        STATE.divisions[divId].expandedRosterId === btn.dataset.teamId ? null : btn.dataset.teamId;
      saveState(); renderApp();
      break;

    case 'add-player':
      handleAddPlayer(divId, btn.dataset.teamId, btn.dataset.playerIdx);
      break;

    case 'remove-player':
      handleRemovePlayer(divId, btn.dataset.teamId, btn.dataset.playerIdx);
      break;

    case 'start-tournament': handleStartTournament(divId);  break;

    /* ── Qualifying ── */
    case 'save-qual-score':  handleSaveQualScore(divId, btn.dataset.gameId);   break;
    case 'edit-qual-score':  handleEditQualScore(divId, btn.dataset.gameId);   break;
    case 'gen-playoffs':     handleGenPlayoffs(divId);                         break;

    /* ── Bracket ── */
    case 'save-bracket-score':  handleSaveBracketScore(divId, btn.dataset.gameId);  break;
    case 'edit-bracket-score':  handleEditBracketScore(divId, btn.dataset.gameId);  break;
    case 'finish-tournament':   handleFinishTournament(divId);                      break;

    /* ── Complete ── */
    case 'reset-division':
      if (confirm(`Reset the ${ DIV_CONFIG[divId].name } division ? This cannot be undone.`)) {
        STATE.divisions[divId] = freshDivision(divId);
        saveState(); renderApp();
        toast(`${ DIV_CONFIG[divId].name } reset`, 'info');
      }
      break;
  }
}

/* =========================================================
   ACTION HANDLERS
   ========================================================= */

/* ── Registration ── */

function handleAddTeam(divId) {
  const inp  = document.getElementById('new-team-name');
  const name = inp ? inp.value.trim() : '';
  if (!name) { toast('Enter a team name first', 'err'); return; }

  const div = STATE.divisions[divId];
  div.teams.push({ id: nextTeamId(div), name, players: [] });
  saveState(); renderApp();
  setTimeout(() => { const i = document.getElementById('new-team-name'); if (i) i.focus(); }, 30);
  toast(`"${name}" added`, 'ok');
}

function handleAddTest(divId) {
  const div   = STATE.divisions[divId];
  const testData = TEST_TEAMS[divId] || TEST_TEAMS.beginner;
  testData.forEach(tData => {
    if (!div.teams.find(t => t.name === tData.name))
      div.teams.push({ id: nextTeamId(div), name: tData.name, players: [...(tData.players || [])] });
  });
  saveState(); renderApp();
  toast('Test teams added', 'ok');
}

function handleClearTeams(divId) {
  if (!confirm('Remove all teams from this division?')) return;
  const div = STATE.divisions[divId];
  div.teams = []; div.teamIdCounter = 0;
  saveState(); renderApp();
}

function handleSaveEdit(divId, teamId) {
  const inp  = document.getElementById(`edit-input-${teamId}`);
  const name = inp ? inp.value.trim() : '';
  if (!name) { toast('Name cannot be empty', 'err'); return; }
  const team = STATE.divisions[divId].teams.find(t => t.id === teamId);
  if (team) team.name = name;
  STATE.divisions[divId].editingTeamId = null;
  saveState(); renderApp();
}

function handleAddPlayer(divId, teamId, playerIdx) {
  const inp = document.getElementById(`new-player-${teamId}-${playerIdx}`);
  const name = inp ? inp.value.trim() : '';
  if (!name) return;
  const team = STATE.divisions[divId].teams.find(t => t.id === teamId);
  if (team) {
    team.players = team.players || [];
    team.players[playerIdx] = name;
  }
  saveState(); renderApp();
}

function handleRemovePlayer(divId, teamId, playerIdx) {
  const team = STATE.divisions[divId].teams.find(t => t.id === teamId);
  if (team && team.players) {
    team.players[playerIdx] = null;
  }
  saveState(); renderApp();
}

function handleTeamLogin(fromEntry = false) {
  if (TEAM_PORTAL && !fromEntry) {
    // Log out
    TEAM_PORTAL = null;
    toast('Exited Team View', 'info');
    renderApp();
    return;
  }
  
  const searchName = prompt('Enter your team name to view your schedule:');
  if (!searchName || !searchName.trim()) return;
  
  const q = searchName.trim().toLowerCase();
  
  // Search across all divisions
  for (const divId in STATE.divisions) {
    const div = STATE.divisions[divId];
    const team = div.teams.find(t => t.name.toLowerCase() === q);
    if (team) {
      TEAM_PORTAL = { teamId: team.id, divId: divId, teamName: team.name };
      if (fromEntry) HAS_ENTERED = true;
      // Switch to their division automatically
      STATE.activePage = 'division';
      STATE.activeTab = divId;
      toast(`Logged in as ${ team.name } `, 'ok');
      renderApp();
      return;
    }
  }
  
  toast('Team not found. Check spelling?', 'err');
}

function handleEntryRegisterTeam() {
  const divName = prompt('Enter division (1 for Beginner 4s, 2 for Competitive 2s):');
  if (divName !== '1' && divName !== '2') return;
  const divId = divName === '1' ? 'beginner' : 'competitive';
  const name = prompt('Enter your Team Name:');
  if (!name || !name.trim()) return;
  
  const div = STATE.divisions[divId];
  if (div.phase !== 'registration') {
    toast('Registration is closed for this division.', 'err');
    return;
  }
  
  // Check for duplicate
  if (div.teams.find(t => t.name.toLowerCase() === name.trim().toLowerCase())) {
    toast('Team name already exists in this division.', 'err');
    return;
  }
  
  const t = { id: nextTeamId(div), name: name.trim(), players: [] };
  div.teams.push(t);
  
  HAS_ENTERED = true;
  TEAM_PORTAL = { teamId: t.id, divId, teamName: t.name };
  STATE.activePage = 'division';
  STATE.activeTab = divId;
  saveState(); renderApp();
  toast(`Registered and logged in as ${ t.name } `, 'ok');
  
  // Optional: Auto-expand roster editor for them to add players
  setTimeout(() => {
    const btn = document.querySelector(`[data-action="toggle-roster"][data-team-id="${t.id}"]`);
    if (btn) btn.click();
  }, 100);
}

function handleStartTournament(divId) {
  const div = STATE.divisions[divId];
  if (div.teams.length < 2) { toast('Need at least 2 teams', 'err'); return; }
  div.phase            = 'qualifying';
  const roundsCount    = div.qualifyingRoundsCount || 3;
  div.qualifyingRounds = Tournament.generateQualifyingRounds(div.teams, roundsCount);
  div.editingTeamId    = null;
  saveState(); renderApp();
  toast('Tournament started — qualifying schedule generated!', 'ok');
}

/* ── Qualifying ── */

function handleSaveQualScore(divId, gameId) {
  const div = STATE.divisions[divId];
  const sA = parseInt(document.getElementById(`qs-${gameId}-a`)?.value, 10);
  const sB = parseInt(document.getElementById(`qs-${gameId}-b`)?.value, 10);
  const err = Tournament.validateScore(sA, sB);
  if (err) { toast(err, 'err'); return; }
  for (const round of div.qualifyingRounds) {
    const g = round.games.find(g => g.id === gameId);
    if (g) {
      g.scoreA = sA; g.scoreB = sB; g.complete = true;
      g.winner = sA > sB ? g.teamA : g.teamB;
      g.loser  = sA > sB ? g.teamB : g.teamA;
      break;
    }
  }
  saveState(); renderApp();
  toast('Score saved', 'ok');
}

function handleEditQualScore(divId, gameId) {
  const div = STATE.divisions[divId];
  for (const round of div.qualifyingRounds) {
    const g = round.games.find(g => g.id === gameId);
    if (g) {
      g.scoreA = null; g.scoreB = null;
      g.complete = false; g.winner = null; g.loser = null;
      break;
    }
  }
  saveState(); renderApp();
}

function handleGenPlayoffs(divId) {
  const div = STATE.divisions[divId];
  if (!allQualComplete(div)) { toast('All qualifying games must be complete first', 'err'); return; }

  const standings = Tournament.calculateStandings(div.teams, div.qualifyingRounds);
  div.standings   = standings;
  div.bracket     = Tournament.generateBracket(standings);
  div.phase       = 'playoffs';
  saveState(); renderApp();
  toast('Playoffs generated! Seeded by qualifying standings.', 'ok');
}

/* ── Bracket ── */

function handleSaveBracketScore(divId, gameId) {
  const div = STATE.divisions[divId];
  const sA = parseInt(document.getElementById(`bs-${gameId}-a`)?.value, 10);
  const sB = parseInt(document.getElementById(`bs-${gameId}-b`)?.value, 10);
  const err = Tournament.validateScore(sA, sB);
  if (err) { toast(err, 'err'); return; }

  const ok  = Tournament.submitBracketScore(div.bracket, gameId, sA, sB);
  if (!ok) { toast('Could not record score for this game', 'err'); return; }

  saveState(); renderApp();
  toast('Score saved — teams advanced!', 'ok');
}

function handleEditBracketScore(divId, gameId) {
  if (!confirm('Clear this score? Downstream results will also be cleared.')) return;
  const div = STATE.divisions[divId];
  Tournament.resetBracketGame(div.bracket, gameId);
  saveState(); renderApp();
  toast('Score cleared — re-enter to continue', 'info');
}

function handleFinishTournament(divId) {
  const div    = STATE.divisions[divId];
  div.finalRankings = Tournament.getFinalRankings(div.bracket, div.teams, div.standings);
  div.phase    = 'complete';
  saveState(); renderApp();
  toast('Tournament complete! 🎉', 'ok');
}

/* =========================================================
   INIT
   ========================================================= */

document.addEventListener('DOMContentLoaded', () => {
  loadState();
  renderApp();
});
