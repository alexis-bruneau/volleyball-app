/* =========================================================
   app.js — Volleyball Tournament Manager
   Refactored button system: one stable delegated click handler.
   Paste this whole file over your current app.js.
   ========================================================= */

'use strict';

const STORAGE_KEY = 'vb_tournament_v2';
const FIREBASE_PATH = 'tournament_v2';

const DIVS = {
  beginner: { id: 'beginner', name: 'Recreational 3s', icon: '🏐', players: 3 },
  competitive: { id: 'competitive', name: 'Competitive 2s', icon: '⚡', players: 2 },
};

const PHASES = ['registration', 'qualifying', 'playoffs', 'complete'];



const firebaseConfig = {
  apiKey: 'AIzaSyDohCPIyQDOuoLPjoqVQpwSJPimdvAvNss',
  authDomain: 'volleyball-tournament-baadf.firebaseapp.com',
  projectId: 'volleyball-tournament-baadf',
  storageBucket: 'volleyball-tournament-baadf.firebasestorage.app',
  messagingSenderId: '1054100658212',
  appId: '1:1054100658212:web:2e6d06609217b046cbe0b1',
  databaseURL: 'https://volleyball-tournament-baadf-default-rtdb.firebaseio.com',
};

let STATE = {
  activeTab: 'beginner',
  activePage: 'division',
  teamsSubTab: 'teams',
  freeAgents: [],
  freeAgentIdCounter: 0,
  divisions: {
    beginner: freshDivision('beginner'),
    competitive: freshDivision('competitive'),
  },
};

let HAS_ENTERED = false;
let ENTRY_MODE = 'start';
let TEAM_PORTAL = null;
let IS_ORGANIZER = false;
let SCORE_DRAFTS = {};
let REGISTER_DIV_ID = null;
let db = null;
let firebaseReady = false;

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
    expandedTeamId: null,
  };
}

function $(id) {
  return document.getElementById(id);
}

function div() {
  return STATE.divisions[STATE.activeTab];
}

function admin() {
  return IS_ORGANIZER === true;
}

function canEnterScores() {
  return HAS_ENTERED === true;
}

function canManageTeam(divId, teamId) {
  return admin() || (
    TEAM_PORTAL &&
    TEAM_PORTAL.divId === divId &&
    String(TEAM_PORTAL.teamId) === String(teamId)
  );
}

