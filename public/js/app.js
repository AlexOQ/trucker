import { loadAllData, buildLookups } from './data.js?v=2'
import { getSettings, updateSettings, resetToDefaults, getOwnedGarages, setFilterMode, getFilterMode, getSelectedCountries, setSelectedCountries } from './storage.js?v=2'
import { setData, renderRankings, renderCity, showCity, showRankings } from './rankings.js?v=3'

let data = null
let lookups = null
let currentCityId = null

// Extract unique countries from data, sorted alphabetically
function getUniqueCountries() {
  if (!data || !data.cities) return []
  const countries = [...new Set(data.cities.map(c => c.country))]
  return countries.sort()
}

// Toggle dropdown visibility
function toggleDropdown() {
  const dropdown = document.getElementById('country-dropdown')
  const btn = document.getElementById('country-filter-btn')
  const isVisible = dropdown.style.display !== 'none'

  if (isVisible) {
    dropdown.style.display = 'none'
    btn.setAttribute('aria-expanded', 'false')
  } else {
    dropdown.style.display = 'block'
    btn.setAttribute('aria-expanded', 'true')
    // Focus first checkbox when opening
    const firstCheckbox = dropdown.querySelector('input[type="checkbox"]')
    if (firstCheckbox) {
      firstCheckbox.focus()
    }
  }
}

// Close dropdown
function closeDropdown() {
  const dropdown = document.getElementById('country-dropdown')
  const btn = document.getElementById('country-filter-btn')
  dropdown.style.display = 'none'
  btn.setAttribute('aria-expanded', 'false')
}

// Update button text based on selection
function updateCountryButtonText() {
  const selected = getSelectedCountries()
  const btn = document.getElementById('country-filter-btn')

  if (selected.length === 0) {
    btn.textContent = 'All Countries'
    btn.setAttribute('aria-label', 'Filter by country')
  } else if (selected.length === 1) {
    btn.textContent = '1 Country'
    btn.setAttribute('aria-label', 'Filter by country, 1 selected')
  } else {
    btn.textContent = `${selected.length} Countries`
    btn.setAttribute('aria-label', `Filter by country, ${selected.length} selected`)
  }
}

// Render country checkboxes in dropdown
function renderCountryCheckboxes() {
  const countries = getUniqueCountries()
  const countryOptions = document.getElementById('country-options')
  const selected = getSelectedCountries()

  countryOptions.innerHTML = `
    <label class="country-option all-countries" role="option">
      <input
        type="checkbox"
        id="all-countries-checkbox"
        aria-checked="${selected.length === 0 ? 'true' : 'false'}"
        ${selected.length === 0 ? 'checked' : ''}>
      <span>All Countries</span>
    </label>
    ${countries.map(country => `
      <label class="country-option" role="option">
        <input
          type="checkbox"
          value="${country}"
          aria-checked="${selected.includes(country) ? 'true' : 'false'}"
          aria-label="${country}"
          ${selected.includes(country) ? 'checked' : ''}>
        <span>${country}</span>
      </label>
    `).join('')}
  `

  // Add handler for "All Countries" checkbox
  const allCountriesCheckbox = document.getElementById('all-countries-checkbox')
  allCountriesCheckbox.addEventListener('change', (e) => {
    if (e.target.checked) {
      e.target.setAttribute('aria-checked', 'true')
      setSelectedCountries([])
      renderCountryCheckboxes()
      updateCountryButtonText()
      renderRankingsWrapper()
    }
  })

  // Add change handlers to country checkboxes
  countryOptions.querySelectorAll('input[type="checkbox"]:not(#all-countries-checkbox)').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const country = e.target.value
      const selected = getSelectedCountries()

      if (e.target.checked) {
        e.target.setAttribute('aria-checked', 'true')
        if (!selected.includes(country)) {
          setSelectedCountries([...selected, country])
        }
      } else {
        e.target.setAttribute('aria-checked', 'false')
        setSelectedCountries(selected.filter(c => c !== country))
      }

      // Re-render checkboxes to update "All Countries" state
      renderCountryCheckboxes()
      // Update button text to show count
      updateCountryButtonText()
      // Re-render rankings with new filter
      renderRankingsWrapper()
    })
  })
}

