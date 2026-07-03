/* =========================================================
   tournament.js — Pure logic, no DOM
   ========================================================= */

'use strict';

const Tournament = (() => {

  /* ── Utility ───────────────────────────────────────────── */

  function shuffle(arr) {
    const a = [...arr];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* ── Qualifying Round Generation ───────────────────────── */

  function generateQualifyingRounds(teams, numRounds = 3) {
    if (teams.length < 2) return [];

    const rounds = [];
    const used   = new Set();
    const byes   = {};
    teams.forEach(t => { byes[t.id] = 0; });

    for (let r = 0; r < numRounds; r++) {
      const isOdd = teams.length % 2 === 1;
      let bestPairings = null, bestBye = null, bestDupe = Infinity;

      for (let attempt = 0; attempt < 400; attempt++) {
        let pool = shuffle(teams);
        let byeTeam = null;

        if (isOdd) {
          const minByes = Math.min(...pool.map(t => byes[t.id]));
          const cands   = pool.filter(t => byes[t.id] === minByes);
          byeTeam = shuffle(cands)[0];
          pool    = pool.filter(t => t.id !== byeTeam.id);
        }

        const pairs = [];
        for (let i = 0; i < pool.length; i += 2) pairs.push([pool[i], pool[i + 1]]);

        const dupes = pairs.filter(([a, b]) => used.has(mk(a, b))).length;
        if (dupes < bestDupe) {
          bestDupe = dupes; bestPairings = pairs; bestBye = byeTeam;
          if (dupes === 0) break;
        }
      }

      bestPairings.forEach(([a, b]) => used.add(mk(a, b)));
      if (bestBye) byes[bestBye.id]++;

      rounds.push({
        id: `round_${r}`,
        roundNumber: r + 1,
        byeTeam: bestBye || null,
        games: bestPairings.map(([a, b], i) => mkQGame(`r${r}g${i}`, a, b)),
      });
    }

    return rounds;
  }

  function mk(a, b) { return [a.id, b.id].sort().join('|'); }

  function mkQGame(id, teamA, teamB) {
    return { id, teamA, teamB, scoreA: null, scoreB: null, complete: false, winner: null, loser: null };
  }

  /* ── Standings Calculation ─────────────────────────────── */

  function calculateStandings(teams, rounds) {
    const s = {};
    teams.forEach(t => { s[t.id] = { team: t, wins: 0, losses: 0, diff: 0, pf: 0, played: 0, h2h: {} }; });

    for (const round of rounds) {
      for (const g of round.games) {
        if (!g.complete || g.scoreA == null) continue;
        const a = s[g.teamA.id], b = s[g.teamB.id];
        if (!a || !b) continue;
        a.pf += g.scoreA; a.diff += g.scoreA - g.scoreB; a.played++;
        b.pf += g.scoreB; b.diff += g.scoreB - g.scoreA; b.played++;
        if (!a.h2h[b.team.id]) a.h2h[b.team.id] = { w: 0, l: 0 };
        if (!b.h2h[a.team.id]) b.h2h[a.team.id] = { w: 0, l: 0 };
        if (g.scoreA > g.scoreB) {
          a.wins++; b.losses++; a.h2h[b.team.id].w++; b.h2h[a.team.id].l++;
        } else {
          b.wins++; a.losses++; b.h2h[a.team.id].w++; a.h2h[b.team.id].l++;
        }
      }
    }

    const list = Object.values(s);
    list.forEach(e => { e._r = Math.random(); });
    list.sort((a, b) => {
      if (b.wins !== a.wins) return b.wins - a.wins;
      if (b.diff !== a.diff) return b.diff - a.diff;
      if (b.pf   !== a.pf  ) return b.pf   - a.pf;
      const h = a.h2h[b.team.id];
      if (h && h.w !== h.l) return h.w > h.l ? -1 : 1;
      return a._r - b._r;
    });
    return list;
  }

  /* ── Bracket Building Blocks ───────────────────────────── */

  function mkGame(id, teamA = null, teamB = null) {
    return {
      id, teamA, teamB,
      scoreA: null, scoreB: null,
      complete: false,
      isBye:   false,   // won by a forfeit/auto-advance (other slot is permanently empty)
      isNA:    false,   // both slots permanently empty — game will never be played
      winner: null, loser: null,
      teamANA: false,   // teamA slot is permanently absent (no team will ever fill it)
      teamBNA: false,   // teamB slot is permanently absent
    };
  }

  /**
   * Mark a specific slot in a game as permanently absent (no team will ever
   * arrive here because the feeder game was itself a bye/NA).
   * Propagates downstream if both slots become permanently absent.
   */
  function markSlotNA(bracket, gameId, slot) {
    const g = bracket.gameMap[gameId];
    if (!g || g.complete || g.isNA) return;

    if (slot === 'A') g.teamANA = true; else g.teamBNA = true;

    if (g.teamANA && g.teamBNA) {
      // Both slots permanently empty → this game will never be played
      g.isNA = true; g.complete = true;
      // Cascade NA downstream
      const adv = bracket.advancement[g.id];
      if (adv) {
        if (adv.winner) markSlotNA(bracket, adv.winner.game, adv.winner.slot);
        if (adv.loser)  markSlotNA(bracket, adv.loser.game,  adv.loser.slot);
      }
    } else {
      // One slot is NA. If the other slot has a team, auto-advance them!
      const present = slot === 'A' ? g.teamB : g.teamA;
      if (present) {
        g.winner = present; g.isBye = true; g.complete = true;
        advance(bracket, g.id, present, null);
      }
    }
  }

  /**
   * Advance winner and loser from a completed game into their next slots.
   *
   * KEY RULE — null slot ≠ permanently absent:
   *   A slot being null just means we're waiting for the feeder game to finish.
   *   We only treat a game as a "bye" when the other slot is flagged teamANA/teamBNA.
   *
   * This prevents the bug where, e.g., seed-1 wins QF1 and gets auto-advanced
   * through SF1 (whose teamB slot is null while QF2 is still pending).
   */
  function advance(bracket, gameId, winner, loser) {
    const adv = bracket.advancement[gameId];
    if (!adv) return;

    // ── Winner slot ──
    if (adv.winner && winner) {
      const g = bracket.gameMap[adv.winner.game];
      if (g && !g.complete && !g.isNA) {
        if (adv.winner.slot === 'A') g.teamA = winner;
        else                         g.teamB = winner;

        // Only auto-advance if the OTHER slot is PERMANENTLY absent
        const otherNA = adv.winner.slot === 'A' ? g.teamBNA : g.teamANA;
        if (otherNA) {
          g.winner = winner; g.isBye = true; g.complete = true;
          advance(bracket, g.id, winner, null);
        }
        // Otherwise: game waits for the other team — stays pending
      }
    }

    // ── Loser slot ──
    if (adv.loser) {
      if (loser) {
        const g = bracket.gameMap[adv.loser.game];
        if (g && !g.complete && !g.isNA) {
          if (adv.loser.slot === 'A') g.teamA = loser;
          else                        g.teamB = loser;

          const otherNA = adv.loser.slot === 'A' ? g.teamBNA : g.teamANA;
          if (otherNA) {
            g.winner = loser; g.isBye = true; g.complete = true;
            advance(bracket, g.id, loser, null);
          }
        }
      } else {
        // No loser (this game was itself a bye) → permanently mark that slot as absent
        markSlotNA(bracket, adv.loser.game, adv.loser.slot);
        // If the other slot already has a real team, this game can now auto-advance them
        const g = bracket.gameMap[adv.loser.game];
        if (g && !g.isNA && !g.complete) {
          const present = adv.loser.slot === 'A' ? g.teamB : g.teamA;
          if (present) {
            g.winner = present; g.isBye = true; g.complete = true;
            advance(bracket, g.id, present, null);
          }
        }
      }
    }
  }

  /* ── Bracket Generation ────────────────────────────────── */

  function generateBracket(standings) {
    const seeds = standings.map(s => s.team);
    const n     = seeds.length;
    const s     = i => seeds[i] || null;

    let bracket;

    /* ── 2-team: just a final ── */
    if (n <= 2) {
      const fin = mkGame('final_1', s(0), s(1));
      // If somehow only 1 team made it, auto-win
      if (fin.teamA && !fin.teamB) { fin.winner = fin.teamA; fin.isBye = true; fin.complete = true; }
      bracket = {
        gameMap: { final_1: fin },
        mainRounds:      [{ name: 'Final', type: 'final', gameIds: ['final_1'] }],
        placementRounds: [],
        extraGames:      {},
        advancement:     {},
        seeds,
      };

    /* ── 3–4 teams: Semis + Final + 3rd ── */
    } else if (n <= 4) {
      const sf1   = mkGame('sf_1', s(0), s(3)); // 1 v 4
      const sf2   = mkGame('sf_2', s(1), s(2)); // 2 v 3
      const fin   = mkGame('final_1');
      const third = mkGame('third_place');

      bracket = {
        gameMap:     { sf_1: sf1, sf_2: sf2, final_1: fin, third_place: third },
        mainRounds:  [
          { name: 'Semifinals',   type: 'semifinal', gameIds: ['sf_1', 'sf_2'] },
          { name: 'Championship', type: 'final',     gameIds: ['final_1'] },
        ],
        placementRounds: [],
        extraGames: { third_place: { label: '🥉 3rd Place Game', gameId: 'third_place' } },
        advancement: {
          sf_1: { winner: { game: 'final_1',     slot: 'A' }, loser: { game: 'third_place', slot: 'A' } },
          sf_2: { winner: { game: 'final_1',     slot: 'B' }, loser: { game: 'third_place', slot: 'B' } },
        },
        seeds,
      };

      // Handle permanent byes for n=3 (sf_1 is 1 v null)
      ['sf_1', 'sf_2'].forEach(gid => {
        const g = bracket.gameMap[gid];
        if      (g.teamA && !g.teamB) { g.winner = g.teamA; g.isBye = true; g.complete = true; }
        else if (!g.teamA && g.teamB) { g.winner = g.teamB; g.isBye = true; g.complete = true; }
      });
      ['sf_1', 'sf_2'].forEach(gid => {
        const g = bracket.gameMap[gid];
        if (g.isBye) advance(bracket, gid, g.winner, null);
      });

    /* ── 5–8+ teams: Full 8-team bracket with byes ── */
    } else {
      // Seeding: QF1 = 1v8, QF2 = 4v5, QF3 = 2v7, QF4 = 3v6
      // SF1 = QF1w vs QF2w | SF2 = QF3w vs QF4w
      const qf1  = mkGame('qf_1', s(0), s(7)); // 1 v 8
      const qf2  = mkGame('qf_2', s(3), s(4)); // 4 v 5
      const qf3  = mkGame('qf_3', s(1), s(6)); // 2 v 7
      const qf4  = mkGame('qf_4', s(2), s(5)); // 3 v 6
      const sf1  = mkGame('sf_1');
      const sf2  = mkGame('sf_2');
      const fin  = mkGame('final_1');
      const th   = mkGame('third_place');
      const p5s1 = mkGame('p5sf_1');
      const p5s2 = mkGame('p5sf_2');
      const p5   = mkGame('place_5');
      const p7   = mkGame('place_7');

      bracket = {
        gameMap: {
          qf_1: qf1, qf_2: qf2, qf_3: qf3, qf_4: qf4,
          sf_1: sf1, sf_2: sf2, final_1: fin, third_place: th,
          p5sf_1: p5s1, p5sf_2: p5s2, place_5: p5, place_7: p7,
        },
        mainRounds: [
          { name: 'Quarterfinals', type: 'quarterfinal', gameIds: ['qf_1','qf_2','qf_3','qf_4'] },
          { name: 'Semifinals',    type: 'semifinal',    gameIds: ['sf_1','sf_2'] },
          { name: 'Championship',  type: 'final',        gameIds: ['final_1'] },
        ],
        placementRounds: [
          { name: '5th–8th Semifinals',    type: 'p5semi', gameIds: ['p5sf_1','p5sf_2'] },
          { name: '5th & 7th Place Games', type: 'p5fin',  gameIds: ['place_5','place_7'] },
        ],
        extraGames: { third_place: { label: '🥉 3rd Place Game', gameId: 'third_place' } },
        advancement: {
          sf_1:   { winner: { game: 'final_1',     slot: 'A' }, loser: { game: 'third_place', slot: 'A' } },
          sf_2:   { winner: { game: 'final_1',     slot: 'B' }, loser: { game: 'third_place', slot: 'B' } },
          p5sf_1: { winner: { game: 'place_5',     slot: 'A' }, loser: { game: 'place_7', slot: 'A' } },
          p5sf_2: { winner: { game: 'place_5',     slot: 'B' }, loser: { game: 'place_7', slot: 'B' } },
        },
        seeds,
      };

      // Mark QF byes (for < 8 teams, some seeds don't exist)
      ['qf_1','qf_2','qf_3','qf_4'].forEach(gid => {
        const g = bracket.gameMap[gid];
        if      (g.teamA && !g.teamB) { g.winner = g.teamA; g.isBye = true; g.complete = true; }
        else if (!g.teamA && g.teamB) { g.winner = g.teamB; g.isBye = true; g.complete = true; }
      });
    }

    return bracket;
  }

  /* ── Dynamic Re-seeding ────────────────────────────────── */

  function clearGame(g) {
    g.teamA = null;
    g.teamB = null;
    g.scoreA = null;
    g.scoreB = null;
    g.complete = false;
    g.isBye = false;
    g.isNA = false;
    g.winner = null;
    g.loser = null;
    g.teamANA = false;
    g.teamBNA = false;
  }

  function resetDownstreamFromQuarterfinals(bracket) {
    const intermediateGames = ['sf_1', 'sf_2', 'p5sf_1', 'p5sf_2'];
    intermediateGames.forEach(gid => {
      const g = bracket.gameMap[gid];
      if (g) clearGame(g);
    });

    const finalGames = ['final_1', 'third_place', 'place_5', 'place_7'];
    finalGames.forEach(gid => {
      const g = bracket.gameMap[gid];
      if (g) clearGame(g);
    });
  }

  function checkAndAdvanceBye(bracket, gameId) {
    const g = bracket.gameMap[gameId];
    if (!g || g.complete || g.isNA) return;

    if (g.teamANA && g.teamBNA) {
      g.isNA = true;
      g.complete = true;
      const adv = bracket.advancement[gameId];
      if (adv) {
        if (adv.winner) markSlotNA(bracket, adv.winner.game, adv.winner.slot);
        if (adv.loser)  markSlotNA(bracket, adv.loser.game,  adv.loser.slot);
      }
    } else if (g.teamA && g.teamBNA) {
      g.winner = g.teamA;
      g.isBye = true;
      g.complete = true;
      advance(bracket, g.id, g.teamA, null);
    } else if (g.teamB && g.teamANA) {
      g.winner = g.teamB;
      g.isBye = true;
      g.complete = true;
      advance(bracket, g.id, g.teamB, null);
    }
  }

  function reseedQuarterfinals(bracket) {
    const qfs = ['qf_1', 'qf_2', 'qf_3', 'qf_4'].map(id => bracket.gameMap[id]);
    
    // Sort winners and losers by original seed
    const getTeamSeedIndex = (team) => {
      if (!team) return Infinity;
      return bracket.seeds.findIndex(t => t.id === team.id);
    };

    const winners = qfs.map(g => g.winner).filter(Boolean);
    const losers = qfs.map(g => g.loser);

    winners.sort((a, b) => getTeamSeedIndex(a) - getTeamSeedIndex(b));
    losers.sort((a, b) => getTeamSeedIndex(a) - getTeamSeedIndex(b));

    // Assign to Semifinals
    const sf1 = bracket.gameMap['sf_1'];
    const sf2 = bracket.gameMap['sf_2'];
    if (sf1) {
      sf1.teamA = winners[0] || null;
      sf1.teamB = winners[3] || null;
      sf1.teamANA = !winners[0];
      sf1.teamBNA = !winners[3];
    }
    if (sf2) {
      sf2.teamA = winners[1] || null;
      sf2.teamB = winners[2] || null;
      sf2.teamANA = !winners[1];
      sf2.teamBNA = !winners[2];
    }

    // Assign to Placement Semifinals
    const p5sf1 = bracket.gameMap['p5sf_1'];
    const p5sf2 = bracket.gameMap['p5sf_2'];
    if (p5sf1) {
      p5sf1.teamA = losers[0] || null;
      p5sf1.teamB = losers[3] || null;
      p5sf1.teamANA = !losers[0];
      p5sf1.teamBNA = !losers[3];
    }
    if (p5sf2) {
      p5sf2.teamA = losers[1] || null;
      p5sf2.teamB = losers[2] || null;
      p5sf2.teamANA = !losers[1];
      p5sf2.teamBNA = !losers[2];
    }

    // Run dynamic bye propagation on the 4 games
    ['sf_1', 'sf_2', 'p5sf_1', 'p5sf_2'].forEach(gid => {
      checkAndAdvanceBye(bracket, gid);
    });
  }

  /* ── Score Submission ──────────────────────────────────── */

  function submitBracketScore(bracket, gameId, scoreA, scoreB) {
    const game = bracket.gameMap[gameId];
    if (!game || game.isBye || game.isNA || game.complete) return false;
    game.scoreA   = scoreA;
    game.scoreB   = scoreB;
    game.complete = true;
    game.winner   = scoreA > scoreB ? game.teamA : game.teamB;
    game.loser    = scoreA > scoreB ? game.teamB : game.teamA;

    if (['qf_1', 'qf_2', 'qf_3', 'qf_4'].includes(gameId)) {
      const qfs = ['qf_1', 'qf_2', 'qf_3', 'qf_4'].map(id => bracket.gameMap[id]);
      const allComplete = qfs.every(g => g.complete || g.isNA);
      if (allComplete) {
        reseedQuarterfinals(bracket);
      }
    } else {
      advance(bracket, gameId, game.winner, game.loser);
    }
    return true;
  }

  /* ── Completion Check ──────────────────────────────────── */

  function isBracketComplete(bracket) {
    if (!bracket || !bracket.gameMap) return false;
    return Object.values(bracket.gameMap).every(g => g.complete || g.isNA);
  }

  /* ── Final Rankings ────────────────────────────────────── */

  function getFinalRankings(bracket, allTeams, standings) {
    if (!bracket || !bracket.gameMap) return [];
    const gm     = bracket.gameMap;
    const result = [];
    const placed = new Set();

    function add(place, team) {
      if (team && !placed.has(team.id)) { result.push({ place, team }); placed.add(team.id); }
    }

    const fin   = gm['final_1'];
    const third = gm['third_place'];
    const p5    = gm['place_5'];
    const p7    = gm['place_7'];

    if (fin?.complete   && !fin.isNA)   { add(1, fin.winner);   add(2, fin.loser); }
    if (third?.complete && !third.isNA) {
      add(3, third.winner);
      if (!third.isBye) add(4, third.loser);
    }
    if (p5?.complete && !p5.isNA) {
      add(5, p5.winner);
      if (!p5.isBye) add(6, p5.loser);
    }
    if (p7?.complete && !p7.isNA) {
      add(7, p7.winner);
      if (!p7.isBye) add(8, p7.loser);
    }

    // Any teams seeded 9+ (not in bracket) — ranked by qualifying standing
    let nextPlace = (result[result.length - 1]?.place ?? 0) + 1;
    if (standings) {
      for (const entry of standings) {
        if (!placed.has(entry.team.id)) add(nextPlace++, entry.team);
      }
    }

    return result.sort((a, b) => a.place - b.place);
  }

  /* ── Bracket Score Edit (cascade reset) ───────────────── */

  function resetBracketGame(bracket, gameId) {
    const game = bracket.gameMap[gameId];
    if (!game || game.isBye || game.isNA) return;

    if (['qf_1', 'qf_2', 'qf_3', 'qf_4'].includes(gameId)) {
      resetDownstreamFromQuarterfinals(bracket);
    } else {
      // Clear downstream slots fed by this game's result
      const adv = bracket.advancement[gameId];
      if (adv) {
        if (adv.winner) _clearSlot(bracket, adv.winner.game, adv.winner.slot);
        if (adv.loser && game.loser) _clearSlot(bracket, adv.loser.game, adv.loser.slot);
      }
    }

    game.scoreA = null; game.scoreB = null;
    game.complete = false; game.winner = null; game.loser = null;
  }

  function _clearSlot(bracket, gameId, slot) {
    const g = bracket.gameMap[gameId];
    if (!g || g.isNA) return;
    const wasBye      = g.isBye;
    const wasComplete = g.complete;
    if (slot === 'A') g.teamA = null; else g.teamB = null;
    if (wasBye) { g.isBye = false; g.complete = false; g.winner = null; g.loser = null; }
    else if (wasComplete) { resetBracketGame(bracket, gameId); }
  }

  /* ── Score Validation ──────────────────────────────────── */

  function validateScore(sA, sB) {
    if (isNaN(sA) || isNaN(sB)) return 'Enter scores for both teams.';
    if (sA < 0 || sB < 0)       return 'Scores must be 0 or higher.';
    if (sA === sB)             return 'Scores cannot be tied — one team must win.';

    const w = Math.max(sA, sB);
    const l = Math.min(sA, sB);

    // winByTwo rule (cap 23)
    if (w > 23) return 'Maximum score is 23.';
    if (w < 21) return 'The winning score must be at least 21.';

    // Check possible final scores:
    // - w is 21: l must be <= 19
    // - w is 22: l must be 20
    // - w is 23: l must be 21 or 22
    if (w === 21 && l > 19) {
      return `At 21, the opponent score must be 19 or less. If the score was 20-20, you must win by 2 (e.g. 22-20 or 23-21/23-22).`;
    }
    if (w === 22 && l !== 20) {
      return `A score of 22 is only valid as 22-20. For other scores, the game would have ended at 21 (e.g. 21-19) or must go to cap (e.g. 23-21 or 23-22).`;
    }
    if (w === 23 && l < 21) {
      return `A score of 23 is only valid as 23-21 or 23-22. For other scores, the game would have ended earlier (e.g. 21-${l} or 22-20).`;
    }
    return null;
  }

  /* ── Public API ────────────────────────────────────────── */

  return {
    generateQualifyingRounds,
    calculateStandings,
    generateBracket,
    submitBracketScore,
    isBracketComplete,
    getFinalRankings,
    resetBracketGame,
    validateScore,
  };

})();

