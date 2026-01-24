import { optimizeTrailerSet, calculateCityRankings } from './optimizer.js?v=2'
import { isOwnedGarage, toggleOwnedGarage, getOwnedGarages, getFilterMode, getSelectedCountries } from './storage.js?v=2'

let data = null
let lookups = null
let cachedRankings = null

/**
 * Initialize data references for rankings module
 * @param {Object} d - Data object from loadAllData
 * @param {Object} l - Lookups object from buildLookups
 */
export function setData(d, l) {
  data = d
  lookups = l
}

// Normalize text for accent-insensitive search
function normalize(str) {
  return str.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}

// Get city rank from cached rankings
function getCityRank(cityId) {
  if (!cachedRankings) return null
  const index = cachedRankings.findIndex(r => r.id === cityId)
  if (index === -1) return null
  return { rank: index + 1, total: cachedRankings.length }
}

// Format rank for display (optional score for tooltip)
function formatRank(rank, total, score = null) {
  const isTopTier = rank <= Math.ceil(total * 0.1) // Top 10%
  const baseClass = isTopTier ? 'rank-display top-tier' : 'rank-display'
  const className = score !== null ? `${baseClass} tooltip` : baseClass
  const tooltipAttrs = score !== null ? ` tabindex="0" data-tooltip="Score: ${score.toFixed(0)}"` : ''
  return `<span class="${className}"${tooltipAttrs}><span class="rank">#${rank}</span> of ${total}</span>`
}

// Copy text to clipboard with fallback
function copyToClipboard(text, button) {
  const originalText = button.textContent

  const showSuccess = () => {
    button.textContent = 'Copied!'
    button.classList.add('copied')
    setTimeout(() => {
      button.textContent = originalText
      button.classList.remove('copied')
    }, 2000)
  }

  const showError = () => {
    button.textContent = 'Failed'
    setTimeout(() => {
      button.textContent = originalText
    }, 2000)
  }

  // Try modern clipboard API first
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text)
      .then(showSuccess)
      .catch(() => {
        // Fallback for non-HTTPS or permission denied
        fallbackCopy(text) ? showSuccess() : showError()
      })
  } else {
    // Fallback for older browsers
    fallbackCopy(text) ? showSuccess() : showError()
  }
}

// Fallback copy using execCommand
function fallbackCopy(text) {
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.select()
  try {
    const success = document.execCommand('copy')
    document.body.removeChild(textarea)
    return success
  } catch {
    document.body.removeChild(textarea)
    return false
  }
}

// Add garage toggle click and keyboard handler
function addGarageToggleHandler(cityId, cityContent, updateGarageCountFn) {
  const toggleBtn = cityContent.querySelector('.garage-toggle')
  if (toggleBtn) {
    const toggleGarage = () => {
      const newState = toggleOwnedGarage(cityId)
      toggleBtn.setAttribute('aria-pressed', newState)
      toggleBtn.querySelector('.star').textContent = newState ? '★' : '☆'
      updateGarageCountFn()
    }
    toggleBtn.addEventListener('click', toggleGarage)
    toggleBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleGarage()
      }
    })
  }
}

/**
 * Render city rankings table with filters
 * @param {Object} options - Algorithm options (scoringBalance, maxTrailers, diminishingFactor)
 * @param {string} searchTerm - Search filter text
 * @param {Function} showCityFn - Callback to show city detail view
 * @param {Function} updateGarageCountFn - Callback to update garage count badge
 */
