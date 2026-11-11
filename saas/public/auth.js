// Login and signup forms: post as JSON, go to the app on success.
document.querySelectorAll('form[data-auth]').forEach((form) => {
  const kind = form.dataset.auth;
  const msg = form.querySelector('.msg');
  const button = form.querySelector('button');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    msg.textContent = '';
    button.disabled = true;
    try {
      const res = await fetch(`/__saas/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.fromEntries(new FormData(form))),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Something went wrong. Please try again.');
      location.href = '/';
    } catch (err) {
      msg.textContent = err.message;
      button.disabled = false;
    }
  });
});
