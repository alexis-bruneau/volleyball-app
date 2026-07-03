// test.js — Quick sanity check for tournament.js logic
const fs = require('fs');
// Append module.exports so we can require it in Node
const src = fs.readFileSync('tournament.js', 'utf8') + '\nmodule.exports = Tournament;';
const tmpFile = require('os').tmpdir() + '/tournament_test.js';
fs.writeFileSync(tmpFile, src);
const Tournament = require(tmpFile);

const teams = ['A','B','C','D','E','F','G','H'].map((n,i) => ({ id: 't'+i, name: n }));

// ── Test 1: Qualifying rounds
const rounds = Tournament.generateQualifyingRounds(teams, 3);
console.assert(rounds.length === 3, 'Should produce 3 rounds');
rounds.forEach(r => {
  const names = r.games.flatMap(g => [g.teamA.name, g.teamB.name]);
  const unique = new Set(names);
  console.assert(unique.size === teams.length, `Round ${r.roundNumber}: all teams should appear once`);
});
const seen = new Set(); let dupes = 0;
rounds.forEach(r => r.games.forEach(g => {
  const key = [g.teamA.id, g.teamB.id].sort().join('|');
  if (seen.has(key)) dupes++;
  seen.add(key);
}));
console.log(`[1] Qualifying: 3 rounds OK. Duplicate matchups: ${dupes} (ideal=0)`);

// ── Test 2: Standings
rounds.forEach(r => r.games.forEach(g => {
  g.scoreA = 21; g.scoreB = 15; g.complete = true;
  g.winner = g.teamA; g.loser = g.teamB;
}));
const standings = Tournament.calculateStandings(teams, rounds);
console.assert(standings.length === teams.length, 'Standings should include all teams');
console.log(`[2] Standings: ${standings.length} teams. Top: ${standings[0].team.name} (${standings[0].wins}W)`);

// ── Test 3: 8-team bracket
const bracket = Tournament.generateBracket(standings);
const gm = bracket.gameMap;
console.assert(gm['qf_1'] && gm['sf_1'] && gm['final_1'], 'Bracket should have QF, SF, Final');
console.assert(gm['place_5'] && gm['place_7'], 'Bracket should have placement games');
const qf1 = gm['qf_1'];
const qf1Seed = standings.findIndex(s => s.team.id === qf1.teamA.id) + 1;
console.assert(qf1Seed === 1, `QF1 team A should be seed 1, got ${qf1Seed}`);
console.log(`[3] 8-team bracket: QF1 = ${qf1.teamA.name}(#1) vs ${qf1.teamB.name}(#8). OK`);

// ── Test 4: Bracket complete check (initially false)
console.assert(!Tournament.isBracketComplete(bracket), 'Bracket should not be complete initially');
console.log(`[4] isBracketComplete(fresh) = false. OK`);

// ── Test 5: Score all games and check completion
function scoreGame(bracket, gameId, sA, sB) {
  const g = bracket.gameMap[gameId];
  if (!g || g.isBye || g.isNA || g.complete) return;
  Tournament.submitBracketScore(bracket, gameId, sA, sB);
}
// Score QFs
scoreGame(bracket, 'qf_1', 21, 15);
scoreGame(bracket, 'qf_2', 21, 17);
scoreGame(bracket, 'qf_3', 21, 14);
scoreGame(bracket, 'qf_4', 21, 18);
// Score SFs
scoreGame(bracket, 'sf_1', 21, 16);
scoreGame(bracket, 'sf_2', 21, 13);
// Score Finals / placement
scoreGame(bracket, 'final_1', 21, 19);
scoreGame(bracket, 'third_place', 21, 12);
scoreGame(bracket, 'p5sf_1', 21, 10);
scoreGame(bracket, 'p5sf_2', 21, 11);
scoreGame(bracket, 'place_5', 21, 15);
scoreGame(bracket, 'place_7', 21, 14);
const done = Tournament.isBracketComplete(bracket);
console.assert(done, 'Bracket should be complete after all games scored');
console.log(`[5] isBracketComplete(full) = ${done}. OK`);

// ── Test 6: Final rankings
const rankings = Tournament.getFinalRankings(bracket, teams, standings);
console.assert(rankings.length >= 8, `Should have 8 placements, got ${rankings.length}`);
console.log(`[6] Final rankings: ${rankings.map(r => `${r.place}.${r.team.name}`).join(', ')}`);

// ── Test 7: Odd team count (5 teams)
const teams5 = teams.slice(0, 5);
const rounds5 = Tournament.generateQualifyingRounds(teams5, 3);
rounds5.forEach(r => {
  const players = r.games.flatMap(g => [g.teamA.name, g.teamB.name]);
  const byeName = r.byeTeam ? r.byeTeam.name : null;
  const all = [...players, byeName].filter(Boolean);
  const unique = new Set(all);
  console.assert(unique.size === teams5.length, `Round ${r.roundNumber}: all 5 teams should appear`);
});
console.log(`[7] Odd team (5) qualifying: bye rotation OK`);