function esc(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function customConfirm({ title, message, confirmText = 'Delete', icon = '⚠️' }) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'confirm-overlay';
    overlay.innerHTML = `
      <div class="confirm-box">
        <div class="confirm-icon">${icon}</div>
        <div class="confirm-title">${title}</div>
        <div class="confirm-msg">${message}</div>
        <div class="confirm-actions">
          <button class="btn btn-cancel" data-role="cancel">Cancel</button>
          <button class="btn btn-confirm-delete" data-role="confirm">${confirmText}</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);
    requestAnimationFrame(() => overlay.classList.add('visible'));

    function close(result) {
      overlay.classList.remove('visible');
      setTimeout(() => overlay.remove(), 250);
      resolve(result);
    }

    overlay.querySelector('[data-role="cancel"]').addEventListener('click', () => close(false));
    overlay.querySelector('[data-role="confirm"]').addEventListener('click', () => close(true));
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false); });
  });
}

function toast(msg, type = 'info') {
  const box = $('toast-container');
  if (!box) {
    console.log(msg);
    return;
  }

  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.textContent = msg;
  box.appendChild(el);

  setTimeout(() => {
    el.style.animation = 'toastOut .3s ease forwards';
    setTimeout(() => el.remove(), 300);
  }, 3000);
}

function normalizeState() {
  if (!STATE || typeof STATE !== 'object') STATE = {};
  if (!STATE.divisions) STATE.divisions = {};

  Object.keys(DIVS).forEach((id) => {
    const d = { ...freshDivision(id), ...(STATE.divisions[id] || {}), id };

    d.teams = Array.isArray(d.teams) ? d.teams : [];
    d.teams = d.teams.map((t, i) => ({
      id: t.id || `t${i + 1}`,
      name: t.name || `Team ${i + 1}`,
      players: Array.isArray(t.players) ? t.players.filter(Boolean) : [],
    }));

    d.phase = PHASES.includes(d.phase) ? d.phase : 'registration';
    d.qualifyingRoundsCount = Number(d.qualifyingRoundsCount || 3);
    d.qualifyingRounds = Array.isArray(d.qualifyingRounds) ? d.qualifyingRounds : [];
    d.standings = Array.isArray(d.standings) ? d.standings : [];
    d.finalRankings = Array.isArray(d.finalRankings) ? d.finalRankings : [];
    d.teamIdCounter = Math.max(
      Number(d.teamIdCounter || 0),
      ...d.teams.map((t) => Number(String(t.id).replace('t', '')) || 0),
    );

    STATE.divisions[id] = d;
  });

  STATE.activeTab = STATE.divisions[STATE.activeTab] ? STATE.activeTab : 'beginner';
  STATE.activePage = ['division', 'teams'].includes(STATE.activePage) ? STATE.activePage : 'division';
  STATE.teamsSubTab = ['teams', 'freeAgents'].includes(STATE.teamsSubTab) ? STATE.teamsSubTab : 'teams';

  STATE.freeAgents = Array.isArray(STATE.freeAgents) ? STATE.freeAgents : [];
  STATE.freeAgents = STATE.freeAgents.map((fa, i) => ({
    id: fa.id || `fa_${i + 1}`,
    name: fa.name || `Free Agent ${i + 1}`,
    formats: Array.isArray(fa.formats) ? fa.formats.filter((f) => DIVS[f]) : [],
  }));

  STATE.freeAgentIdCounter = Math.max(
    Number(STATE.freeAgentIdCounter || 0),
    ...STATE.freeAgents.map((fa) => Number(String(fa.id).replace('fa_', '')) || 0),
  );
}

function persistableState() {
  return {
    divisions: STATE.divisions,
    freeAgents: STATE.freeAgents,
    freeAgentIdCounter: STATE.freeAgentIdCounter,
  };
}

function applyLoadedState(data) {
  if (!data || typeof data !== 'object') return;

  const localUi = {
    activeTab: STATE.activeTab,
    activePage: STATE.activePage,
    teamsSubTab: STATE.teamsSubTab,
  };

  STATE = {
    ...STATE,
    divisions: data.divisions || STATE.divisions,
    freeAgents: Array.isArray(data.freeAgents) ? data.freeAgents : STATE.freeAgents,
    freeAgentIdCounter: data.freeAgentIdCounter ?? STATE.freeAgentIdCounter,
    ...localUi,
  };

  normalizeState();
}

function saveLocal() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(persistableState()));
  } catch (e) {
    console.warn('localStorage save failed', e);
  }
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return false;
    applyLoadedState(JSON.parse(raw));
    return true;
  } catch (e) {
    console.warn('localStorage load failed', e);
    return false;
  }
}

function initFirebase() {
  try {
    if (!window.firebase || !firebase.apps) return;
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    db = firebase.database();
    firebaseReady = true;
  } catch (e) {
    console.warn('Firebase unavailable; using localStorage only', e);
  }
}

function saveState() {
  normalizeState();
  saveLocal();

  if (!firebaseReady || !db) return Promise.resolve();

  return db.ref(FIREBASE_PATH).set(persistableState()).catch((e) => {
    console.warn('Firebase save failed', e);
    toast('Saved locally, but Firebase save failed. Check database rules / URL.', 'err');
  });
}

function loadState() {
  normalizeState();
  loadLocal();

  if (!firebaseReady || !db) {
    renderApp();
    return;
  }

  db.ref(FIREBASE_PATH).on(
    'value',
    (snap) => {
      const data = snap.val();

      if (data && data.divisions) {
        applyLoadedState(data);
      } else {
        saveState();
      }

      saveLocal();
      renderApp();
    },
    (e) => {
      console.warn('Firebase read failed', e);
      toast('Firebase read failed. Using local copy.', 'err');
      renderApp();
    },
  );
}

function nextTeamId(d) {
  d.teamIdCounter = Number(d.teamIdCounter || 0) + 1;
  return `t${d.teamIdCounter}`;
}

function nextFreeAgentId() {
  STATE.freeAgentIdCounter = Number(STATE.freeAgentIdCounter || 0) + 1;
  return `fa_${STATE.freeAgentIdCounter}`;
}

function findTeam(divId, teamId) {
  const d = STATE.divisions[divId];
  return d ? d.teams.find((t) => String(t.id) === String(teamId)) : null;
}

function allQualComplete(d) {
  return d.qualifyingRounds.length > 0 &&
    d.qualifyingRounds.every((r) => r.games.every((g) => g.complete));
}

function seedOf(team, standings) {
  if (!team || !Array.isArray(standings)) return null;
  const i = standings.findIndex((s) => s.team && s.team.id === team.id);
  return i >= 0 ? i + 1 : null;
}

function resetGeneratedData(d) {
  d.phase = 'registration';
  d.qualifyingRounds = [];
  d.standings = [];
  d.bracket = null;
  d.finalRankings = [];
}

function renderApp() {
  normalizeState();

  const app = $('app');
  if (!app) return;

  if (!HAS_ENTERED) {
    app.innerHTML = renderEntry();
    return;
  }

  app.innerHTML = [
    renderHeader(),
    TEAM_PORTAL ? renderPortalPill() : '',
    STATE.activePage === 'teams'
      ? renderTeamsPage()
      : renderPhaseBar(div()) + renderDivision(div()),
  ].join('');
}

function renderEntry() {
  if (ENTRY_MODE === 'register') {
    const selectedDiv = REGISTER_DIV_ID ? DIVS[REGISTER_DIV_ID] : null;

    return `
    <div class="entry-screen">
      <div class="logo entry-logo">
        <span class="logo-icon" style="font-size:48px;">🏐</span>
        <span class="logo-name" style="font-size:32px;">Tournament Manager</span>
      </div>

      <div class="card entry-card">
        <h2 style="margin-bottom:10px;">Register Team</h2>
        <p class="card-sub" style="margin-bottom:24px;">
          Choose your division, then enter your team name.
        </p>

        <div class="mobile-division-grid">
          ${Object.values(DIVS).map((d) => `
            <button
              type="button"
              class="btn ${REGISTER_DIV_ID === d.id ? 'btn-primary' : 'btn-secondary'} division-choice-btn"
              data-action="select-register-division"
              data-div="${d.id}"
            >
              <span style="font-size:22px;">${d.icon}</span>
              <span>${d.name}</span>
            </button>
          `).join('')}
        </div>

        <div class="signup-field" style="margin-top:22px;text-align:left;">
          <label>Team Name</label>
          <input
            id="entry-team-name"
            type="text"
            placeholder="${selectedDiv ? `Team name for ${selectedDiv.name}` : 'Select a division first'}"
            maxlength="40"
            autocomplete="organization"
            ${selectedDiv ? '' : 'disabled'}
          >
        </div>

        <button
          type="button"
          class="btn btn-primary btn-xl"
          data-action="submit-entry-registration"
          style="width:100%;justify-content:center;margin-top:16px;"
          ${selectedDiv ? '' : 'disabled'}
        >
          Register Team
        </button>

        <button class="btn btn-ghost" data-action="entry-back" style="margin-top:18px;">← Back</button>
      </div>
    </div>
  `;
  }

  if (ENTRY_MODE === 'view-team-picker') {
    return renderEntryViewTeamPicker();
  }

  return `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;min-height:100vh;padding:24px;">
      <div class="logo" style="margin-bottom:32px;">
        <span class="logo-icon" style="font-size:48px;">🏐</span>
        <span class="logo-name" style="font-size:32px;">Tournament Manager</span>
      </div>

      <div class="card" style="max-width:420px;width:100%;text-align:center;padding:40px 24px;">
        <h2 style="margin-top:0;">Welcome!</h2>
        <p style="color:var(--text-muted);margin-bottom:32px;">How would you like to proceed?</p>

        <div style="display:flex;flex-direction:column;gap:12px;">
          <button class="btn btn-primary" data-action="entry-view-team" style="padding:16px;font-size:16px;">👤 View as Team</button>
          <button class="btn btn-secondary" data-action="entry-register" style="padding:16px;font-size:16px;">📝 Register Team</button>
          <button class="btn btn-secondary" data-action="entry-free-agent" style="padding:16px;font-size:16px;">🙋 I'm a Free Agent</button>
          <button class="btn btn-secondary" data-action="entry-browse" style="padding:16px;font-size:16px;">🔍 Browse Tournament</button>

          <div class="divider" style="margin:16px 0;"></div>

          <button class="btn btn-ghost" data-action="entry-organizer" style="padding:12px;font-size:15px;">⚙️ Organizer Access</button>
        </div>
      </div>
    </div>
  `;
}

function renderEntryViewTeamPicker() {
  const teams = allTeams();
  const hasTeams = teams.length > 0;

  return `
    <div class="entry-screen">
      <div class="logo entry-logo">
        <span class="logo-icon" style="font-size:48px;">🏐</span>
        <span class="logo-name" style="font-size:32px;">Tournament Manager</span>
      </div>

      <div class="card entry-card" style="max-width:520px;">
        <h2 style="margin-bottom:6px;">Select Your Team</h2>
        <p class="card-sub" style="margin-bottom:20px;">Tap your team to view the tournament as that team.</p>

        ${hasTeams
          ? Object.keys(DIVS).map((divId) => {
              const cfg = DIVS[divId];
              const divTeams = STATE.divisions[divId].teams;
              if (!divTeams.length) return '';
              return `
                <div class="section-title" style="margin-bottom:10px;">${cfg.icon} ${cfg.name}</div>
                <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px;">
                  ${divTeams.map((t) => `
                    <button
                      type="button"
                      class="btn btn-secondary team-picker-btn"
                      data-action="pick-team-from-list"
                      data-div="${divId}"
                      data-team-id="${t.id}"
                      style="justify-content:flex-start;padding:14px 18px;font-size:15px;text-align:left;"
                    >
                      <span style="font-size:18px;">👤</span>
                      <span>${esc(t.name)}</span>
                    </button>
                  `).join('')}
                </div>
              `;
            }).join('')
          : `<div class="empty-state"><div class="empty-title">No teams yet</div><div class="empty-sub">No teams have registered yet. Check back later!</div></div>`
        }

        <button class="btn btn-ghost" data-action="entry-back" style="margin-top:8px;">← Back</button>
      </div>
    </div>
  `;
}

function renderHeader() {
  const total = Object.values(STATE.divisions).reduce((s, d) => s + d.teams.length, 0);

  return `
    <div class="header">
      <div class="header-top">
        <div class="logo">
          <span class="logo-icon">🏐</span>
          <div class="logo-wordmark">
            <span class="logo-name">Tournament Manager</span>
            <span class="logo-sub">Win to 21, by 2 · Cap 23</span>
          </div>
        </div>

        <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
  <button class="btn btn-ghost btn-sm" data-action="main-menu">
    🏠 Main Menu
  </button>

  <button class="btn btn-ghost btn-sm" data-action="team-login">
    ${TEAM_PORTAL ? `👤 ${esc(TEAM_PORTAL.teamName)}` : '👤 Team Login'}
  </button>

  ${admin() ? '<button type="button" class="btn-reset" data-action="reset-all">↺ Reset All</button>' : ''}
</div>
      </div>

      <div class="tabs">
        ${Object.values(DIVS).map((cfg) => {
    const active = STATE.activePage === 'division' && STATE.activeTab === cfg.id;
    return `
            <button class="tab ${active ? 'active' : ''}" data-action="tab" data-div="${cfg.id}">
              ${cfg.icon} ${cfg.name}
              <span class="tab-count">${STATE.divisions[cfg.id].teams.length}</span>
            </button>
          `;
  }).join('')}

        <button class="tab ${STATE.activePage === 'teams' ? 'active' : ''}" data-action="tab-teams">
          👥 Teams
          <span class="tab-count">${total}</span>
        </button>
      </div>
    </div>
  `;
}

function renderPortalPill() {
  return `
    <div class="team-portal-pill">
      <span>Viewing as: <strong>${esc(TEAM_PORTAL.teamName)}</strong></span>
      <button class="btn btn-ghost btn-xs" data-action="exit-team-view">Exit</button>
    </div>
  `;
}

function renderPhaseBar(d) {
  const cur = PHASES.indexOf(d.phase);
  const icons = {
    registration: '📋',
    qualifying: '🏅',
    playoffs: '🏆',
    complete: '🎉',
  };

  return `
    <div class="phase-bar">
      ${PHASES.map((p, i) => {
    const cls = i < cur ? 'done' : i === cur ? 'active' : '';
    const icon = i < cur ? '✓' : i === cur ? icons[p] : '○';

    return `
          <div class="phase-step">
            <div class="phase-label ${cls}">${icon} ${p[0].toUpperCase() + p.slice(1)}</div>
          </div>
          ${i < PHASES.length - 1 ? `<div class="phase-line ${i < cur ? 'done' : ''}"></div>` : ''}
        `;
  }).join('')}
    </div>
  `;
}

function renderDivision(d) {
  if (d.phase === 'registration') return renderRegistration(d);
  if (d.phase === 'qualifying') return renderQualifying(d);
  if (d.phase === 'playoffs') return renderPlayoffs(d);
  return renderComplete(d);
}

function renderRegistration(d) {
  const cfg = DIVS[d.id];

  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="section-title">${cfg.icon} ${cfg.name} Registration</div>
      <div class="card-sub">${cfg.players} players per team.</div>
    </div>

    ${admin() ? `
      <div class="action-bar">
        <div class="action-bar-info">
          <strong>${d.teams.length}</strong> teams registered
        </div>

        <div class="action-bar-btns">
  <input type="number" id="qual-round-count" min="1" max="10" value="${d.qualifyingRoundsCount}" style="width:70px;">
  <button class="btn btn-secondary btn-sm" data-action="set-rounds" data-div="${d.id}">Set Rounds</button>
  <button class="btn btn-danger btn-sm" data-action="clear-teams" data-div="${d.id}">Clear</button>
  <button class="btn btn-primary btn-sm" data-action="start-tournament" data-div="${d.id}" ${d.teams.length >= 2 ? '' : 'disabled'}>Start Tournament</button>
</div>
      </div>

      <div class="reg-form">
        <input id="new-team-name" type="text" placeholder="Team name..." maxlength="40">
        <button class="btn btn-primary" data-action="add-team" data-div="${d.id}">+ Add Team</button>
      </div>
    ` : ''}

    ${renderTeamList(d, false)}
  `;
}

