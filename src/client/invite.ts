// /edit — "Invite an editor" form (passkey mode only).
const form = document.getElementById('ase-invite') as HTMLFormElement | null;
form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const out = form.querySelector('output')!;
  const fd = new FormData(form);
  out.textContent = 'Creating…';
  const res = await fetch('/api/editor/auth/invite', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: fd.get('name'), email: fd.get('email') }) });
  const data = await res.json();
  if (!res.ok) { out.textContent = data.error || 'Failed'; return; }
  out.innerHTML = '';
  const input = Object.assign(document.createElement('input'), { type: 'text', readOnly: true, value: data.url, className: 'ase-invite__url' });
  const copy = Object.assign(document.createElement('button'), { type: 'button', className: 'ase-btn ase-btn--small', textContent: 'Copy' });
  copy.addEventListener('click', async () => { await navigator.clipboard.writeText(data.url); copy.textContent = 'Copied'; });
  const hint = Object.assign(document.createElement('small'), { className: 'ase-muted', textContent: `Send this link to ${fd.get('name')}. It works once and expires in ${Math.round(data.expiresIn / 86400)} days.` });
  out.append(input, copy, hint);
});