// ── Test 8: 4-team bracket
const teams4 = teams.slice(0, 4);
const rounds4 = Tournament.generateQualifyingRounds(teams4, 3);
rounds4.forEach(r => { r.games.forEach(g => { g.scoreA=21; g.scoreB=15; g.complete=true; g.winner=g.teamA; g.loser=g.teamB; }); });
const standings4 = Tournament.calculateStandings(teams4, rounds4);
const bracket4 = Tournament.generateBracket(standings4);
const gm4 = bracket4.gameMap;
console.assert(gm4['sf_1'] && gm4['final_1'] && gm4['third_place'], '4-team bracket should have SF, Final, 3rd');
console.assert(!gm4['qf_1'], '4-team bracket should NOT have QFs');
console.log('[8] 4-team bracket structure: SF+Final+3rd. OK');

// ── Test 9: Score validation
console.assert(Tournament.validateScore(21, 19) === null, '21-19 should be valid');
console.assert(Tournament.validateScore(21, 0) === null, '21-0 should be valid');
console.assert(Tournament.validateScore(22, 20) === null, '22-20 should be valid');
console.assert(Tournament.validateScore(23, 21) === null, '23-21 should be valid');
console.assert(Tournament.validateScore(23, 22) === null, '23-22 should be valid');

console.assert(typeof Tournament.validateScore(21, 20) === 'string', '21-20 should be invalid');
console.assert(typeof Tournament.validateScore(22, 21) === 'string', '22-21 should be invalid');
console.assert(typeof Tournament.validateScore(23, 20) === 'string', '23-20 should be invalid');
console.assert(typeof Tournament.validateScore(22, 19) === 'string', '22-19 should be invalid');
console.assert(typeof Tournament.validateScore(24, 22) === 'string', '24-22 should be invalid');
console.assert(typeof Tournament.validateScore(20, 18) === 'string', '20-18 should be invalid');
console.assert(typeof Tournament.validateScore(21, 21) === 'string', '21-21 should be invalid');

console.log('[9] Score validation tests: OK');

// ── Test 10: Dynamic Re-seeding with upsets
const bracketUpset = Tournament.generateBracket(standings);
// Standings order: standings[0] is seed 1, standings[7] is seed 8.
// QF1: Seed 1 (standings[0]) vs Seed 8 (standings[7]) -> Let Seed 8 win!
// QF2: Seed 4 (standings[3]) vs Seed 5 (standings[4]) -> Let Seed 4 win!
// QF3: Seed 2 (standings[1]) vs Seed 7 (standings[6]) -> Let Seed 7 win!
// QF4: Seed 3 (standings[2]) vs Seed 6 (standings[5]) -> Let Seed 3 win!
Tournament.submitBracketScore(bracketUpset, 'qf_1', 15, 21); // Seed 8 wins
Tournament.submitBracketScore(bracketUpset, 'qf_2', 21, 15); // Seed 4 wins
Tournament.submitBracketScore(bracketUpset, 'qf_3', 15, 21); // Seed 7 wins
Tournament.submitBracketScore(bracketUpset, 'qf_4', 21, 15); // Seed 3 wins

const sf1 = bracketUpset.gameMap['sf_1'];
const sf2 = bracketUpset.gameMap['sf_2'];

console.assert(sf1.teamA.id === standings[2].team.id, 'SF1 team A should be Seed 3');
console.assert(sf1.teamB.id === standings[7].team.id, 'SF1 team B should be Seed 8');
console.assert(sf2.teamA.id === standings[3].team.id, 'SF2 team A should be Seed 4');
console.assert(sf2.teamB.id === standings[6].team.id, 'SF2 team B should be Seed 7');
console.log('[10] Dynamic Re-seeding with upsets matches correctly: Seed 3 vs 8 and Seed 4 vs 7. OK');

const p5sf1 = bracketUpset.gameMap['p5sf_1'];
const p5sf2 = bracketUpset.gameMap['p5sf_2'];

console.assert(p5sf1.teamA.id === standings[0].team.id, 'p5sf_1 team A should be Seed 1');
console.assert(p5sf1.teamB.id === standings[5].team.id, 'p5sf_1 team B should be Seed 6');
console.assert(p5sf2.teamA.id === standings[1].team.id, 'p5sf_2 team A should be Seed 2');
console.assert(p5sf2.teamB.id === standings[4].team.id, 'p5sf_2 team B should be Seed 5');
console.log('[10] Consolation Re-seeding with upsets matches correctly: Seed 1 vs 6 and Seed 2 vs 5. OK');

// ── Test 11: Reset of Quarterfinal resets downstream
Tournament.submitBracketScore(bracketUpset, 'sf_1', 21, 15);
Tournament.submitBracketScore(bracketUpset, 'sf_2', 21, 15);
console.assert(bracketUpset.gameMap['sf_1'].complete, 'SF1 should be complete');
console.assert(bracketUpset.gameMap['final_1'].teamA !== null, 'Final team A should be set');

Tournament.resetBracketGame(bracketUpset, 'qf_1');

console.assert(!bracketUpset.gameMap['qf_1'].complete, 'QF1 should be reset');
console.assert(!bracketUpset.gameMap['sf_1'].complete, 'SF1 should be reset');
console.assert(bracketUpset.gameMap['sf_1'].teamA === null, 'SF1 team A should be null');
console.assert(bracketUpset.gameMap['final_1'].teamA === null, 'Final team A should be null');
console.log('[11] Resetting a Quarterfinal correctly resets all downstream games. OK');

console.log('\n✅ All tests passed!');

