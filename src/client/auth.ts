// Browser side of passkey login / enrolment (login.astro, enroll.astro).
import { browserSupportsWebAuthn, startAuthentication, startRegistration } from '@simplewebauthn/browser';

const root = document.querySelector<HTMLElement>('[data-ps-auth]')!;
const go = document.getElementById('ps-auth-go') as HTMLButtonElement | null;
const errEl = document.getElementById('ps-auth-error')!;
const fail = (msg: string) => { errEl.textContent = msg; errEl.hidden = false; if (go) go.disabled = false; };
const post = async (action: string, body: unknown) => {
  const res = await fetch(`/api/editor/auth/${action}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `${action} failed (${res.status})`);
  return data;
};

if (!browserSupportsWebAuthn()) fail('This browser does not support passkeys.');
else if (go) go.addEventListener('click', async () => {
  go.disabled = true; errEl.hidden = true;
  try {
    if (root.dataset.psAuth === 'login') {
      const { options, token } = await post('login-options', {});
      const response = await startAuthentication({ optionsJSON: options });
      const { next } = await post('login-verify', { token, response, next: root.dataset.next });
      location.assign(next || '/edit');
    } else {
      const { options, token } = await post('register-options', { invite: root.dataset.invite });
      const response = await startRegistration({ optionsJSON: options });
      const label = (document.getElementById('ps-auth-label') as HTMLInputElement | null)?.value;
      await post('register-verify', { token, response, label });
      location.assign('/edit');
    }
  } catch (e: any) {
    fail(e?.name === 'NotAllowedError' ? 'Cancelled, or no passkey was offered. Try again.' : e?.message || String(e));
  }
});
root.dataset.ready = '1'; // tests wait for this before clicking
