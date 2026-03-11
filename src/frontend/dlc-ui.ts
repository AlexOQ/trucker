/**
 * Shared DLC settings panel for all pages.
 * Renders a "DLCs" button in the nav and a dropdown with checkboxes
 * for both trailer DLCs and cargo DLCs.
 * Changing DLC selection saves to localStorage and reloads the page.
 */
import {
  TRAILER_DLCS, ALL_DLC_IDS,
  getOwnedTrailerDLCs, toggleTrailerDLC, setOwnedTrailerDLCs,
  CARGO_DLCS, ALL_CARGO_DLC_IDS,
  getOwnedCargoDLCs, toggleCargoDLC, setOwnedCargoDLCs,
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

  // Trailer DLC checkboxes
  panel.querySelectorAll<HTMLInputElement>('input[data-trailer-dlc]').forEach((cb) => {
    cb.addEventListener('change', () => {
      toggleTrailerDLC(cb.dataset.trailerDlc!);
      location.reload();
    });
  });

  panel.querySelector('.dlc-trailer-all')?.addEventListener('click', () => {
    setOwnedTrailerDLCs([...ALL_DLC_IDS]);
    location.reload();
  });
  panel.querySelector('.dlc-trailer-none')?.addEventListener('click', () => {
    setOwnedTrailerDLCs([]);
    location.reload();
  });

  // Cargo DLC checkboxes
  panel.querySelectorAll<HTMLInputElement>('input[data-cargo-dlc]').forEach((cb) => {
    cb.addEventListener('change', () => {
      toggleCargoDLC(cb.dataset.cargoDlc!);
      location.reload();
    });
  });

  panel.querySelector('.dlc-cargo-all')?.addEventListener('click', () => {
    setOwnedCargoDLCs([...ALL_CARGO_DLC_IDS]);
    location.reload();
  });
  panel.querySelector('.dlc-cargo-none')?.addEventListener('click', () => {
    setOwnedCargoDLCs([]);
    location.reload();
  });
}

function updateBadge(btn: HTMLButtonElement): void {
  const ownedTrailers = getOwnedTrailerDLCs();
  const ownedCargo = getOwnedCargoDLCs();
  const totalTrailer = ALL_DLC_IDS.length;
  const totalCargo = ALL_CARGO_DLC_IDS.length;
  const allOwned = ownedTrailers.length === totalTrailer && ownedCargo.length === totalCargo;

  if (allOwned) {
    btn.textContent = 'DLCs';
    btn.classList.remove('dlc-filtered');
  } else {
    const parts: string[] = [];
    if (ownedTrailers.length < totalTrailer) parts.push(`T:${ownedTrailers.length}/${totalTrailer}`);
    if (ownedCargo.length < totalCargo) parts.push(`C:${ownedCargo.length}/${totalCargo}`);
    btn.textContent = `DLCs (${parts.join(' ')})`;
    btn.classList.add('dlc-filtered');
  }
}

function buildPanelHTML(): string {
  const ownedTrailers = getOwnedTrailerDLCs();
  const trailerRows = ALL_DLC_IDS.map((id) => {
    const checked = ownedTrailers.includes(id) ? 'checked' : '';
    return `<label class="dlc-row"><input type="checkbox" data-trailer-dlc="${id}" ${checked}> ${TRAILER_DLCS[id]}</label>`;
  }).join('');

  const ownedCargo = getOwnedCargoDLCs();
  const cargoRows = ALL_CARGO_DLC_IDS.map((id) => {
    const checked = ownedCargo.includes(id) ? 'checked' : '';
    return `<label class="dlc-row"><input type="checkbox" data-cargo-dlc="${id}" ${checked}> ${CARGO_DLCS[id]}</label>`;
  }).join('');

  return `
    <div class="dlc-panel-header">
      <span>Trailer DLCs</span>
      <span class="dlc-actions">
        <button class="dlc-trailer-all">All</button>
        <button class="dlc-trailer-none">None</button>
      </span>
    </div>
    ${trailerRows}
    <div class="dlc-panel-header dlc-section-sep">
      <span>Cargo DLCs</span>
      <span class="dlc-actions">
        <button class="dlc-cargo-all">All</button>
        <button class="dlc-cargo-none">None</button>
      </span>
    </div>
    ${cargoRows}
  `;
}
