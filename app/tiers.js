// Free vs premium seam (BUILD_PLAN product principles). PREMIUM_ON stays false until the app phase: nothing is gated today.
(() => {
  const PREMIUM_ON = false;
  const TIERS = { sPlus: 'premium', scoringPanels: 'premium', resultsDeepFilters: 'premium', shotMatchup: 'premium', defVsPos: 'premium' };
  const LOCK = '<div class="card lock"><b>Premium</b><p>This part comes with a subscription.</p></div>';
  // gate(feature, html, lockedHtml): html while gating is off or the feature is free; otherwise the lock card
  function gate(feature, html, lockedHtml) {
    if (!PREMIUM_ON || (TIERS[feature] || 'free') !== 'premium') return html;
    return lockedHtml === undefined ? LOCK : lockedHtml;
  }
  window.PREMIUM_ON = PREMIUM_ON; window.TIERS = TIERS; window.gate = gate;
})();