// Update garage count badge
function updateGarageCount() {
  const count = getOwnedGarages().length
  document.getElementById('garage-count').textContent = count
}

// Get current options from sliders
function getOptions() {
  const scoringSlider = document.getElementById('scoring-slider')
  const trailersSlider = document.getElementById('trailers-slider')
  const diminishingSlider = document.getElementById('diminishing-slider')

  return {
    scoringBalance: parseInt(scoringSlider.value),
    maxTrailers: parseInt(trailersSlider.value),
    diminishingFactor: parseInt(diminishingSlider.value),
  }
}

// Update slider display values
function updateDisplayValues() {
  const scoringSlider = document.getElementById('scoring-slider')
  const trailersSlider = document.getElementById('trailers-slider')
  const diminishingSlider = document.getElementById('diminishing-slider')
  const scoringValue = document.getElementById('scoring-value')
  const trailersValue = document.getElementById('trailers-value')
  const diminishingValue = document.getElementById('diminishing-value')

  scoringValue.textContent = scoringSlider.value
  trailersValue.textContent = trailersSlider.value
  diminishingValue.textContent = diminishingSlider.value
}

// Load settings from localStorage
function loadSettings() {
  const settings = getSettings()
  const scoringSlider = document.getElementById('scoring-slider')
  const trailersSlider = document.getElementById('trailers-slider')
  const diminishingSlider = document.getElementById('diminishing-slider')

  scoringSlider.value = settings.scoringBalance
  trailersSlider.value = settings.maxTrailers
  diminishingSlider.value = settings.diminishingFactor
  updateDisplayValues()
}

// Save settings to localStorage
function saveSettings() {
  updateSettings(getOptions())
}

// Wrapper for renderRankings
function renderRankingsWrapper() {
  const citySearch = document.getElementById('city-search')
  const options = getOptions()
  const searchTerm = citySearch.value
  renderRankings(options, searchTerm, showCityWrapper, updateGarageCount)
}

// Wrapper for renderCity
function renderCityWrapper(cityId) {
  const options = getOptions()
  renderCity(cityId, options, updateGarageCount)
}

// Wrapper for showCity
function showCityWrapper(cityId) {
  currentCityId = cityId
  showCity(cityId, renderCityWrapper)
}

// Wrapper for showRankings
function showRankingsWrapper() {
  currentCityId = null
  showRankings(renderRankingsWrapper)
}

// Handle hash navigation (e.g., #city-19)
function handleHashNavigation() {
  const hash = window.location.hash
  if (hash.startsWith('#city-')) {
    const cityId = parseInt(hash.replace('#city-', ''))
    if (cityId && lookups?.citiesById.has(cityId)) {
      showCityWrapper(cityId)
      return true
    }
  }
  return false
}

// Handle slider changes
function onSliderChange() {
  updateDisplayValues()
  saveSettings()
  if (currentCityId) {
    renderCityWrapper(currentCityId)
  } else {
    renderRankingsWrapper()
  }
}

// Show loading state
function showLoading() {
  const rankingsContent = document.getElementById('rankings-content')
  rankingsContent.innerHTML = `
    <div class="table-section">
      <h2>Loading city data...</h2>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
      <div class="skeleton-row"><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell medium"></div><div class="skeleton-cell narrow"></div><div class="skeleton-cell narrow"></div></div>
    </div>
  `
}

// Show error state
function showError(errorMessage) {
  const rankingsContent = document.getElementById('rankings-content')
  rankingsContent.innerHTML = `
    <div class="empty-state">
      <p>Failed to load data</p>
      <p style="color: #888; font-size: 0.9rem; margin-top: 0.5rem;">${errorMessage}</p>
    </div>
  `
}

/**
 * Initialize application: load data, set up event handlers, render initial view
 * @returns {Promise<void>}
 */
