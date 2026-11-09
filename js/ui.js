// Overlays shared by every screen: toast, action sheet, form dialog, confirm.
import { esc } from './util.js';

const root = () => document.getElementById('overlay-root');

let toastTimer;
export function toast(msg, ms = 2600) {
  let el = document.querySelector('.toast');
  if (!el) {
    el = document.createElement('div');
    el.className = 'toast';
    el.setAttribute('role', 'status');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

function mount(html, onClose) {
  const wrap = document.createElement('div');
  wrap.className = 'ov';
  wrap.innerHTML = `<div class="ov-backdrop" data-close></div>${html}`;
  root().appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add('open'));
  const close = (value) => {
    wrap.classList.remove('open');
    setTimeout(() => wrap.remove(), 220);
    document.removeEventListener('keydown', onKey);
    onClose?.(value);
  };
  const onKey = (e) => { if (e.key === 'Escape') close(undefined); };
  document.addEventListener('keydown', onKey);
  wrap.querySelector('[data-close]').addEventListener('click', () => close(undefined));
  return { wrap, close };
}

/**
 * Action sheet. items: [{ label, value, icon?, danger?, hint? }]. Resolves with the picked value
 * (or undefined when dismissed).
 */
export function actionSheet(title, items) {
  return new Promise((resolve) => {
    const html = `<div class="ov-sheet" role="dialog" aria-label="${esc(title)}">
      ${title ? `<div class="ov-title">${esc(title)}</div>` : ''}
      <div class="ov-list">
        ${items.map((it, i) => `<button class="ov-item${it.danger ? ' danger' : ''}" data-i="${i}">
          ${it.icon ? `<span class="ov-ico">${it.icon}</span>` : ''}
          <span class="ov-label">${esc(it.label)}${it.hint ? `<small>${esc(it.hint)}</small>` : ''}</span></button>`).join('')}
      </div>
      <button class="ov-cancel" data-cancel>Cancel</button>
    </div>`;
    const { wrap, close } = mount(html, resolve);
    wrap.querySelector('[data-cancel]').addEventListener('click', () => close(undefined));
    wrap.querySelectorAll('.ov-item').forEach((b) =>
      b.addEventListener('click', () => close(items[Number(b.dataset.i)].value)));
  });
}

/**
 * Form dialog. `bodyHtml` holds named inputs; resolves with an object of their values on save.
 */
export function formDialog(title, bodyHtml, { submit = 'Save', danger = null, onMount = null } = {}) {
  return new Promise((resolve) => {
    const html = `<form class="ov-sheet ov-form" role="dialog" aria-label="${esc(title)}">
      <div class="ov-title">${esc(title)}</div>
      <div class="ov-body">${bodyHtml}</div>
      <div class="ov-actions">
        ${danger ? `<button type="button" class="btn ghost danger" data-danger>${esc(danger)}</button>` : ''}
        <span class="grow"></span>
        <button type="button" class="btn ghost" data-cancel>Cancel</button>
        <button type="submit" class="btn primary">${esc(submit)}</button>
      </div>
    </form>`;
    const { wrap, close } = mount(html, resolve);
    const form = wrap.querySelector('form');
    wrap.querySelector('[data-cancel]').addEventListener('click', () => close(undefined));
    wrap.querySelector('[data-danger]')?.addEventListener('click', () => close({ __danger: true }));
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const fd = new FormData(form);
      const out = {};
      for (const [k, v] of fd.entries()) {
        if (k in out) out[k] = [].concat(out[k], v); else out[k] = v;
      }
      close(out);
    });
    // Let screens wire up live behaviour inside the form.
    onMount?.(form);
    setTimeout(() => form.querySelector('[autofocus]')?.focus(), 60);
  });
}

export async function confirmDialog(title, message, { ok = 'OK', danger = false } = {}) {
  const r = await actionSheet(title, [
    { label: ok, value: true, danger, hint: message },
  ]);
  return r === true;
}