function renderTeamsPage() {
  const totalTeams = Object.values(STATE.divisions).reduce((s, d) => s + d.teams.length, 0);

  return `
    <div class="teams-page-container">
      <div class="sub-tabs">
        <button class="sub-tab ${STATE.teamsSubTab === 'teams' ? 'active' : ''}" data-action="teams-sub-tab" data-sub="teams">
          👥 Teams <span class="sub-tab-count">${totalTeams}</span>
        </button>

        <button class="sub-tab ${STATE.teamsSubTab === 'freeAgents' ? 'active' : ''}" data-action="teams-sub-tab" data-sub="freeAgents">
          🙋 Free Agents <span class="sub-tab-count">${STATE.freeAgents.length}</span>
        </button>
      </div>

      ${STATE.teamsSubTab === 'teams' ? renderTeamsSubTab() : renderFreeAgentsSubTab()}
    </div>
  `;
}

function renderTeamsSubTab() {
  return `
    ${admin() ? `
      <div class="teams-add-form">
        <div class="signup-field">
          <label>Division</label>
          <select id="teams-add-div">
            ${Object.values(DIVS).map((d) => `<option value="${d.id}">${d.icon} ${d.name}</option>`).join('')}
          </select>
        </div>

        <div class="signup-field" style="flex:1;">
          <label>Team Name</label>
          <input id="teams-add-name" type="text" placeholder="Enter team name..." maxlength="40">
        </div>

        <button class="btn btn-primary btn-sm" data-action="add-team-from-teams">+ Add Team</button>
      </div>
    ` : ''}

    ${Object.keys(DIVS).map((id) => renderTeamList(STATE.divisions[id], true)).join('')}
  `;
}

