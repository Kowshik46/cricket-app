// Page-view beacon → POST /api/visit. Path + referrer only; the server adds IP hash / UA.
(function () {
  try {
    var body = JSON.stringify({ path: location.pathname, referrer: document.referrer || null });
    if (navigator.sendBeacon) {
      navigator.sendBeacon('/api/visit', new Blob([body], { type: 'application/json' }));
    } else {
      fetch('/api/visit', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: body, keepalive: true });
    }
  } catch (e) { /* analytics must never break the page */ }
})();