export function renderRankings(options, searchTerm, showCityFn, updateGarageCountFn) {
  const rankingsContent = document.getElementById('rankings-content')
  const rankings = calculateCityRankings(data, lookups, options)
  cachedRankings = rankings // Cache for city detail lookup

  if (rankings.length === 0) {
    cachedRankings = null
    rankingsContent.innerHTML = '<div class="empty-state">No cities with data yet.</div>'
    return
  }

  // Filter by search term
  const normalizedSearch = normalize(searchTerm)
  let filtered = rankings.filter(r =>
    normalize(r.name).includes(normalizedSearch) ||
    normalize(r.country).includes(normalizedSearch)
  )

  // Filter by selected countries
  const selectedCountries = getSelectedCountries()
  if (selectedCountries.length > 0) {
    filtered = filtered.filter(r => selectedCountries.includes(r.country))
  }

  // Get filter mode and owned garages
  const filterMode = getFilterMode()
  const ownedSet = new Set(getOwnedGarages())

  // Filter by owned garages if mode is 'owned'
  const displayRankings = filterMode === 'owned'
    ? filtered.filter(r => ownedSet.has(r.id))
    : filtered

  // Handle empty state when filtered but no garages
  if (filterMode === 'owned' && displayRankings.length === 0) {
    rankingsContent.innerHTML = `
      <div class="empty-garages">
        <p>No garages marked yet.</p>
        <p class="hint">Click any city row, then click the star to mark it as your garage.</p>
      </div>
    `
    return
  }

  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>City Rankings (${displayRankings.length} cities)</h2>
      <p class="table-hint">Click any city for trailer recommendations</p>
      <table class="table-rankings">
        <thead>
          <tr>
            <th>#</th>
            <th>City</th>
            <th>Country</th>
            <th class="tooltip" data-tooltip="Company facilities in this city">Depots</th>
            <th class="tooltip" data-tooltip="Total available cargo jobs">Jobs</th>
            <th class="tooltip" data-tooltip="Sum of all cargo values (with bonuses)">Value</th>
            <th class="tooltip" data-tooltip="Average value per cargo job">€/Job</th>
            <th class="tooltip" tabindex="0" data-tooltip="Ranks cities by combining job availability and cargo value. Higher score = more profitable garage location.">Score</th>
          </tr>
        </thead>
        <tbody>
          ${displayRankings.map((r, i) => `
            <tr class="clickable${ownedSet.has(r.id) ? ' owned-garage' : ''}" data-city-id="${r.id}" tabindex="0">
              <td>${i + 1}</td>
              <td>${r.name}</td>
              <td class="country">${r.country}</td>
              <td>${r.depotCount}</td>
              <td class="amount">${r.jobs}</td>
              <td class="value">€${r.totalValue.toLocaleString()}</td>
              <td>€${r.avgValuePerJob.toFixed(2)}</td>
              <td class="score">${formatRank(i + 1, displayRankings.length, r.score)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `

  // Add click and keyboard handlers
  rankingsContent.querySelectorAll('tr.clickable').forEach(row => {
    row.addEventListener('click', () => {
      showCityFn(parseInt(row.dataset.cityId))
    })
    row.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        showCityFn(parseInt(row.dataset.cityId))
      }
    })
  })
}

/**
 * Render city detail view with trailer recommendations
 * @param {number} cityId - City ID to render
 * @param {Object} options - Algorithm options (scoringBalance, maxTrailers, diminishingFactor)
 * @param {Function} updateGarageCountFn - Callback to update garage count badge
 */