export async function init() {
  // Show loading state immediately
  showLoading()

  try {
    data = await loadAllData()
    lookups = buildLookups(data)
    setData(data, lookups)

    loadSettings()
    renderCountryCheckboxes()
    updateCountryButtonText()

    // Initialize filter toggle from storage
    const filterToggle = document.getElementById('filter-toggle')
    const savedFilterMode = getFilterMode()
    filterToggle.querySelectorAll('.filter-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.filter === savedFilterMode)
    })
    updateGarageCount()

    // Check for hash navigation, otherwise show rankings
    if (!handleHashNavigation()) {
      renderRankingsWrapper()
    }

    // Event listeners
    const scoringSlider = document.getElementById('scoring-slider')
    const trailersSlider = document.getElementById('trailers-slider')
    const diminishingSlider = document.getElementById('diminishing-slider')
    const citySearch = document.getElementById('city-search')
    const backLink = document.getElementById('back-link')
    const resetBtn = document.getElementById('reset-btn')
    const settingsToggle = document.getElementById('settings-toggle')

    scoringSlider.addEventListener('input', onSliderChange)
    trailersSlider.addEventListener('input', onSliderChange)
    diminishingSlider.addEventListener('input', onSliderChange)
    citySearch.addEventListener('input', renderRankingsWrapper)

    backLink.addEventListener('click', showRankingsWrapper)
    window.addEventListener('hashchange', () => {
      if (!handleHashNavigation()) {
        showRankingsWrapper()
      }
    })

    resetBtn.addEventListener('click', () => {
      const defaults = resetToDefaults()
      scoringSlider.value = defaults.scoringBalance
      trailersSlider.value = defaults.maxTrailers
      diminishingSlider.value = defaults.diminishingFactor
      onSliderChange()
    })

    // Settings toggle handler
    settingsToggle.addEventListener('click', () => {
      const controls = settingsToggle.closest('.controls')
      const isCollapsed = controls.classList.contains('collapsed')

      if (isCollapsed) {
        controls.classList.remove('collapsed')
        settingsToggle.setAttribute('aria-expanded', 'true')
        settingsToggle.querySelector('.toggle-icon').textContent = '▼'
      } else {
        controls.classList.add('collapsed')
        settingsToggle.setAttribute('aria-expanded', 'false')
        settingsToggle.querySelector('.toggle-icon').textContent = '▶'
      }
    })

    // Filter toggle click handler
    filterToggle.addEventListener('click', (e) => {
      const btn = e.target.closest('.filter-btn')
      if (!btn) return

      const mode = btn.dataset.filter
      filterToggle.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'))
      btn.classList.add('active')
      setFilterMode(mode)
      renderRankingsWrapper()
    })

    // Country filter dropdown toggle
    const countryFilterBtn = document.getElementById('country-filter-btn')
    countryFilterBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      toggleDropdown()
    })

    // Keyboard handler for dropdown button
    countryFilterBtn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault()
        toggleDropdown()
      }
    })

    // Keyboard navigation for dropdown
    document.addEventListener('keydown', (e) => {
      const dropdown = document.getElementById('country-dropdown')
      if (dropdown.style.display === 'none') return

      if (e.key === 'Escape') {
        e.preventDefault()
        closeDropdown()
        countryFilterBtn.focus()
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const checkboxes = Array.from(dropdown.querySelectorAll('input[type="checkbox"]'))
        const currentIndex = checkboxes.findIndex(cb => cb === document.activeElement || cb.parentElement === document.activeElement)

        let nextIndex
        if (e.key === 'ArrowDown') {
          nextIndex = currentIndex < checkboxes.length - 1 ? currentIndex + 1 : 0
        } else {
          nextIndex = currentIndex > 0 ? currentIndex - 1 : checkboxes.length - 1
        }

        checkboxes[nextIndex].focus()
      } else if (e.key === ' ' && document.activeElement.type === 'checkbox') {
        // Space handled by checkbox default behavior
        e.preventDefault()
        document.activeElement.click()
      }
    })

    // Close dropdown on outside click
    document.addEventListener('click', (e) => {
      const dropdown = document.getElementById('country-dropdown')
      const filterContainer = document.querySelector('.country-filter')
      if (!filterContainer.contains(e.target) && dropdown.style.display !== 'none') {
        closeDropdown()
      }
    })

  } catch (err) {
    console.error('Failed to initialize:', err)
    showError(err.message || 'Unknown error occurred')
  }
}
