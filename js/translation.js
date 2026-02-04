// ============================================================================
// TRANSLATION MANAGEMENT
// ============================================================================
// This module handles real-time translation control and language selection

/**
 * Update the translation language selector dropdown for a specific user
 * 
 * The selector shows all configured translation pairs in "source → target" format.
 * Users can switch between different target languages to view translations in
 * their preferred language.
 * 
 * Example: If configured with "en-US → [es-ES, ru-RU]", the dropdown shows:
 * - en-US → es-ES
 * - en-US → ru-RU
 * 
 * @param {string|number} uid - User ID to update selector for
 */
function updateLanguageSelector(uid) {
  const selector = $(`#translation-lang-${uid}`);
  const currentSelection = selector.val();
  
  // Consolidate translation pairs by source language
  // This prevents duplicates if multiple pairs have the same source
  const consolidatedPairs = {};
  translationSettings.pairs.forEach(pair => {
    if (!consolidatedPairs[pair.source]) {
      consolidatedPairs[pair.source] = [];
    }
    pair.targets.forEach(target => {
      if (!consolidatedPairs[pair.source].includes(target)) {
        consolidatedPairs[pair.source].push(target);
      }
    });
  });
  
  // Flatten into array of {source, target} objects for display
  const allTargetLanguages = Object.entries(consolidatedPairs).reduce((acc, [source, targets]) => {
    targets.forEach(target => {
      acc.push({ source, target });
    });
    return acc;
  }, []);

  // Populate dropdown with options
  selector.empty();
  allTargetLanguages.forEach(({ source, target }) => {
    // Format: "source → target" (e.g., "en-US → es-ES")
    const option = $(`<option value="${target}">${source} → ${target}</option>`);
    selector.append(option);
  });

  // Restore previous selection if it still exists, otherwise use first option
  if (currentSelection && selector.find(`option[value="${currentSelection}"]`).length) {
    selector.val(currentSelection);
  } else {
    selector.find('option:first').prop('selected', true);
  }

  // Log for debugging
  console.log(`Language selector for ${uid} set to:`, selector.val());
}

// Fix updateTranslationView function
function updateTranslationView(uid) {
  const selectedLang = $(`#translation-lang-${uid}`).val();
  localStorage.setItem(`translation-pref-${uid}`, selectedLang);
  $(`#translationcaps-${uid}`).text(''); // Clear current translation
}

// Function to update all language selectors
function updateAllLanguageSelectors() {
  const selectors = document.querySelectorAll('[id^="translation-lang-"]');
  selectors.forEach(selector => {
    updateLanguageSelector(selector.id.replace('translation-lang-', ''));
  });
}

// ============================================================================
// REAL-TIME TASK CONFIGURATION UPDATES
// ============================================================================

/**
 * Update STT task configuration during an active session
 * 
 * This powerful feature allows modifying transcription/translation settings
 * without stopping and restarting the task. Supported updates:
 * - Enable/disable translation
 * - Change translation languages
 * - Update speaking languages
 * 
 * The updateMask parameter specifies which fields to update:
 * - "translateConfig.enable" - just the enable flag
 * - "translateConfig.enable,translateConfig.languages" - enable and languages
 * - "languages" - speaking languages
 * 
 * @param {string} updateMask - Comma-separated list of fields to update
 * @param {Object} body - New configuration values
 * @returns {Promise<Object>} API response
 * @throws {Error} If no active task or API call fails
 */
async function updateTaskConfiguration(updateMask, body) {
  if (!taskId) {
    throw new Error("No active task to update");
  }
  
  let url;
  let method;
  // Sequence ID ensures updates are applied in order (prevents race conditions)
  let sequenceId = Date.now(); // Using timestamp is simple and works for most cases
  
  // Build URL based on API version
  if (sttVersion === "7.x") {
    url = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/agents/${taskId}/update?sequenceId=${sequenceId}&updateMask=${updateMask}`;
    method = 'POST';
  } else {
    url = `${gatewayAddress}/v1/projects/${options.appid}/rtsc/speech-to-text/tasks/${taskId}?builderToken=${tokenName}&sequenceId=${sequenceId}&updateMask=${updateMask}`;
    method = 'PATCH';
  }
  
  // Make the update request
  const response = await fetch(url, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": GetAuthorization()
    },
    body: JSON.stringify(body)
  });
  
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to update task: ${response.status} - ${errorText}`);
  }
  
  return await response.json();
}

/**
 * Disable translation during an active transcription session
 * 
 * This turns off translation without stopping transcription. Useful when:
 * - User doesn't need translation anymore
 * - Reducing costs (translation adds processing overhead)
 * - Troubleshooting translation issues
 * 
 * Translation can be re-enabled later without restarting transcription.
 */
