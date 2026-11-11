// Plan & billing page: shows trial / subscription state, starts Razorpay
// Checkout for the ₹99/month plan, and cancels renewals.
const $ = (id) => document.getElementById(id);
const fmtDate = (ms) => new Date(ms).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN')}`;

function say(text, kind = 'err') {
  $('msg').className = `msg ${kind}`;
  $('msg').textContent = text;
}

async function api(path, body) {
  const res = await fetch(path, body === undefined ? {} : {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) { location.href = '/login'; throw new Error('Logged out'); }
  if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
  return data;
}

function render(me) {
  const status = $('status');
  const subscribed = ['active', 'authenticated'].includes(me.subscriptionStatus);
  const price = rupees(me.pricePaise);
  let title, line, tone = '';

  if (subscribed && me.inTrial && !me.paid) {
    title = 'Subscribed';
    line = `Your free month runs until ${fmtDate(me.trialEndsAt)}. The first ${price} charge is on that day.`;
    tone = 'ok';
  } else if (subscribed) {
    title = 'Active';
    line = `${price}/month · renews on ${fmtDate(me.paidUntil)}.`;
    tone = 'ok';
  } else if (me.inTrial) {
    title = `Free trial · ${me.trialDaysLeft} day${me.trialDaysLeft === 1 ? '' : 's'} left`;
    line = `Ends on ${fmtDate(me.trialEndsAt)}. Subscribe now and you are still charged only after the free month.`;
  } else if (me.allowed) {
    title = 'Cancelled';
    line = `You can keep using the app until ${fmtDate(me.paidUntil)}. Subscribe again to continue after that.`;
    tone = 'warn';
  } else {
    title = 'Your plan has ended';
    line = `Subscribe for ${price}/month to open your invoices again. Nothing has been deleted.`;
    tone = 'warn';
  }
  status.className = `status ${tone}`;
  status.innerHTML = '';
  const b = document.createElement('b');
  b.textContent = title;
  status.append(b, document.createTextNode(line));

  const details = $('details');
  details.innerHTML = '';
  for (const [k, v] of [['Account', me.email], ['Name', me.name], ['Business', me.business]]) {
    if (!v) continue;
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    details.append(dt, dd);
  }

  $('subscribe').hidden = subscribed;
  $('subscribe').textContent = `Subscribe for ${price}/month`;
  $('cancel').hidden = !subscribed && me.subscriptionStatus !== 'pending';
  $('open-app').hidden = !me.allowed;
  if (!me.paymentsReady && !subscribed) {
    $('subscribe').disabled = true;
    say(`Online payment is being set up. ${me.supportEmail ? `Write to ${me.supportEmail} to subscribe.` : ''}`, 'err');
  }
}

async function load() {
  try { render(await api('/__saas/me')); } catch (err) { say(err.message); }
}

$('subscribe').addEventListener('click', async () => {
  const button = $('subscribe');
  button.disabled = true;
  say('', 'ok');
  try {
    if (typeof window.Razorpay !== 'function') throw new Error('The payment window could not load. Check your internet connection and try again.');
    const s = await api('/__saas/billing/subscribe', {});
    const checkout = new window.Razorpay({
      key: s.keyId,
      subscription_id: s.subscriptionId,
      name: s.brand,
      description: s.startsLater ? 'Monthly plan · first charge after your free month' : 'Monthly plan',
      prefill: { name: s.name, email: s.email, contact: s.phone || undefined },
      theme: { color: '#1e40af' },
      handler: async (resp) => {
        try {
          render(await api('/__saas/billing/verify', resp));
          say('Thank you! Your subscription is active.', 'ok');
        } catch (err) { say(err.message); }
      },
      modal: { ondismiss: () => { button.disabled = false; } },
    });
    checkout.on('payment.failed', (resp) => say(resp.error?.description || 'The payment failed. Please try again.'));
    checkout.open();
  } catch (err) {
    say(err.message);
    button.disabled = false;
  }
});

$('cancel').addEventListener('click', async () => {
  if (!confirm('Stop the monthly renewal? You keep access until the end of the period already paid for.')) return;
  try {
    render(await api('/__saas/billing/cancel', {}));
    say('Your subscription is cancelled. It will not renew.', 'ok');
  } catch (err) { say(err.message); }
});

load();
