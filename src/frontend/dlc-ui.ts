/**
 * Shared DLC settings panel for all pages.
 * Renders a "DLCs" button in the nav and a dropdown with checkboxes.
 * Changing DLC selection saves to localStorage and reloads the page.
 */
import {
  TRAILER_DLCS, ALL_DLC_IDS,
  getOwnedTrailerDLCs, toggleTrailerDLC, setOwnedTrailerDLCs,
} from './storage';

/**
 * Inject the DLC button into the page nav bar and wire up the dropdown.
 * Call once per page after DOM is ready.
 */
export function initDLCPanel(): void {
  const nav = document.querySelector('header nav');
  if (!nav) return;

  const btn = document.createElement('button');
  btn.className = 'dlc-btn';
  updateBadge(btn);
  nav.appendChild(btn);

  const panel = document.createElement('div');
  panel.className = 'dlc-panel';
  panel.style.display = 'none';
  panel.innerHTML = buildPanelHTML();
  nav.appendChild(panel);

  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    panel.style.display = panel.style.display === 'none' ? '' : 'none';
  });

  document.addEventListener('click', (e) => {
    if (!panel.contains(e.target as Node) && e.target !== btn) {
      panel.style.display = 'none';
    }
  });

  panel.querySelectorAll<HTMLInputElement>('input[data-dlc]').forEach((cb) => {
    cb.addEventListener('change', () => {
      toggleTrailerDLC(cb.dataset.dlc!);
      location.reload();
    });
  });

  panel.querySelector('.dlc-all')?.addEventListener('click', () => {
    setOwnedTrailerDLCs([...ALL_DLC_IDS]);
    location.reload();
  });
  panel.querySelector('.dlc-none')?.addEventListener('click', () => {
    setOwnedTrailerDLCs([]);
    location.reload();
  });
}

function updateBadge(btn: HTMLButtonElement): void {
  const owned = getOwnedTrailerDLCs();
  const total = ALL_DLC_IDS.length;
  if (owned.length === total) {
    btn.textContent = 'DLCs';
    btn.classList.remove('dlc-filtered');
  } else {
    btn.textContent = `DLCs (${owned.length}/${total})`;
    btn.classList.add('dlc-filtered');
  }
}

function buildPanelHTML(): string {
  const owned = getOwnedTrailerDLCs();
  const rows = ALL_DLC_IDS.map((id) => {
    const checked = owned.includes(id) ? 'checked' : '';
    const name = TRAILER_DLCS[id];
    return `<label class="dlc-row"><input type="checkbox" data-dlc="${id}" ${checked}> ${name}</label>`;
  }).join('');

  return `
    <div class="dlc-panel-header">
      <span>Trailer DLCs</span>
      <span class="dlc-actions">
        <button class="dlc-all">All</button>
        <button class="dlc-none">None</button>
      </span>
    </div>
    ${rows}
  `;
}