async function disableTranslationDuringSession() {
  try {
    if (!taskId) {
      showPopup("No active transcription session");
      return;
    }
    
    // Update only the enable flag (keep language configuration)
    const updateMask = "translateConfig.enable";
    const body = {
      translateConfig: {
        enable: false
      }
    };
    
    await updateTaskConfiguration(updateMask, body);
    
    // Update local state
    translationEnabled = false;
    updateTranslationStatus();
    
    // Clear translation overlays (but keep transcription overlays visible)
    $("[id^=translationcaps-]").filter(function() {
      return this.id.match(/^translationcaps-\d+$/);
    }).text("");
    
    // Update button states
    $("#enable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    $("#disable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    
    showPopup("Translation disabled during session");
    
    // Keep translation controls visible so user can re-enable easily
    setTimeout(() => {
      if (taskId) {
        $("#translation-controls").removeClass('hidden');
        console.log("Translation controls should be visible now");
        
        // Clear any late-arriving translation messages
        $("[id^=translationcaps-]").filter(function() {
          return this.id.match(/^translationcaps-\d+$/);
        }).text("");
      }
    }, 300);
  } catch (error) {
    console.error("Error disabling translation:", error);
    showPopup("Failed to disable translation: " + error.message);
  }
}

/**
 * Enable translation during an active transcription session
 * 
 * This turns on translation using the configured language pairs from settings.
 * If translation was previously disabled, this re-enables it.
 * 
 * Requires:
 * - At least one translation pair configured in STT settings
 * - Active transcription session (taskId exists)
 */
async function enableTranslationDuringSession() {
  try {
    if (!taskId) {
      showPopup("No active transcription session");
      return;
    }
    
    // Get current translation pairs from STT settings modal
    const translationPairs = Array.from(document.querySelectorAll('#translation-pairs .translation-pair')).map(pair => {
      const source = pair.querySelector('.source-lang').value;
      const targets = Array.from(pair.querySelectorAll('.target-languages input')).map(input => input.value);
      return {
        source,
        target: targets
      };
    }).filter(pair => pair.source && pair.target.length > 0);
    
    // Validation: must have at least one language pair
    if (translationPairs.length === 0) {
      showPopup("No translation pairs configured. Please configure translation pairs in STT settings first.");
      return;
    }
    
    // Update both enable flag and languages
    let updateMask = "translateConfig.enable,translateConfig.languages";
    let body = {
      translateConfig: {
        enable: true,
        languages: translationPairs
      }
    };
    
    await updateTaskConfiguration(updateMask, body);
    
    // Update local state
    translationEnabled = true;
    updateTranslationStatus();
    
    // Update button states
    $("#enable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    $("#disable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    
    showPopup("Translation enabled");
  } catch (error) {
    console.error("Error enabling translation:", error);
    showPopup("Failed to enable translation: " + error.message);
  }
}

// Function to show translation configuration modal
function showTranslationConfigModal() {
  if (!taskId) {
    showPopup("No active transcription session");
    return;
  }
  
  // Load current translation pairs from STT settings into the modal
  loadSessionTranslationPairs();
  document.getElementById('translationConfigModal').showModal();
}

// Function to load session translation pairs
function loadSessionTranslationPairs() {
  const container = document.getElementById('session-translation-pairs');
  container.innerHTML = '';
  
  // Get current translation pairs from STT settings
  const translationPairs = Array.from(document.querySelectorAll('#translation-pairs .translation-pair')).map(pair => {
    const source = pair.querySelector('.source-lang').value;
    const targets = Array.from(pair.querySelectorAll('.target-languages input')).map(input => input.value);
    return { source, targets };
  }).filter(pair => pair.source && pair.targets.length > 0);
  
  if (translationPairs.length === 0) {
    // Add empty pair if none exist
    addSessionTranslationPair();
  } else {
    // Add existing pairs
    translationPairs.forEach(pair => {
      addSessionTranslationPair(pair.source, pair.targets);
    });
  }
}

// Function to add session translation pair
function addSessionTranslationPair(source = '', targets = ['']) {
  const container = document.getElementById('session-translation-pairs');
  const div = document.createElement('div');
  div.className = 'translation-pair-modal border border-gray-700 p-4 rounded';
  div.innerHTML = `
    <div class="mb-4">
      <div class="flex justify-between items-center mb-2">
        <label class="block">Source Language</label>
        <button onclick="this.closest('.translation-pair').remove();" class="text-red-500 text-sm">Remove Pair</button>
      </div>
      <input type="text" class="source-lang w-full bg-gray-800 rounded p-2" value="${source}" placeholder="e.g., en-US">
    </div>
    <div class="target-languages space-y-2">
      <label class="block mb-2">Target Languages</label>
      ${targets.map(target => `
        <div class="flex gap-2">
          <input type="text" class="flex-1 bg-gray-800 rounded p-2" value="${target}" placeholder="Target language">
          <button onclick="this.parentElement.remove()"></button>
        </div>
      `).join('')}
      <button onclick="addTargetLanguage(this)" class="bg-blue-600 px-3 py-2 rounded w-full">Add Target Language</button>
    </div>
  `;
  container.appendChild(div);
}

// Function to update translation languages during active session
async function updateTranslationLanguagesDuringSession() {
  try {
    if (!taskId) {
      showPopup("No active transcription session");
      return;
    }
    
    // Get current translation pairs from the modal
    const translationPairs = Array.from(document.querySelectorAll('#session-translation-pairs .translation-pair-modal')).map(pair => {
      const source = pair.querySelector('.source-lang').value;
      const targets = Array.from(pair.querySelectorAll('.target-languages input')).map(input => input.value);
      return {
        source,
        target: targets
      };
    }).filter(pair => pair.source && pair.target.length > 0);
    
    if (translationPairs.length === 0) {
      showPopup("No translation pairs configured. Please configure translation pairs first.");
      return;
    }
    
    // Consolidate translation pairs by source language to avoid duplicates
    const consolidatedPairs = {};
    translationPairs.forEach(pair => {
      if (!consolidatedPairs[pair.source]) {
        consolidatedPairs[pair.source] = [];
      }
      // Add all targets for this source, avoiding duplicates
      pair.target.forEach(target => {
        if (!consolidatedPairs[pair.source].includes(target)) {
          consolidatedPairs[pair.source].push(target);
        }
      });
    });
    
    // Convert back to array format
    const finalPairs = Object.entries(consolidatedPairs).map(([source, targets]) => ({
      source,
      target: targets
    }));
    
    // Always enable translation when updating languages (since we're configuring them)
    const updateMask = "translateConfig.enable,translateConfig.languages";
    const body = {
      translateConfig: {
        enable: true,
        languages: finalPairs
      }
    };
    
    await updateTaskConfiguration(updateMask, body);
    translationEnabled = true;
    updateTranslationStatus();
    
    // Update the STT settings modal to reflect the new configuration
    updateSTTSettingsFromSession();
    
    $("#enable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    $("#disable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    showPopup("Translation languages updated and enabled");
    document.getElementById('translationConfigModal').close();
    if (typeof sendSttLanguagesToChannel === "function") sendSttLanguagesToChannel();
  } catch (error) {
    console.error("Error updating translation languages:", error);
    showPopup("Failed to update translation languages: " + error.message);
  }
}

// Function to update translation status display
function updateTranslationStatus() {
  const statusElement = document.getElementById('translation-status');
  if (statusElement) {
    if (translationEnabled) {
      statusElement.textContent = 'Enabled';
      statusElement.className = 'text-sm font-medium text-green-400';
      $("#enable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#disable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    } else {
      statusElement.textContent = 'Disabled';
      statusElement.className = 'text-sm font-medium text-gray-400';
      $("#enable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#disable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    }
  }
}

// Function to update STT settings from session configuration
function updateSTTSettingsFromSession() {
  const sessionPairs = Array.from(document.querySelectorAll('#session-translation-pairs .translation-pair-modal')).map(pair => {
    const source = pair.querySelector('.source-lang').value;
    const targets = Array.from(pair.querySelectorAll('.target-languages input')).map(input => input.value);
    return { source, targets };
  }).filter(pair => pair.source && pair.targets.length > 0);
  
  // Consolidate pairs by source language to avoid duplicates
  const consolidatedPairs = {};
  sessionPairs.forEach(pair => {
    if (!consolidatedPairs[pair.source]) {
      consolidatedPairs[pair.source] = [];
    }
    // Add all targets for this source, avoiding duplicates
    pair.targets.forEach(target => {
      if (!consolidatedPairs[pair.source].includes(target)) {
        consolidatedPairs[pair.source].push(target);
      }
    });
  });
  
  // Update the STT settings modal
  const container = document.getElementById('translation-pairs');
  container.innerHTML = '';
  
  Object.entries(consolidatedPairs).forEach(([source, targets]) => {
    const div = document.createElement('div');
    div.className = 'translation-pair border border-gray-700 p-4 rounded';
    div.innerHTML = `
      <div class="mb-4">
        <div class="flex justify-between items-center mb-2">
          <label class="block">Source Language</label>
          <button onclick="this.closest('.translation-pair').remove(); saveTranslationSettings();" class="text-red-500 text-sm">Remove Pair</button>
        </div>
        <input type="text" class="source-lang w-full bg-gray-800 rounded p-2" value="${source}">
      </div>
      <div class="target-languages space-y-2">
        <label class="block mb-2">Target Languages</label>
        ${targets.map(target => `
          <div class="flex gap-2">
            <input type="text" class="flex-1 bg-gray-800 rounded p-2" value="${target}">
            <button onclick="this.parentElement.remove()"></button>
          </div>
        `).join('')}
        <button onclick="addTargetLanguage(this)" class="bg-blue-600 px-3 py-2 rounded w-full">Add Target Language</button>
      </div>
    `;
    container.appendChild(div);
  });
  
  // Save the updated settings
  saveTranslationSettings();
}

