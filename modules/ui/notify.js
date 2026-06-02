// =============================================================
// modules/ui/notify.js
// Modal & Toast system — reusable UI primitives
// =============================================================

const modalRoot = document.getElementById('modal-root');
const toastRoot = document.getElementById('toast-root');

let modalEscHandler = null;

export const Modal = {
  open({ title, body, footer, size = '', onClose, closeOnBackdrop = false }) {
    this.close();
    const wrap = document.createElement('div');
    wrap.className = 'modal-backdrop';
    wrap.innerHTML = `
      <div class="modal ${size === 'lg' ? 'modal--lg' : ''}" role="dialog" aria-modal="true" aria-labelledby="modal-title">
        <div class="modal__header">
          <h2 class="modal__title" id="modal-title">${title}</h2>
          <button class="icon-btn" data-close aria-label="Tutup">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div class="modal__body" id="modal-body"></div>
        ${footer ? `<div class="modal__footer" id="modal-footer"></div>` : ''}
      </div>
    `;
    modalRoot.appendChild(wrap);

    const bodyEl = wrap.querySelector('#modal-body');
    if (typeof body === 'string') bodyEl.innerHTML = body;
    else if (body instanceof Node) bodyEl.appendChild(body);

    if (footer) {
      const footerEl = wrap.querySelector('#modal-footer');
      if (typeof footer === 'string') footerEl.innerHTML = footer;
      else if (footer instanceof Node) footerEl.appendChild(footer);
    }

    // [data-close] buttons are always active
    wrap.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => this.close()));

    // Backdrop click & Escape only work when closeOnBackdrop=true (confirm modal)
    // Form data uses closeOnBackdrop=false (default) so it is not lost accidentally
    if (closeOnBackdrop) {
      wrap.addEventListener('click', (e) => { if (e.target === wrap) this.close(); });
      modalEscHandler = (e) => { if (e.key === 'Escape') this.close(); };
      document.addEventListener('keydown', modalEscHandler);
    } else {
      // Escape still works but only in the confirm modal, not in forms
      modalEscHandler = null;
    }

    if (onClose) wrap._onClose = onClose;

    // Focus first focusable
    setTimeout(() => {
      const first = wrap.querySelector('input, select, textarea, button:not([data-close])');
      first?.focus();
    }, 60);
    return wrap;
  },

  close() {
    const open = modalRoot.querySelector('.modal-backdrop');
    if (open) {
      open._onClose?.();
      open.remove();
    }
    if (modalEscHandler) {
      document.removeEventListener('keydown', modalEscHandler);
      modalEscHandler = null;
    }
  },

  confirm({ title = 'Konfirmasi', message, confirmText = 'Ya', cancelText = 'Batal', variant = 'brand' }) {
    return new Promise((resolve) => {
      // BUG-FIX: resolve MUST be called BEFORE Modal.close() so it is not
      // overridden by the onClose handler (which would trigger resolve(false)).
      // Promise.resolve() is idempotent — the first call wins.
      const settle = (value) => { resolve(value); Modal.close(); };

      const footer = document.createElement('div');
      const btnCancel = document.createElement('button');
      btnCancel.className = 'btn btn--ghost';
      btnCancel.textContent = cancelText;
      btnCancel.onclick = () => settle(false);

      const btnOk = document.createElement('button');
      btnOk.className = variant === 'danger' ? 'btn btn--danger' : 'btn';
      btnOk.textContent = confirmText;
      btnOk.onclick = () => settle(true);

      footer.appendChild(btnCancel);
      footer.appendChild(btnOk);

      Modal.open({
        title,
        body: `<p style="color:var(--text-secondary)">${message}</p>`,
        footer,
        closeOnBackdrop: true,   // a confirm dialog may be closed by outside click / Escape
        onClose: () => resolve(false),
      });
    });
  },
};

export const Toast = {
  show(msg, variant = '', timeout = 2400) {
    const t = document.createElement('div');
    t.className = `toast ${variant ? 'toast--' + variant : ''}`;
    t.textContent = msg;
    toastRoot.appendChild(t);
    setTimeout(() => {
      t.style.opacity = '0';
      t.style.transform = 'translateY(8px)';
      setTimeout(() => t.remove(), 250);
    }, timeout);
  },
  success(msg) { this.show(msg, 'success'); },
  error(msg) { this.show(msg, 'danger', 3200); },
};
