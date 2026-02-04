// UI updates, popups, button states, and overlay management

// Update button state management
function updateButtonStates(state) {
  switch(state) {
    case 'initial':
      $("#join").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#leave").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#start-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#view-transcripts").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").addClass('hidden');
      break;
    case 'joined':
      $("#join").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#leave").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#start-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#view-transcripts").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").addClass('hidden');
      break;
    case 'transcribing':
      $("#start-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#view-transcripts").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      // Always show translation controls when transcribing, regardless of translation state
      $("#translation-controls").removeClass('hidden');
      $("#enable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#disable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      break;
  }
}

// Show popup notification
var popups = 0;

function showPopup(message) {
  const newPopup = popups + 1;
  console.log(`Popup count: ${newPopup}`);
  const y = $(`<div id="popup-${newPopup}" class="popupHidden">${message}</div>`);
  $("#popup-section").append(y);
  const x = document.getElementById(`popup-${newPopup}`);
  x.className = "popupShow";
  const z = popups * 10;
  $(`#popup-${newPopup}`).css("left", `${50 + z}%`);
  popups++;
  setTimeout(function() {
    $(`#popup-${newPopup}`).remove();
    popups--;
  }, 3000);
}

// Add functions to manage overlay visibility
function showOverlay(uid) {
  // Clear existing timeout if any
  if (overlayTimeouts.has(uid)) {
    clearTimeout(overlayTimeouts.get(uid));
  }
  
  // Show overlay for either local or remote user
  if (uid === options.uid) {
    // Local user
    $(`.video-container .transcription-overlay`).removeClass('hidden');
  } else {
    // Remote user
    $(`#video-wrapper-${uid} .transcription-overlay`).removeClass('hidden');
  }
  
  // Set new timeout to hide overlay
  const timeout = setTimeout(() => hideOverlay(uid), OVERLAY_HIDE_DELAY);
  overlayTimeouts.set(uid, timeout);
}

function hideOverlay(uid) {
  if (uid === options.uid) {
    // Local user
    $(`.video-container .transcription-overlay`).addClass('hidden');
  } else {
    // Remote user
    $(`#video-wrapper-${uid} .transcription-overlay`).addClass('hidden');
  }
  overlayTimeouts.delete(uid);
}

// Show inline alert in STT modal
function showSTTModalAlert(message) {
  const alertDiv = document.getElementById('stt-modal-alert');
  alertDiv.textContent = message;
  alertDiv.classList.remove('hidden');
  // Scroll modal to top so alert is visible
  const sttModal = document.getElementById('sttModal');
  if (sttModal && typeof sttModal.scrollTo === 'function') {
    sttModal.scrollTo({ top: 0, behavior: 'smooth' });
  } else if (sttModal) {
    sttModal.scrollTop = 0;
  }
  setTimeout(() => {
    alertDiv.classList.add('hidden');
  }, 3000);
}

// Function to preview the start request
function previewStartRequest() {
  try {
    const body = buildStartRequestBody();
    const requestBodyElement = document.getElementById('request-body');
    const previewDiv = document.getElementById('request-preview');
    
    // Format the JSON with proper indentation
    const formattedJson = JSON.stringify(body, null, 2);
    requestBodyElement.textContent = formattedJson;
    
    // Show the preview
    previewDiv.classList.remove('hidden');
    
    // Scroll to the preview section
    const sttModal = document.getElementById('sttModal');
    if (sttModal && typeof sttModal.scrollTo === 'function') {
      sttModal.scrollTo({ top: sttModal.scrollHeight, behavior: 'smooth' });
    }
    
  } catch (error) {
    console.error('Error building request preview:', error);
    showSTTModalAlert('Error building request preview: ' + error.message);
  }
}

// Function to copy request to clipboard
async function copyRequestToClipboard() {
  try {
    const requestBodyElement = document.getElementById('request-body');
    const text = requestBodyElement.textContent;
    
    if (navigator.clipboard && window.isSecureContext) {
      // Use the modern clipboard API
      await navigator.clipboard.writeText(text);
    } else {
      // Fallback for older browsers
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      textArea.style.top = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    
    showPopup('Request body copied to clipboard!');
  } catch (error) {
    console.error('Error copying to clipboard:', error);
    showPopup('Failed to copy to clipboard: ' + error.message);
  }
}

// Languages that actually appeared in the stream (transcript history only) – not from page config
function getTranscriptLanguagesFromData() {
  var allLangs = {};
  transcriptHistory.forEach(function (seg) {
    if (seg.sourceLang) allLangs[seg.sourceLang] = true;
    Object.keys(seg.translations || {}).forEach(function (lang) { allLangs[lang] = true; });
  });
  return Object.keys(allLangs).sort();
}

function getTranscriptTabLanguages() {
  var allLangs = {};
  getTranscriptLanguagesFromData().forEach(function (lang) { allLangs[lang] = true; });
  (broadcastedSupportedLanguages.speaking || []).forEach(function (lang) { if (lang) allLangs[lang] = true; });
  (broadcastedSupportedLanguages.translationPairs || []).forEach(function (p) {
    if (p.source) allLangs[p.source] = true;
    (p.targets || []).forEach(function (t) { if (t) allLangs[t] = true; });
  });
  return Object.keys(allLangs).sort();
}

// Tab options: By segment, Transcript (all original speech), then one tab per language (from data + host-broadcast)
function getTranscriptTabOptions() {
  var list = [{ value: 'segment', label: 'By segment' }];
  var hasAnyTranscript = transcriptHistory.some(function (seg) { return seg.transcriptText; });
  if (hasAnyTranscript) list.push({ value: 'transcript', label: 'Transcript' });
  getTranscriptTabLanguages().forEach(function (lang) {
    list.push({ value: lang, label: lang });
  });
  return list;
}

function getTranscriptSelectedLang() {
  var tab = document.querySelector('#transcripts-lang-tabs [data-transcript-tab].transcript-tab-active');
  return tab ? tab.getAttribute('data-transcript-tab') : 'segment';
}

// Build plain text from transcript history (for copy and export) for the currently selected tab
function getTranscriptsAsText(selectedLang) {
  if (selectedLang == null) selectedLang = getTranscriptSelectedLang();
  if (selectedLang === 'segment') {
    var lines = [];
    transcriptHistory.forEach(function (seg) {
      lines.push('[' + seg.time + '] User ' + seg.uid + ':');
      if (seg.transcriptText) lines.push('  ' + seg.transcriptText);
      Object.keys(seg.translations || {}).forEach(function (lang) {
        lines.push('  [' + lang + '] ' + seg.translations[lang]);
      });
      if (!seg.transcriptText && !Object.keys(seg.translations || {}).length) lines.push('  (empty)');
      lines.push('');
    });
    return lines.join('\n').trim() || 'No final transcripts yet.';
  }
  if (selectedLang === 'transcript') {
    var out = [];
    transcriptHistory.forEach(function (seg) {
      if (seg.transcriptText) out.push('[' + seg.time + '] User ' + seg.uid + ': ' + seg.transcriptText);
    });
    return out.length ? out.join('\n') : 'No final transcripts yet.';
  }
  var langLines = [];
  transcriptHistory.forEach(function (seg) {
    var text = (seg.sourceLang === selectedLang && seg.transcriptText) ? seg.transcriptText : (seg.translations || {})[selectedLang];
    if (text) langLines.push('[' + seg.time + '] User ' + seg.uid + ': ' + text);
  });
  return langLines.length ? langLines.join('\n') : 'No final transcripts yet.';
}

// Render modal: build language tabs, then content for selected tab
function renderTranscriptsModalContent() {
  var container = document.getElementById('transcripts-modal-content');
  var emptyEl = document.getElementById('transcripts-empty');
  var tabsContainer = document.getElementById('transcripts-lang-tabs');
  if (!container || !tabsContainer) return;

  container.querySelectorAll('.transcript-segment').forEach(function (el) { el.remove(); });
  container.querySelectorAll('.transcript-script-section').forEach(function (el) { el.remove(); });

  if (!transcriptHistory.length) {
    emptyEl.classList.remove('hidden');
    tabsContainer.innerHTML = '';
    return;
  }

  emptyEl.classList.add('hidden');
  var options = getTranscriptTabOptions();
  var current = getTranscriptSelectedLang();
  var currentExists = options.some(function (o) { return o.value === current; });
  if (!currentExists) current = options[0].value;

  var selectedBeforeRebuild = current;
  tabsContainer.innerHTML = '';
  options.forEach(function (opt, i) {
    var isActive = opt.value === selectedBeforeRebuild || (i === 0 && !currentExists);
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'px-3 py-2 text-sm text-white border-r border-slate-600/50 last:border-r-0 ' + (isActive ? 'transcript-tab-active bg-cyan-600/80' : 'bg-slate-700/80 hover:bg-slate-600/80');
    btn.setAttribute('data-transcript-tab', opt.value);
    btn.textContent = opt.label;
    btn.onclick = function () {
      tabsContainer.querySelectorAll('[data-transcript-tab]').forEach(function (b) {
        b.classList.remove('transcript-tab-active', 'bg-cyan-600/80');
        b.classList.add('bg-slate-700/80');
      });
      btn.classList.remove('bg-slate-700/80');
      btn.classList.add('transcript-tab-active', 'bg-cyan-600/80');
      renderTranscriptsModalContent();
    };
    tabsContainer.appendChild(btn);
  });

  if (selectedBeforeRebuild === 'segment') {
    transcriptHistory.forEach(function (seg) {
      var segEl = document.createElement('div');
      segEl.className = 'transcript-segment rounded-lg border border-slate-600/50 bg-slate-800/80 p-3';
      var html = '<div class="flex items-center gap-2 text-slate-300 text-sm mb-1">';
      html += '<span class="font-medium">User ' + escapeHtml(String(seg.uid)) + '</span>';
      html += '<span class="text-slate-500">' + escapeHtml(seg.time) + '</span>';
      html += '</div>';
      if (seg.transcriptText) html += '<p class="text-white mb-2">' + escapeHtml(seg.transcriptText) + '</p>';
      var trans = seg.translations || {};
      var langs = Object.keys(trans);
      if (langs.length) {
        html += '<div class="space-y-1 pl-2 border-l-2 border-slate-600">';
        langs.forEach(function (lang) {
          html += '<p class="text-slate-300 text-sm"><span class="text-cyan-400">' + escapeHtml(lang) + ':</span> ' + escapeHtml(trans[lang]) + '</p>';
        });
        html += '</div>';
      }
      if (!seg.transcriptText && !langs.length) html += '<p class="text-slate-500 text-sm">(empty)</p>';
      segEl.innerHTML = html;
      container.appendChild(segEl);
    });
  } else if (selectedBeforeRebuild === 'transcript') {
    var sectionEl = document.createElement('div');
    sectionEl.className = 'transcript-script-section';
    var html = '<div class="space-y-1">';
    transcriptHistory.forEach(function (seg) {
      if (seg.transcriptText) html += '<p class="text-slate-300 text-sm">[' + escapeHtml(seg.time) + '] User ' + escapeHtml(String(seg.uid)) + ': ' + escapeHtml(seg.transcriptText) + '</p>';
    });
    html += '</div>';
    sectionEl.innerHTML = html;
    container.appendChild(sectionEl);
  } else {
    var sectionEl = document.createElement('div');
    sectionEl.className = 'transcript-script-section';
    var html = '<div class="space-y-1">';
    transcriptHistory.forEach(function (seg) {
      var text = (seg.sourceLang === selectedBeforeRebuild && seg.transcriptText) ? seg.transcriptText : (seg.translations || {})[selectedBeforeRebuild];
      if (text) html += '<p class="text-slate-300 text-sm">[' + escapeHtml(seg.time) + '] User ' + escapeHtml(String(seg.uid)) + ': ' + escapeHtml(text) + '</p>';
    });
    html += '</div>';
    sectionEl.innerHTML = html;
    container.appendChild(sectionEl);
  }
}

// Open transcripts modal and render content
function openTranscriptsModal() {
  renderTranscriptsModalContent();
  document.getElementById('transcriptsModal').showModal();
}

function escapeHtml(s) {
  const div = document.createElement('div');
  div.textContent = s;
  return div.innerHTML;
}

// Copy transcripts to clipboard
async function copyTranscriptsToClipboard() {
  try {
    const text = getTranscriptsAsText();
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
    } else {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.left = '-999999px';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      document.execCommand('copy');
      textArea.remove();
    }
    showPopup('Transcripts copied to clipboard');
  } catch (err) {
    console.error(err);
    showPopup('Failed to copy: ' + (err.message || 'unknown error'));
  }
}

// Export transcripts as downloadable .txt file
function exportTranscriptsAsTxt() {
  const text = getTranscriptsAsText();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'transcripts-' + new Date().toISOString().slice(0, 19).replace(/:/g, '-') + '.txt';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showPopup('Transcripts exported as TXT');
}