function renderTeamList(d, title) {
  const cfg = DIVS[d.id];

  if (d.teams.length === 0) {
    return `
      ${title ? `<div class="section-title">${cfg.icon} ${cfg.name} <span style="font-size:12px;color:var(--text-muted);">(0)</span></div>` : ''}
      <div class="empty-state" style="margin-bottom:24px;">
        <div class="empty-sub">No teams registered yet</div>
      </div>
    `;
  }

  return `
    ${title ? `<div class="section-title">${cfg.icon} ${cfg.name} <span style="font-size:12px;color:var(--text-muted);">(${d.teams.length})</span></div>` : ''}

    <div class="team-list" style="margin-bottom:32px;">
      ${d.teams.map((t, i) => renderTeamCard(d, t, i)).join('')}
    </div>
  `;
}

function renderTeamCard(d, t, i) {
  const cfg = DIVS[d.id];
  const expanded = d.expandedTeamId === t.id;
  const players = t.players || [];
  const mine = TEAM_PORTAL && TEAM_PORTAL.divId === d.id && TEAM_PORTAL.teamId === t.id;
  const canEditRoster = canManageTeam(d.id, t.id);

  return `
    <div class="team-card" ${mine ? 'style="border-color:var(--accent);"' : ''}>
      <div class="team-row" data-action="toggle-roster" data-div="${d.id}" data-team-id="${t.id}" style="cursor:pointer;">
        <div class="team-num">${i + 1}</div>

        <div class="team-name-group" style="flex:1;">
          <span class="team-name">${esc(t.name)} ${mine ? '👁️' : ''}</span>
          <span class="team-roster-count">${players.length}/${cfg.players}</span>
        </div>

        <div class="team-btns">
          ${mine
      ? '<span class="pill pill-ok">Viewing</span>'
      : `<button type="button" class="btn btn-ghost btn-sm" data-action="login-as-team" data-div="${d.id}" data-team-id="${t.id}">👁️ View As</button>`
    }

          ${canManageTeam(d.id, t.id) ? `
            <button type="button" class="btn btn-ghost btn-sm" data-action="edit-team-name" data-div="${d.id}" data-team-id="${t.id}">Edit</button>
          ` : ''}
            <button type="button" class="btn btn-danger btn-sm" data-action="delete-team" data-div="${d.id}" data-team-id="${t.id}">✕</button>

          <span style="color:var(--text-sub);font-size:10px;">${expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      ${expanded ? renderRoster(d, t, canEditRoster) : ''}
    </div>
  `;
}

function renderRoster(d, t, canEdit) {
  const cfg = DIVS[d.id];
  const slots = [];

  for (let i = 0; i < cfg.players; i++) {
    const p = (t.players || [])[i];

    slots.push(`
      <div class="roster-slot ${p ? 'filled' : 'empty'}">
        ${p
        ? `
            <span class="roster-name">${esc(p)}</span>
            ${canEdit ? `<button class="btn btn-ghost btn-xs" data-action="remove-player" data-div="${d.id}" data-team-id="${t.id}" data-player-idx="${i}">✕</button>` : ''}
          `
        : canEdit
          ? `
              <input class="roster-input" id="player-${t.id}-${i}" placeholder="Player ${i + 1} name">
              <button class="btn btn-primary btn-xs" data-action="add-player" data-div="${d.id}" data-team-id="${t.id}" data-player-idx="${i}">Add</button>
            `
          : '<span class="roster-name" style="color:var(--text-muted);">Open slot</span>'
      }
      </div>
    `);
  }

  return `<div class="roster-editor">${slots.join('')}</div>`;
}

function renderFreeAgentsSubTab() {
  return `
    <div class="card" style="margin-bottom:20px;">
      <div class="card-title">🙋 Free Agents</div>
      <div class="card-sub">Sign up here if you want to be matched with a team.</div>
    </div>

    <div class="signup-form">
      <div class="signup-row">
        <div class="signup-field" style="flex:1;">
          <label>Your Name</label>
          <input id="fa-name" type="text" placeholder="Enter your name...">
        </div>

        <div class="signup-field">
          <label>Preferred Format</label>
          <div class="format-check">
            <label><input id="fa-fmt-beginner" type="checkbox"> 🏐 Recreational 3s</label>
            <label><input id="fa-fmt-competitive" type="checkbox"> ⚡ Competitive 2s</label>
          </div>
        </div>

        <button class="btn btn-primary btn-sm" data-action="add-free-agent">🙋 Sign Me Up</button>
      </div>
    </div>

    ${STATE.freeAgents.length === 0
      ? '<div class="empty-state"><div class="empty-title">No free agents yet</div></div>'
      : Object.keys(DIVS).map((id) => {
        const cfg = DIVS[id];
        const list = STATE.freeAgents.filter((fa) => fa.formats.includes(id));

        return `
            <div class="section-title">${cfg.icon} Interested in ${cfg.name} <span style="font-size:12px;color:var(--text-muted);">(${list.length})</span></div>
            <div class="free-agent-list" style="margin-bottom:24px;">
              ${list.map((fa, i) => renderFreeAgent(fa, i)).join('') || '<div class="empty-sub">No one yet</div>'}
            </div>
          `;
      }).join('')
    }
  `;
}

function renderFreeAgent(fa, i) {
  return `
    <div class="free-agent-card">
      <div class="fa-info">
        <div class="fa-num">${i + 1}</div>
        <span class="fa-name">${esc(fa.name)}</span>
        <div class="fa-formats">
          ${fa.formats.map((f) => `<span class="format-badge ${f}">${DIVS[f].icon} ${DIVS[f].name}</span>`).join('')}
        </div>
      </div>

      ${admin() ? `<button class="btn btn-danger btn-xs" data-action="delete-free-agent" data-fa-id="${fa.id}">✕</button>` : ''}
    </div>
  `;
}

function renderQualifying(d) {
  const standings = Tournament.calculateStandings(d.teams, d.qualifyingRounds);

  return `
    <div class="action-bar">
      <div class="action-bar-info">Qualifying · ${DIVS[d.id].name}</div>

      <div class="action-bar-btns">
        ${admin() ? `
          <button class="btn btn-secondary btn-sm" data-action="back-registration" data-div="${d.id}">← Registration</button>
          <button class="btn btn-primary btn-sm" data-action="generate-playoffs" data-div="${d.id}" ${allQualComplete(d) ? '' : 'disabled'}>Generate Playoffs</button>
        ` : ''}
      </div>
    </div>

    ${d.qualifyingRounds.map((r) => `
      <div class="round-block">
        <div class="round-header">
          <span class="round-label">Round ${r.roundNumber}</span>
          <span class="round-status">
            ${r.games.filter((g) => g.complete).length}/${r.games.length} complete${r.byeTeam ? ` · Bye: ${esc(r.byeTeam.name)}` : ''}
          </span>
        </div>

        <div class="games-grid">
          ${r.games.map((g) => renderGame(d, g, 'qual')).join('')}
        </div>
      </div>
    `).join('')}

    <div class="divider"></div>
    ${renderStandings(standings)}
  `;
}