export function renderCity(cityId, options, updateGarageCountFn) {
  const cityContent = document.getElementById('city-content')
  const result = optimizeTrailerSet(cityId, data, lookups, options)
  const city = lookups.citiesById.get(cityId)
  const isOwned = isOwnedGarage(cityId)

  if (!city) {
    cityContent.innerHTML = '<div class="empty-state">City not found.</div>'
    return
  }

  if (result.recommendations.length === 0) {
    cityContent.innerHTML = `
      <div class="city-header">
        <h2>${city.name}</h2>
        <button class="garage-toggle" aria-label="Toggle garage" aria-pressed="${isOwned}">
          <span class="star">${isOwned ? '★' : '☆'}</span>
        </button>
        <span class="country">${city.country}</span>
      </div>
      <div class="empty-state">No cargo data for this city yet.</div>
    `
    addGarageToggleHandler(cityId, cityContent, updateGarageCountFn)
    return
  }

  const totalTrailers = result.recommendations.reduce((sum, r) => sum + r.count, 0)
  const trailerTypes = result.recommendations.length
  const cityRank = getCityRank(cityId)

  cityContent.innerHTML = `
    <div class="city-header">
      <h2>${city.name}</h2>
      <button class="garage-toggle" aria-label="Toggle garage" aria-pressed="${isOwned}">
        <span class="star">${isOwned ? '★' : '☆'}</span>
      </button>
      <span class="country">${city.country}</span>
    </div>

    <div class="stats">
      <div class="stat">
        <div class="stat-value">${result.totalDepots}</div>
        <div class="stat-label">Depots</div>
      </div>
      <div class="stat">
        <div class="stat-value">${result.totalCargoInstances}</div>
        <div class="stat-label">Jobs Available</div>
      </div>
      <div class="stat">
        <div class="stat-value">€${result.totalValue.toLocaleString()}</div>
        <div class="stat-label">Total Value</div>
      </div>
      <div class="stat">
        <div class="stat-value">${totalTrailers}</div>
        <div class="stat-label">Trailers (${trailerTypes} types)</div>
      </div>
      <div class="stat">
        <div class="stat-value">${cityRank ? formatRank(cityRank.rank, cityRank.total) : '-'}</div>
        <div class="stat-label">Rank</div>
      </div>
    </div>

    <div class="table-section">
      <div class="section-header">
        <h2>Recommended Trailers</h2>
        <button class="btn copy-btn" id="copy-trailers-btn">Copy to clipboard</button>
      </div>
      <table>
        <thead>
          <tr>
            <th>Trailer</th>
            <th class="tooltip" data-tooltip="How many of this trailer to buy">Copies</th>
            <th class="tooltip" tabindex="0" data-tooltip="This trailer can haul this percentage of the different cargo types available at depots in this city">Coverage</th>
            <th class="tooltip" data-tooltip="Average value per job for this trailer">€/Job/km</th>
            <th class="tooltip" tabindex="0" data-tooltip="Combines €/km value and job coverage based on your Scoring Balance setting. Higher = better trailer choice.">Score</th>
          </tr>
        </thead>
        <tbody>
          ${result.recommendations.map(r => `
            <tr>
              <td>
                <div class="trailer-name">${r.trailerName}</div>
                <div class="trailer-cargoes">Hauls: ${r.topCargoes.join(', ')}</div>
              </td>
              <td class="amount">${r.count}</td>
              <td class="coverage">${r.coveragePct}%</td>
              <td class="value">€${r.avgValue.toFixed(2)}</td>
              <td>${r.score.toFixed(3)}</td>
            </tr>
          `).join('')}
        </tbody>
      </table>
    </div>
  `

  // Add copy button handler
  const copyBtn = document.getElementById('copy-trailers-btn')
  copyBtn.addEventListener('click', () => {
    const trailerList = result.recommendations
      .map(r => r.count > 1 ? `${r.trailerName} ×${r.count}` : r.trailerName)
      .join(', ')
    const text = `${city.name} (${totalTrailers} trailers): ${trailerList}`

    copyToClipboard(text, copyBtn)
  })

  // Add garage toggle handler
  addGarageToggleHandler(cityId, cityContent, updateGarageCountFn)
}

/**
 * Show city detail view and update URL hash
 * @param {number} cityId - City ID to display
 * @param {Function} renderCityFn - Callback to render city content
 */
export function showCity(cityId, renderCityFn) {
  const rankingsView = document.getElementById('rankings-view')
  const cityView = document.getElementById('city-view')

  rankingsView.style.display = 'none'
  cityView.style.display = 'block'
  if (window.location.hash !== `#city-${cityId}`) {
    window.location.hash = `city-${cityId}`
  }
  renderCityFn(cityId)
  window.scrollTo(0, 0)
}

/**
 * Show rankings view and clear URL hash
 * @param {Function} renderRankingsFn - Callback to render rankings content
 */
export function showRankings(renderRankingsFn) {
  const rankingsView = document.getElementById('rankings-view')
  const cityView = document.getElementById('city-view')

  cityView.style.display = 'none'
  rankingsView.style.display = 'block'
  window.location.hash = ''
  renderRankingsFn()
}
