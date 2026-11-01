// One-line rule texts shown when a tag is tapped. %P = position group (G / F / C, NHL F / D).
// Rank tags show only when a team is top or bottom 12 for the season AND top or bottom 8 over its last 10 games (needs 5+ games in the last 10).
window.GLOSSARY = {
  tags: {
    def: {
      nba: 'Defense rank vs starting %Ps: points per game allowed to the other team’s starting %Ps. #1 allows the least, #30 the most. Shown when top or bottom 12 this season and top or bottom 8 over the last 10.',
      nhl: 'Defense rank vs the %P line: points per game allowed to the other team’s top-6 forwards or top-4 defensemen (by ice time). #1 allows the least, #32 the most. Shown when top or bottom 12 this season and top or bottom 8 over the last 10.',
    },
    pace: {
      nba: 'Pace rank: possessions per game. #1 is the fastest, so more chances for every stat. Shown when top or bottom 12 this season and top or bottom 8 over the last 10.',
      nhl: 'Pace rank: shots for plus shots against per game. #1 is the most shot-heavy. Shown when top or bottom 12 this season and top or bottom 8 over the last 10.',
    },
    favm: 'Tonight’s opponent ranks in the bottom group of the league at defending his position (same rule as the team’s DEF tag).',
    trend: {
      nba: 'Team: won (or lost) 4 or 5 of the last 5. Player: his points + rebounds + assists over the last 5 games are at least 15% above (or below) his season average, by more than his normal 5-game randomness. Needs 8+ games.',
      nhl: 'Team: won (or lost) 4 or 5 of the last 5; overtime losses count as losses. Player: his shots on goal over the last 5 games are at least 15% above (or below) his season average, by more than his normal 5-game randomness. Needs 8+ games.',
    },
    b2b: 'Played yesterday (second game in two days). NBA also flags a 3rd game in 4 nights.',
    rest: '3 or more days since the team’s last game.',
    road: '4th or more road game in a row.',
    travel: 'The away team’s home time zone is 2 or more hours from tonight’s arena (at game time).',
    short: '2 or more players are reported Out for this game.',
    bkg: 'Tonight\u2019s projected starting goalie is not the team\u2019s #1. Depth chart: #1/#2/#3 by starts this season, then games played, then save %.',
    q: 'Listed Questionable, Day-to-Day or Doubtful on tonight’s injury report.',
    back: 'One of his first 3 games back after missing 3 or more team games in a row.',
    usage: 'A star or starting teammate is reported Out tonight, so his role can grow.',
    min: 'His minutes over the last 3 games are at least 15% above (or below) his season average. Needs 6+ games.',
    vol: 'Top 10% of players for game-to-game swing in his main stat (PRA in the NBA, shots on goal in the NHL), measured against what is normal for his volume. Needs 8+ games.',
    steady: 'Bottom 10% of players for game-to-game swing in his main stat (PRA in the NBA, shots on goal in the NHL), measured against what is normal for his volume. Needs 8+ games.',
    new: 'Played for a different team last season.',
  },
  mybets: {
    record: 'Wins-losses-pushes of your settled bets. A push returns your stake. Void bets (player did not play) count as never placed.',
    units: 'Profit or loss in units, at the odds you saved. A win pays by those odds, a loss costs the units you picked.',
    roi: 'Return on investment: units won or lost divided by units staked on settled bets. Void bets are left out.',
  },
  // Results tab (Model view). Shown with the ⓘ button; keep each to 1-2 lines.
  results: {
    graded: 'Every graded bet in the filters, counted as stored. Both sides of every prop are in the data (over and under), so each line adds two bets. Flagged, void and DNP rows are left out.',
    win: 'Won divided by won plus lost; pushes are left out. On its own it misleads, because longer odds need fewer wins: compare it with the break-even % under it.',
    edge: 'Win % minus break-even %. Break-even is the win rate the odds you took need to pay off (-110 needs 52.4%), averaged over the bets. Above 0 means the bets won more than their price required.',
    roi: 'Units won per unit staked, flat 1u at the odds taken: a win pays the odds, a loss costs 1, a push 0.',
    beat: 'How often the open price was better than the close on the same side: the line moved your way, or the line held and the odds shortened. Needs both prices; bets without both are not counted.',
    grades: 'Did a better grade win more than its odds required? Edge and ROI should fall from S+ to F. Ungraded: game lines (grades not published) and sports without live grades.',
    units: 'Running total of units won, 1u flat at the odds taken, for each grade group. Ungraded bets are not charted.',
  },
};
