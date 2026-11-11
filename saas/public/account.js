// Added by the gateway to the billing app's own page: a small account bar
// (who is signed in, trial / plan state, Plan & billing, Log out), and a
// fetch wrapper that sends the user to log in or renew when the session or
// the plan ends while the app is open.
(() => {
  const realFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const res = await realFetch(...args);
    if (res.status === 401 || res.status === 402) {
      const code = await res.clone().json().then((d) => d.code).catch(() => '');
      if (code === 'logged-out') location.href = '/login';
      else if (code === 'payment-required') location.href = '/billing';
    }
    return res;
  };

  const bar = document.createElement('div');
  bar.id = 'saas-account';
  bar.innerHTML = `
    <button type="button" class="saas-toggle" aria-expanded="false" aria-label="Account"></button>
    <div class="saas-menu" hidden>
      <div class="saas-who"></div>
      <div class="saas-plan"></div>
      <a href="/billing">Plan &amp; billing</a>
      <a href="/logout" class="saas-logout">Log out</a>
    </div>`;
  const toggle = bar.querySelector('.saas-toggle');
  const menu = bar.querySelector('.saas-menu');
  toggle.addEventListener('click', () => {
    menu.hidden = !menu.hidden;
    toggle.setAttribute('aria-expanded', String(!menu.hidden));
  });
  document.addEventListener('click', (e) => {
    if (!bar.contains(e.target)) { menu.hidden = true; toggle.setAttribute('aria-expanded', 'false'); }
  });
  bar.querySelector('.saas-logout').addEventListener('click', async (e) => {
    e.preventDefault();
    await realFetch('/__saas/logout', { method: 'POST' }).catch(() => {});
    location.href = '/login';
  });

  realFetch('/__saas/me').then((r) => (r.ok ? r.json() : null)).then((me) => {
    if (!me) return;
    const initial = (me.name || me.email || '?').trim().charAt(0).toUpperCase();
    const subscribed = ['active', 'authenticated'].includes(me.subscriptionStatus);
    const trialNote = me.inTrial && !subscribed ? `Free trial · ${me.trialDaysLeft}d left` : '';
    toggle.textContent = trialNote ? `${initial} · ${trialNote}` : initial;
    bar.classList.toggle('saas-trial', Boolean(trialNote));
    bar.querySelector('.saas-who').textContent = me.business ? `${me.name} · ${me.business}` : (me.name || me.email);
    bar.querySelector('.saas-plan').textContent = subscribed ? 'Subscribed · ₹99/month' : trialNote || 'Plan ending soon';
    document.body.appendChild(bar);
  });
})();
