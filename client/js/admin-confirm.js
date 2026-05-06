document.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-confirm]');
  if (btn && !confirm(btn.dataset.confirm)) {
    e.preventDefault();
  }
});

document.addEventListener('submit', (e) => {
  const form = e.target.closest('[data-delete-confirm]');
  if (!form) {
    return;
  }
  const username = form.dataset.deleteConfirm;
  const input = prompt(
    `Type the username "${username}" to confirm permanent deletion of this user and all their stats/game history:`,
  );
  if (input !== username) {
    e.preventDefault();
  }
});