function renderStandings(standings) {
  if (!standings || !standings.length) return '';

  return `
    <div class="section-title">Standings</div>

    <div class="standings-wrap">
      <table class="standings">
        <thead>
          <tr>
            <th>#</th>
            <th>Team</th>
            <th>W</th>
            <th>L</th>
            <th>Diff</th>
            <th>PF</th>
          </tr>
        </thead>

        <tbody>
          ${standings.map((s, i) => `
            <tr>
              <td><span class="rank-circle ${i < 3 ? `r${i + 1}` : ''}">${i + 1}</span></td>
              <td>${esc(s.team.name)}</td>
              <td>${s.wins}</td>
              <td>${s.losses}</td>
              <td>${s.diff}</td>
              <td>${s.pf}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `;
}

function renderPlayoffs(d) {
  if (!d.bracket) {
    return '<div class="empty-state"><div class="empty-title">No bracket generated yet</div></div>';
  }

  const complete = Tournament.isBracketComplete(d.bracket);

  return `
    <div class="action-bar">
      <div class="action-bar-info">Playoffs · ${DIVS[d.id].name}</div>

      <div class="action-bar-btns">
        ${admin() ? `
          <button class="btn btn-secondary btn-sm" data-action="back-qualifying" data-div="${d.id}">← Qualifying</button>
          <button class="btn btn-primary btn-sm" data-action="finish" data-div="${d.id}" ${complete ? '' : 'disabled'}>Finish Tournament</button>
        ` : ''}
      </div>
    </div>

    ${renderBracket(d)}
  `;
}

function renderBracket(d) {
  const b = d.bracket;

  const roundHtml = (round) => `
    <div class="round-block">
      <div class="round-header">
        <span class="round-label">${esc(round.name)}</span>
      </div>

      <div class="games-grid">
        ${round.gameIds.map((id) => renderGame(d, b.gameMap[id], 'bracket')).join('')}
      </div>
    </div>
  `;

  return `
    ${(b.mainRounds || []).map(roundHtml).join('')}
    ${(b.placementRounds || []).map(roundHtml).join('')}

    ${b.extraGames
      ? Object.values(b.extraGames).map((x) => `
          <div class="round-block">
            <div class="round-header">
              <span class="round-label">${esc(x.label)}</span>
            </div>

            <div class="games-grid">
              ${renderGame(d, b.gameMap[x.gameId], 'bracket')}
            </div>
          </div>
        `).join('')
      : ''
    }
  `;
}

function renderComplete(d) {
  const rankings = d.finalRankings && d.finalRankings.length
    ? d.finalRankings
    : Tournament.getFinalRankings(d.bracket, d.teams, d.standings);

  return `
    <div class="card" style="text-align:center;margin-bottom:20px;">
      <div style="font-size:48px;">🎉</div>
      <div class="card-title">Tournament Complete</div>
      <div class="card-sub">${DIVS[d.id].name}</div>
    </div>

    <div class="standings-wrap">
      <table class="standings">
        <thead>
          <tr>
            <th>Place</th>
            <th>Team</th>
          </tr>
        </thead>

        <tbody>
          ${rankings.map((r) => `
            <tr>
              <td><span class="rank-circle ${r.place <= 3 ? `r${r.place}` : ''}">${r.place}</span></td>
              <td>${esc(r.team ? r.team.name : 'TBD')}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>

    ${admin() ? `
      <div style="margin-top:20px;">
        <button class="btn btn-secondary" data-action="back-playoffs" data-div="${d.id}">← Back to Playoffs</button>
        <button class="btn btn-danger" data-action="reset-division" data-div="${d.id}">Reset Division</button>
      </div>
    ` : ''}
  `;
}

function handleScoreDraftInput(e) {
  const input = e.target;

  if (!input.classList.contains('score-input')) return;
  if (!input.id) return;

  SCORE_DRAFTS[input.id] = input.value;
}

function draftValue(inputId) {
  return esc(SCORE_DRAFTS[inputId] ?? '');
}

function clearScoreDraft(prefix, gameId) {
  delete SCORE_DRAFTS[`${prefix}-${gameId}-a`];
  delete SCORE_DRAFTS[`${prefix}-${gameId}-b`];
}

function renderGame(d, g, type) {
  if (!g) return '';

  if (g.isNA) {
    return '<div class="game-card na-card"><div class="gt tbd">Not needed</div></div>';
  }

  if (g.isBye) {
    return `
      <div class="game-card bye-card">
        <div class="gt win">${esc(g.winner ? g.winner.name : 'Bye')}</div>
        <span class="pill pill-warn">Bye</span>
      </div>
    `;
  }

  const prefix = type === 'bracket' ? 'bs' : 'qs';
  const save = type === 'bracket' ? 'save-bracket-score' : 'save-qual-score';
  const edit = type === 'bracket' ? 'edit-bracket-score' : 'edit-qual-score';
  const ready = g.teamA && g.teamB;
  const myGame = TEAM_PORTAL &&
    ((g.teamA && g.teamA.id === TEAM_PORTAL.teamId) ||
      (g.teamB && g.teamB.id === TEAM_PORTAL.teamId));

  const seedA = type === 'bracket' ? seedOf(g.teamA, d.standings) : null;
  const seedB = type === 'bracket' ? seedOf(g.teamB, d.standings) : null;
  const a = g.teamA ? esc(g.teamA.name) : 'TBD';
  const b = g.teamB ? esc(g.teamB.name) : 'TBD';

  if (g.complete) {
    const aWin = g.winner && g.teamA && g.winner.id === g.teamA.id;
    const bWin = g.winner && g.teamB && g.winner.id === g.teamB.id;

    return `
      <div class="game-card done ${myGame ? 'live' : ''}">
        <div class="gt ${aWin ? 'win' : 'loss'}">
          ${seedA ? `<span class="seed-badge">${seedA}</span> ` : ''}${a}
        </div>

        <div class="score-display">
          ${g.scoreA}<span class="score-dash">-</span>${g.scoreB}
        </div>

        <div class="gt ${bWin ? 'win' : 'loss'}" style="text-align:right;">
          ${b}${seedB ? ` <span class="seed-badge">${seedB}</span>` : ''}
        </div>

        ${admin() ? `<button class="btn btn-ghost btn-sm" data-action="${edit}" data-div="${d.id}" data-game-id="${g.id}">Edit</button>` : ''}
      </div>
    `;
  }

  return `
    <div class="game-card ${ready ? '' : 'na-card'} ${myGame ? 'live' : ''}">
      <div class="gt ${g.teamA ? '' : 'tbd'}" title="${a}">
        ${seedA ? `<span class="seed-badge">${seedA}</span> ` : ''}${a}
      </div>

      ${canEnterScores() && ready ? `
        <div class="score-entry">

        <input
          class="score-input"
          id="${prefix}-${g.id}-a"
          type="number"
          min="0"
          max="23"
          placeholder="0"
          value="${draftValue(`${prefix}-${g.id}-a`)}"
        >
        <span class="score-sep">-</span>
        <input
          class="score-input"
          id="${prefix}-${g.id}-b"
          type="number"
          min="0"
          max="23"
          placeholder="0"
          value="${draftValue(`${prefix}-${g.id}-b`)}"
        >
          <button class="btn btn-primary btn-sm" data-action="${save}" data-div="${d.id}" data-game-id="${g.id}">Save</button>
        </div>
      ` : '<span class="score-dash">vs</span>'}

      <div class="gt ${g.teamB ? '' : 'tbd'}" title="${b}" style="text-align:right;">
        ${b}${seedB ? ` <span class="seed-badge">${seedB}</span>` : ''}
      </div>
    </div>
  `;
}

function handleClick(e) {
  const el = e.target.closest('[data-action]');
  if (!el) return;

  e.preventDefault();

  const a = el.dataset.action;
  const divId = el.dataset.div;
  const teamId = el.dataset.teamId;
  const gameId = el.dataset.gameId;
  const faId = el.dataset.faId;

  console.log('Clicked action:', a, { divId, teamId, gameId, faId });

  if (a === 'main-menu') {
    HAS_ENTERED = false;
    ENTRY_MODE = 'start';
    TEAM_PORTAL = null;
    IS_ORGANIZER = false;
    renderApp();
    return;
  }


  if (a === 'entry-back') {
    ENTRY_MODE = 'start';
    renderApp();
    return;
  }

  if (a === 'entry-organizer') {
    HAS_ENTERED = true;
    TEAM_PORTAL = null;
    IS_ORGANIZER = true;
    STATE.activePage = 'division';
    renderApp();
    return;
  }

  if (a === 'entry-register') {
    ENTRY_MODE = 'register';
    REGISTER_DIV_ID = null;
    renderApp();
    return;
  }

  if (a === 'select-register-division') {
    REGISTER_DIV_ID = divId;
    renderApp();

    setTimeout(() => {
      $('entry-team-name')?.focus();
    }, 50);

    return;
  }

  if (a === 'submit-entry-registration') {
    return registerTeamFromEntry(REGISTER_DIV_ID);
  }

  if (a === 'entry-register-division') return registerTeamFromEntry(divId);

  if (a === 'entry-view-team') {
    ENTRY_MODE = 'view-team-picker';
    renderApp();
    return;
  }

  if (a === 'pick-team-from-list') {
    ENTRY_MODE = 'start';
    loginAsTeam(divId, teamId);
    return;
  }

  if (a === 'entry-browse') {
    HAS_ENTERED = true;
    TEAM_PORTAL = null;
    IS_ORGANIZER = false;
    STATE.activePage = 'division';
    renderApp();
    return;
  }

  if (a === 'entry-free-agent') {
    HAS_ENTERED = true;
    TEAM_PORTAL = null;
    IS_ORGANIZER = false;
    STATE.activePage = 'teams';
    STATE.teamsSubTab = 'freeAgents';
    renderApp();
    return;
  }

  if (a === 'tab') {
    STATE.activePage = 'division';
    STATE.activeTab = divId;
    renderApp();
    return;
  }

  if (a === 'tab-teams') {
    STATE.activePage = 'teams';
    renderApp();
    return;
  }

  if (a === 'teams-sub-tab') {
    STATE.teamsSubTab = el.dataset.sub || 'teams';
    renderApp();
    return;
  }

  if (a === 'team-login') return teamLogin(false);

  if (a === 'exit-team-view') {
    TEAM_PORTAL = null;
    IS_ORGANIZER = false;
    toast('Exited team view', 'info');
    renderApp();
    return;
  }

  if (a === 'login-as-team') return loginAsTeam(divId, teamId);
  if (a === 'reset-all') return resetAll();
  if (a === 'reset-division') return resetDivision(divId);
  if (a === 'add-team') return addTeam(divId, 'new-team-name');
  if (a === 'edit-team-name') return editTeamName(divId, teamId);
  if (a === 'add-team-from-teams') return addTeam($('teams-add-div')?.value || 'beginner', 'teams-add-name');
  if (a === 'delete-team') return deleteTeam(divId, teamId);
  if (a === 'clear-teams') return clearTeams(divId);
  if (a === 'set-rounds') return setRounds(divId);
  if (a === 'toggle-roster') return toggleRoster(divId, teamId);
  if (a === 'add-player') return addPlayer(divId, teamId, Number(el.dataset.playerIdx));
  if (a === 'remove-player') return removePlayer(divId, teamId, Number(el.dataset.playerIdx));
  if (a === 'add-free-agent') return addFreeAgent();
  if (a === 'delete-free-agent') return deleteFreeAgent(faId);
  if (a === 'start-tournament') return startTournament(divId);
  if (a === 'back-registration') return backRegistration(divId);
  if (a === 'save-qual-score') return saveQualScore(divId, gameId);
  if (a === 'edit-qual-score') return editQualScore(divId, gameId);
  if (a === 'generate-playoffs') return generatePlayoffs(divId);
  if (a === 'back-qualifying') return backQualifying(divId);
  if (a === 'save-bracket-score') return saveBracketScore(divId, gameId);
  if (a === 'edit-bracket-score') return editBracketScore(divId, gameId);
  if (a === 'finish') return finishTournament(divId);

  if (a === 'back-playoffs') {
    STATE.divisions[divId].phase = 'playoffs';
    saveState();
    renderApp();
    return;
  }

  console.warn('Unhandled action:', a);
}

function handleKeydown(e) {
  if (e.key !== 'Enter') return;

  if (e.target.id === 'entry-team-name') {
    registerTeamFromEntry(REGISTER_DIV_ID);
  }

  if (e.target.id === 'new-team-name') {
    addTeam(STATE.activeTab, 'new-team-name');
  }

  if (e.target.id === 'teams-add-name') {
    addTeam($('teams-add-div')?.value || 'beginner', 'teams-add-name');
  }

  if (e.target.id === 'fa-name') {
    addFreeAgent();
  }
}
function resetAll() {
  if (!admin()) return;

  if (!confirm('Reset the entire tournament? This cannot be undone.')) return;

  TEAM_PORTAL = null;
  IS_ORGANIZER = true;

  STATE = {
    activeTab: 'beginner',
    activePage: 'division',
    teamsSubTab: 'teams',
    freeAgents: [],
    freeAgentIdCounter: 0,
    divisions: {
      beginner: freshDivision('beginner'),
      competitive: freshDivision('competitive'),
    },
  };

  saveState();
  renderApp();
  toast('Tournament reset', 'ok');
}

function resetDivision(divId) {
  if (!admin() || !confirm(`Reset ${DIVS[divId].name}?`)) return;

  STATE.divisions[divId] = freshDivision(divId);

  saveState();
  renderApp();
  toast('Division reset', 'ok');
}

function addTeam(divId, inputId) {
  if (!admin()) return;

  const input = $(inputId);
  const name = input ? input.value.trim() : '';

  if (!name) {
    toast('Enter a team name first', 'err');
    return;
  }

  const d = STATE.divisions[divId];

  if (d.phase !== 'registration') {
    toast('Registration is closed for this division', 'err');
    return;
  }

  if (d.teams.some((t) => t.name.toLowerCase() === name.toLowerCase())) {
    toast('That team name already exists', 'err');
    return;
  }

  d.teams.push({
    id: nextTeamId(d),
    name,
    players: [],
  });

  saveState();
  renderApp();
  toast(`Added ${name}`, 'ok');
}

async function deleteTeam(divId, teamId) {

  const d = STATE.divisions[divId];
  const t = findTeam(divId, teamId);

  if (!t) {
    toast('Team not found', 'err');
    return;
  }

  // Teams should only be able to delete themselves during registration.
  // Organizer can delete later, but it resets the division.
  if (!admin() && d.phase !== 'registration') {
    toast('Teams can only delete themselves during registration', 'err');
    return;
  }

  let message = `Are you sure you want to remove <strong>${esc(t.name)}</strong> from the tournament?`;

  if (admin() && d.phase !== 'registration') {
    message += '<br><br>This will reset this division back to registration so deleted teams are not kept in old games.';
  }

  const confirmed = await customConfirm({
    title: `Delete "${t.name}"?`,
    message,
    confirmText: 'Delete Team',
    icon: '🗑️',
  });

  if (!confirmed) return;

  d.teams = d.teams.filter((x) => String(x.id) !== String(teamId));

  if (admin() && d.phase !== 'registration') {
    resetGeneratedData(d);
  }

  if (d.expandedTeamId === teamId) {
    d.expandedTeamId = null;
  }

  if (TEAM_PORTAL && TEAM_PORTAL.divId === divId && TEAM_PORTAL.teamId === teamId) {
    TEAM_PORTAL = null;
    IS_ORGANIZER = false;
  }

  saveState();
  renderApp();
  toast('Team deleted', 'ok');
}

function editTeamName(divId, teamId) {
  if (!canManageTeam(divId, teamId)) return;

  const d = STATE.divisions[divId];
  const t = findTeam(divId, teamId);

  if (!t) {
    toast('Team not found', 'err');
    return;
  }

  // Teams can rename themselves during registration.
  // Organizer can rename at any point.
  if (!admin() && d.phase !== 'registration') {
    toast('Teams can only edit their name during registration', 'err');
    return;
  }

  const name = prompt('Edit team name:', t.name);

  if (!name || !name.trim()) return;

  const clean = name.trim();

  if (d.teams.some((x) =>
    String(x.id) !== String(teamId) &&
    x.name.toLowerCase() === clean.toLowerCase()
  )) {
    toast('That team name already exists', 'err');
    return;
  }

  t.name = clean;

  if (TEAM_PORTAL && TEAM_PORTAL.divId === divId && TEAM_PORTAL.teamId === teamId) {
    TEAM_PORTAL.teamName = clean;
  }

  saveState();
  renderApp();
  toast('Team name updated', 'ok');
}

function clearTeams(divId) {
  if (!admin() || !confirm(`Remove all teams from ${DIVS[divId].name}?`)) return;

  STATE.divisions[divId] = freshDivision(divId);

  saveState();
  renderApp();
  toast('Teams cleared', 'ok');
}

function setRounds(divId) {
  if (!admin()) return;

  const n = Math.max(1, Math.min(10, Number($('qual-round-count')?.value) || 3));
  STATE.divisions[divId].qualifyingRoundsCount = n;

  saveState();
  renderApp();
  toast(`Rounds set to ${n}`, 'ok');
}

function toggleRoster(divId, teamId) {
  const d = STATE.divisions[divId];
  d.expandedTeamId = d.expandedTeamId === teamId ? null : teamId;
  renderApp();
}

function addPlayer(divId, teamId, idx) {
  const t = findTeam(divId, teamId);
  const canEdit = admin() || (TEAM_PORTAL && TEAM_PORTAL.divId === divId && TEAM_PORTAL.teamId === teamId);

  if (!t || !canEdit) return;

  const name = $(`player-${teamId}-${idx}`)?.value.trim();

  if (!name) return;

  t.players[idx] = name;
  t.players = t.players.filter(Boolean);

  saveState();
  renderApp();
  toast('Player added', 'ok');
}

function removePlayer(divId, teamId, idx) {
  const t = findTeam(divId, teamId);
  const canEdit = admin() || (TEAM_PORTAL && TEAM_PORTAL.divId === divId && TEAM_PORTAL.teamId === teamId);

  if (!t || !canEdit) return;

  t.players.splice(idx, 1);

  saveState();
  renderApp();
  toast('Player removed', 'ok');
}

function addFreeAgent() {
  const name = $('fa-name')?.value.trim();
  const formats = [];

  if ($('fa-fmt-beginner')?.checked) formats.push('beginner');
  if ($('fa-fmt-competitive')?.checked) formats.push('competitive');

  if (!name) {
    toast('Enter your name first', 'err');
    return;
  }

  if (!formats.length) {
    toast('Select at least one format', 'err');
    return;
  }

  STATE.freeAgents.push({
    id: nextFreeAgentId(),
    name,
    formats,
  });

  saveState();
  renderApp();
  toast('Free agent added', 'ok');
}

function deleteFreeAgent(faId) {
  if (!admin() || !confirm('Remove this free agent?')) return;

  STATE.freeAgents = STATE.freeAgents.filter((fa) => String(fa.id) !== String(faId));

  saveState();
  renderApp();
  toast('Free agent removed', 'ok');
}

function allTeams() {
  return Object.keys(STATE.divisions).flatMap((divId) =>
    STATE.divisions[divId].teams.map((team) => ({ divId, team })),
  );
}

function teamLogin(fromEntry) {
  if (TEAM_PORTAL && !fromEntry) {
    TEAM_PORTAL = null;
    IS_ORGANIZER = false;
    toast('Exited team view', 'info');
    renderApp();
    return;
  }

  if (!allTeams().length) {
    toast('No teams are registered yet', 'err');
    return;
  }

  const q = prompt('Enter your team name:');

  if (!q || !q.trim()) return;

  const text = q.trim().toLowerCase();

  let matches = allTeams().filter(({ team }) => team.name.toLowerCase() === text);

  if (!matches.length) {
    matches = allTeams().filter(({ team }) => team.name.toLowerCase().includes(text));
  }

  if (matches.length === 1) {
    loginAsTeam(matches[0].divId, matches[0].team.id);
    return;
  }

  if (matches.length > 1) {
    toast('Multiple teams match. Type the full team name.', 'err');
    return;
  }

  toast('Team not found. Check spelling.', 'err');
}

function loginAsTeam(divId, teamId) {
  const t = findTeam(divId, teamId);

  if (!t) return;

  TEAM_PORTAL = {
    divId,
    teamId: t.id,
    teamName: t.name,
  };

  IS_ORGANIZER = false;
  HAS_ENTERED = true;
  STATE.activePage = 'division';
  STATE.activeTab = divId;

  renderApp();
  toast(`Viewing as ${t.name}`, 'ok');
}

function registerTeamFromEntry(divId) {
  if (!divId || !DIVS[divId]) {
    toast('Select a division first', 'err');
    return;
  }

  const d = STATE.divisions[divId];

  if (!d) {
    toast('Division not found', 'err');
    return;
  }

  if (d.phase !== 'registration') {
    toast('Registration is closed', 'err');
    return;
  }

  const input = $('entry-team-name');
  const clean = input ? input.value.trim() : '';

  if (!clean) {
    toast('Enter your team name first', 'err');
    input?.focus();
    return;
  }

  if (d.teams.some((t) => t.name.toLowerCase() === clean.toLowerCase())) {
    toast('That team already exists', 'err');
    input?.focus();
    return;
  }

  const t = {
    id: nextTeamId(d),
    name: clean,
    players: [],
  };

  d.teams.push(t);
  d.expandedTeamId = t.id;

  TEAM_PORTAL = {
    divId,
    teamId: t.id,
    teamName: t.name,
  };

  IS_ORGANIZER = false;
  HAS_ENTERED = true;
  ENTRY_MODE = 'start';
  REGISTER_DIV_ID = null;

  STATE.activePage = 'division';
  STATE.activeTab = divId;

  renderApp();
  toast(`Registered ${t.name}`, 'ok');

  saveState();
}

function startTournament(divId) {
  if (!admin()) return;

  const d = STATE.divisions[divId];

  if (d.teams.length < 2) {
    toast('Need at least 2 teams', 'err');
    return;
  }

  d.phase = 'qualifying';
  d.qualifyingRounds = Tournament.generateQualifyingRounds(d.teams, d.qualifyingRoundsCount || 3);
  d.standings = [];
  d.bracket = null;
  d.finalRankings = [];

  saveState();
  renderApp();
  toast('Tournament started', 'ok');
}

function backRegistration(divId) {
  if (!admin() || !confirm('Go back to registration? Scores and bracket will be cleared.')) return;

  resetGeneratedData(STATE.divisions[divId]);

  saveState();
  renderApp();
}

function saveQualScore(divId, gameId) {
  if (!canEnterScores()) return;

  const d = STATE.divisions[divId];
  const a = Number($(`qs-${gameId}-a`)?.value);
  const b = Number($(`qs-${gameId}-b`)?.value);
  const err = Tournament.validateScore(a, b);

  if (err) {
    toast(err, 'err');
    return;
  }

  for (const r of d.qualifyingRounds) {
    const g = r.games.find((x) => x.id === gameId);

    if (g) {
      g.scoreA = a;
      g.scoreB = b;
      g.complete = true;
      g.winner = a > b ? g.teamA : g.teamB;
      g.loser = a > b ? g.teamB : g.teamA;
      break;
    }
  }
  clearScoreDraft('qs', gameId);

  saveState();
  renderApp();
  toast('Score saved', 'ok');
}

function editQualScore(divId, gameId) {
  if (!admin()) return;

  const d = STATE.divisions[divId];

  for (const r of d.qualifyingRounds) {
    const g = r.games.find((x) => x.id === gameId);

    if (g) {
      g.scoreA = null;
      g.scoreB = null;
      g.complete = false;
      g.winner = null;
      g.loser = null;
      break;
    }
  }

  saveState();
  renderApp();
}

function generatePlayoffs(divId) {
  if (!admin()) return;

  const d = STATE.divisions[divId];

  if (!allQualComplete(d)) {
    toast('Complete all qualifying games first', 'err');
    return;
  }

  d.standings = Tournament.calculateStandings(d.teams, d.qualifyingRounds);
  d.bracket = Tournament.generateBracket(d.standings);
  d.phase = 'playoffs';

  saveState();
  renderApp();
  toast('Playoffs generated', 'ok');
}

function backQualifying(divId) {
  if (!admin() || !confirm('Go back to qualifying? Playoff scores will be cleared.')) return;

  const d = STATE.divisions[divId];
  d.phase = 'qualifying';
  d.bracket = null;
  d.finalRankings = [];

  saveState();
  renderApp();
}

function saveBracketScore(divId, gameId) {
  if (!canEnterScores()) return;

  const d = STATE.divisions[divId];
  const a = Number($(`bs-${gameId}-a`)?.value);
  const b = Number($(`bs-${gameId}-b`)?.value);
  const err = Tournament.validateScore(a, b);

  if (err) {
    toast(err, 'err');
    return;
  }

  if (!Tournament.submitBracketScore(d.bracket, gameId, a, b)) {
    toast('Could not save score', 'err');
    return;
  }

  saveState();
  renderApp();
  toast('Score saved', 'ok');
}

function editBracketScore(divId, gameId) {
  if (!admin() || !confirm('Clear this score? Downstream bracket results will also be cleared.')) return;

  Tournament.resetBracketGame(STATE.divisions[divId].bracket, gameId);

  saveState();
  renderApp();
  toast('Score cleared', 'info');
}

function finishTournament(divId) {
  if (!admin()) return;

  const d = STATE.divisions[divId];

  if (!Tournament.isBracketComplete(d.bracket)) {
    toast('All playoff games must be complete first', 'err');
    return;
  }

  d.finalRankings = Tournament.getFinalRankings(d.bracket, d.teams, d.standings);
  d.phase = 'complete';

  saveState();
  renderApp();
  toast('Tournament complete', 'ok');
}

document.addEventListener('DOMContentLoaded', () => {
  initFirebase();
  loadState();

  document.addEventListener('click', handleClick);
  document.addEventListener('keydown', handleKeydown);
  document.addEventListener('input', handleScoreDraftInput);
});