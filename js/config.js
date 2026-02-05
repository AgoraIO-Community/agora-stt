// Configuration and settings management
// This module manages global application state, settings persistence, and authentication

// ============================================================================
// GLOBAL STATE VARIABLES
// ============================================================================

// Agora RTC client instance - manages the connection to the video/audio channel
var client;

// Connection options for joining an Agora channel
var options = {
  appid: null,    // Your Agora App ID from console.agora.io
  channel: null,  // Channel name (like a room name)
  uid: null,      // User ID (can be string or integer, null for auto-assignment)
  token: null     // RTC token for secure channels (null for testing)
};

// Display indices for transcription/translation history items
let transcribeIndex = 0;
let translateIndex = 0;

// Local media tracks (camera and microphone)
let localTrack = null;        // Video track
var localAudioTrack = null;   // Audio track

// STT (Speech-to-Text) task management
let taskId = '';              // Current transcription task/agent ID from Agora
let tokenName = '';           // Builder token (only used in API version 6.x)
const gatewayAddress = "https://api.agora.io";  // Agora API endpoint
let sttVersion = "7.x";       // API version: "6.x" or "7.x" (7.x is newer and recommended)
let translationEnabled = false; // Whether translation is currently active

// Track available languages for each user in the channel
// This map stores which languages each user can speak and which translations are available
const userLanguages = new Map(); // uid -> { speaking: string, translations: Set<string> }

// Overlay auto-hide management
// Transcription overlays fade out after 5 seconds of no new messages
const overlayTimeouts = new Map(); // uid -> timeout reference
const OVERLAY_HIDE_DELAY = 5000;   // 5 seconds until overlay hides

// Transcript history (final segments only) for the transcripts modal
let transcriptHistory = [];

// Speaking (transcription) language codes sent in start request; used to map msg.lang (int32) to code per segment
let currentSpeakingLanguages = [];

function clearTranscriptHistory() {
  transcriptHistory = [];
}

// Speaking languages from DOM or saved settings; works on any tab (even if it did not start RTT)
function getSpeakingLanguagesConfig() {
  if (currentSpeakingLanguages && currentSpeakingLanguages.length > 0) return currentSpeakingLanguages;
  try {
    var inputs = document.querySelectorAll('#speaking-languages input');
    var list = [];
    if (inputs && inputs.length) {
      inputs.forEach(function (input) {
        var v = (input.value || '').trim();
        if (v) list.push(v);
      });
    }
    if (list.length > 0) return list;
    var saved = JSON.parse(localStorage.getItem('sttSettings') || '{}');
    return (saved.speakingLanguages || []).filter(Boolean);
  } catch (e) {
    return [];
  }
}

// Store translation settings
let translationSettings = {
  pairs: []
};

// Host broadcasts transcription + translation languages over data stream so joiners can build transcript UI
let broadcastedSupportedLanguages = { speaking: [], translationPairs: [] };

function setBroadcastedSupportedLanguages(data) {
  if (data && typeof data === 'object') {
    broadcastedSupportedLanguages = {
      speaking: Array.isArray(data.speaking) ? data.speaking : [],
      translationPairs: Array.isArray(data.translationPairs) ? data.translationPairs : []
    };
  }
}

function stringToUint8Array(str) {
  var result = new Uint8Array(new ArrayBuffer(str.length));
  for (var i = 0; i < str.length; i += 1) result[i] = str.charCodeAt(i);
  return result;
}

function utf8ArrayToString(array) {
  var out = "", i = 0, len = array.length, c, char2, char3;
  if (!(array instanceof Uint8Array)) array = new Uint8Array(array);
  while (i < len) {
    c = array[i++];
    switch (c >> 4) {
      case 0: case 1: case 2: case 3: case 4: case 5: case 6: case 7:
        out += String.fromCharCode(c);
        break;
      case 12: case 13:
        char2 = array[i++];
        out += String.fromCharCode(((c & 0x1F) << 6) | (char2 & 0x3F));
        break;
      case 14:
        char2 = array[i++];
        char3 = array[i++];
        out += String.fromCharCode(((c & 0x0F) << 12) | ((char2 & 0x3F) << 6) | (char3 & 0x3F));
        break;
    }
  }
  return out;
}

// Enable string UID compatibility before creating client (no effect when using integer UIDs)
if (typeof AgoraRTC !== 'undefined') {
  AgoraRTC.setParameter("EXPERIMENTS", { enableStringuidCompatible: true });
}
if (!client) {
  client = AgoraRTC.createClient({
    mode: "live",  // "live" mode for broadcasting scenarios (host/audience roles)
                   // Use "rtc" mode if all participants have equal roles
    codec: "vp8",  // VP8 video codec (better browser support than H.264)
    role: "host"   // "host" can publish media, "audience" can only subscribe
  });
}

// ============================================================================
// SETTINGS PERSISTENCE
// ============================================================================

/**
 * Load previously saved settings from localStorage on page load
 * This provides a better user experience by remembering their configuration
 */
function loadSavedSettings() {
  // Load connection settings (App ID, App Certificate, Customer Key, Customer Secret)
  const savedConnection = JSON.parse(localStorage.getItem('connectionSettings') || '{}');
  if (savedConnection.appid) {
    $("#appid").val(savedConnection.appid);
    options.appid = savedConnection.appid;
  }
  if (savedConnection.appCertificate !== undefined) $("#app-certificate").val(savedConnection.appCertificate);
  if (savedConnection.key) $("#key").val(savedConnection.key);
  if (savedConnection.secret) $("#secret").val(savedConnection.secret);

  // Load STT settings (channel, uid, languages, etc. – channel/uid also set options for join/start)
  const savedSTT = JSON.parse(localStorage.getItem('sttSettings') || '{}');
  if (savedSTT.channel) {
    $("#channel").val(savedSTT.channel);
    options.channel = savedSTT.channel;
  }
  if (savedSTT.uid !== undefined) $("#uid").val(savedSTT.uid);
  if (savedSTT.uidString) {
    $("#uid-string").prop('checked', true);
  } else {
    $("#uid-string").prop('checked', false);
  }
  if (savedSTT.joinToken !== undefined) $("#join-token").val(savedSTT.joinToken);
  if (savedSTT.uid !== undefined && savedSTT.uid !== '') {
    const uidString = !!savedSTT.uidString;
    options.uid = uidString ? savedSTT.uid : parseInt(savedSTT.uid, 10);
  } else {
    options.uid = null;
  }
  if (savedSTT.version) {
    $("#stt-version").val(savedSTT.version);
    sttVersion = savedSTT.version;
  }
  if (savedSTT.maxIdleTime) $("#max-idle-time").val(savedSTT.maxIdleTime);
  if (savedSTT.sliceDuration) $("#slice-duration").val(savedSTT.sliceDuration);
  if (savedSTT.speakingLanguage) $("#speaking-language").val(savedSTT.speakingLanguage);
  if (savedSTT.translationLanguage) $("#translation-language").val(savedSTT.translationLanguage);
}

/** Populate Connection modal form from localStorage (call when opening modal) */
function loadConnectionFormFromStorage() {
  const saved = JSON.parse(localStorage.getItem('connectionSettings') || '{}');
  if (saved.appid !== undefined) $("#appid").val(saved.appid);
  if (saved.appCertificate !== undefined) $("#app-certificate").val(saved.appCertificate);
  if (saved.key !== undefined) $("#key").val(saved.key);
  if (saved.secret !== undefined) $("#secret").val(saved.secret);
}

/** Snapshot of Connection form (taken on open for cancel/close revert) */
var connectionModalSnapshot = null;

function getConnectionFormSnapshot() {
  return {
    appid: $("#appid").val(),
    appCertificate: $("#app-certificate").val(),
    key: $("#key").val(),
    secret: $("#secret").val()
  };
}

function applyConnectionSnapshot(snap) {
  if (!snap) return;
  localStorage.setItem('connectionSettings', JSON.stringify({
    appid: snap.appid,
    appCertificate: snap.appCertificate,
    key: snap.key,
    secret: snap.secret
  }));
  $("#appid").val(snap.appid);
  $("#app-certificate").val(snap.appCertificate);
  $("#key").val(snap.key);
  $("#secret").val(snap.secret);
  options.appid = (snap.appid && String(snap.appid).trim()) ? String(snap.appid).trim() : null;
}

/** Persist Connection form to localStorage (auto-save, no close) */
function persistConnectionSettings() {
  if (!document.getElementById('connectionModal') || !document.getElementById('connectionModal').open) return;
  var appid = ($("#appid").val() || "").trim() || null;
  options.appid = appid;
  var snap = getConnectionFormSnapshot();
  localStorage.setItem('connectionSettings', JSON.stringify({
    appid: snap.appid,
    appCertificate: snap.appCertificate,
    key: snap.key,
    secret: snap.secret
  }));
}

var _connectionPersistTimeout = null;
function debouncedConnectionPersist() {
  clearTimeout(_connectionPersistTimeout);
  _connectionPersistTimeout = setTimeout(persistConnectionSettings, 500);
}

/** Revert Connection modal form to saved state (call on cancel/close without save) */
function revertConnectionFormFromStorage() {
  loadConnectionFormFromStorage();
}

/** Populate STT modal form from localStorage (call when opening modal) */
function loadSTTFormFromStorage() {
  const saved = JSON.parse(localStorage.getItem('sttSettings') || '{}');
  if (saved.channel !== undefined) $("#channel").val(saved.channel);
  if (saved.uid !== undefined) $("#uid").val(saved.uid);
  $("#uid-string").prop('checked', !!saved.uidString);
  if (saved.joinToken !== undefined) $("#join-token").val(saved.joinToken);
  if (saved.version) $("#stt-version").val(saved.version);
  if (saved.maxIdleTime) $("#max-idle-time").val(saved.maxIdleTime);
  if (saved.sliceDuration) $("#slice-duration").val(saved.sliceDuration);
  if (saved.speakingLanguages && Array.isArray(saved.speakingLanguages)) {
    var container = document.getElementById('speaking-languages');
    if (container) {
      container.innerHTML = '';
      saved.speakingLanguages.forEach(function (lang, i) {
        var div = document.createElement('div');
        div.className = 'flex gap-2';
        div.innerHTML = '<input type="text" class="flex-1 bg-gray-800 rounded p-2" value="' + (lang || '').replace(/"/g, '&quot;') + '"><button onclick="addLanguageInput(\'speaking-languages\')" class="modern-btn-icon">+</button>';
        container.appendChild(div);
      });
      if (saved.speakingLanguages.length === 0) {
        var div = document.createElement('div');
        div.className = 'flex gap-2';
        div.innerHTML = '<input type="text" class="flex-1 bg-gray-800 rounded p-2" value="en-US"><button onclick="addLanguageInput(\'speaking-languages\')" class="modern-btn-icon">+</button>';
        container.appendChild(div);
      }
    }
  }
  // Translation pairs are restored by loadTranslationSettings
}

/** Snapshot of STT form (taken on open for cancel/close revert) */
var sttModalSnapshot = null;

function getSTTFormSnapshot() {
  var speakingLanguages = Array.from(document.querySelectorAll('#speaking-languages input'))
    .map(function (input) { return input.value; })
    .filter(function (v) { return (v || '').trim() !== ''; });
  var translationPairs = [];
  if (typeof document.querySelectorAll === 'function') {
    translationPairs = Array.from(document.querySelectorAll('.translation-pair')).map(function (pair) {
      var source = pair.querySelector('.source-lang');
      var targets = Array.from(pair.querySelectorAll('.target-languages input')).map(function (input) { return input.value; }).filter(function (v) { return (v || '').trim() !== ''; });
      return {
        source: source ? source.value : '',
        targets: targets
      };
    }).filter(function (p) { return p.source && p.targets.length > 0; });
  }
  return {
    stt: {
      channel: $("#channel").val(),
      uid: $("#uid").val(),
      uidString: $("#uid-string").is(":checked"),
      joinToken: $("#join-token").val(),
      speakingLanguages: speakingLanguages,
      version: $("#stt-version").val(),
      maxIdleTime: $("#max-idle-time").val(),
      sliceDuration: $("#slice-duration").val()
    },
    translationPairs: translationPairs
  };
}

function applySTTSnapshot(snap) {
  if (!snap || !snap.stt) return;
  localStorage.setItem('sttSettings', JSON.stringify(snap.stt));
  if (typeof translationSettings !== 'undefined') {
    translationSettings.pairs = snap.translationPairs || [];
    localStorage.setItem('translationSettings', JSON.stringify(translationSettings));
  }
  loadSTTFormFromStorage();
  if (typeof loadTranslationSettings === 'function') loadTranslationSettings();
  options.channel = (snap.stt.channel && String(snap.stt.channel).trim()) ? String(snap.stt.channel).trim() : null;
  var uidVal = snap.stt.uid;
  var uidString = !!snap.stt.uidString;
  options.uid = (uidVal !== undefined && uidVal !== '' && String(uidVal).trim() !== '') ? (uidString ? uidVal : parseInt(uidVal, 10)) : null;
}

/** Persist STT form to localStorage (auto-save, no close) */
function persistSTTSettings() {
  if (!document.getElementById('sttModal') || !document.getElementById('sttModal').open) return;
  var channel = $("#channel").val();
  var uidVal = $("#uid").val();
  var uidString = $("#uid-string").is(":checked");
  options.channel = (channel && String(channel).trim()) ? String(channel).trim() : null;
  options.uid = (uidVal !== '' && String(uidVal).trim() !== '') ? (uidString ? uidVal : parseInt(uidVal, 10)) : null;
  var speakingLanguages = Array.from(document.querySelectorAll('#speaking-languages input'))
    .map(function (input) { return input.value; })
    .filter(function (v) { return (v || '').trim() !== ''; });
  var joinToken = $("#join-token").val();
  localStorage.setItem('sttSettings', JSON.stringify({
    channel: channel,
    uid: uidVal,
    uidString: uidString,
    joinToken: joinToken,
    speakingLanguages: speakingLanguages,
    version: $("#stt-version").val(),
    maxIdleTime: $("#max-idle-time").val(),
    sliceDuration: $("#slice-duration").val()
  }));
  if (typeof saveTranslationSettings === 'function') saveTranslationSettings();
}

var _sttPersistTimeout = null;
function debouncedSTTPersist() {
  clearTimeout(_sttPersistTimeout);
  _sttPersistTimeout = setTimeout(persistSTTSettings, 500);
}

/** Revert STT modal form to saved state (call on cancel/close without save) */
function revertSTTFormFromStorage() {
  loadSTTFormFromStorage();
  if (typeof loadTranslationSettings === 'function') loadTranslationSettings();
}

// Flags so close handler knows whether to revert (cancel) or not (save)
var connectionModalSaved = false;
var sttModalSaved = false;

/**
 * Save connection settings to both memory and localStorage
 * Called when user clicks "Save" in the Connection Settings modal
 */
function saveConnectionSettings() {
  options.appid = $("#appid").val() || null;
  const appCertificate = $("#app-certificate").val();
  const key = $("#key").val();
  const secret = $("#secret").val();

  localStorage.setItem('connectionSettings', JSON.stringify({
    appid: options.appid,
    appCertificate: appCertificate,
    key: key,
    secret: secret
  }));

  connectionModalSaved = true;
  document.getElementById('connectionModal').close();
  showPopup("Connection settings saved");
}

function saveSTTSettings() {
  const speakingLanguages = Array.from(document.querySelectorAll('#speaking-languages input'))
    .map(input => input.value)
    .filter(value => value.trim() !== '');

  const channel = $("#channel").val();
  const uidVal = $("#uid").val();
  const uidString = $("#uid-string").is(":checked");
  options.channel = channel || null;
  options.uid = uidVal !== '' ? (uidString ? uidVal : parseInt(uidVal, 10)) : null;

  var joinToken = $("#join-token").val();
  localStorage.setItem('sttSettings', JSON.stringify({
    channel: channel,
    uid: uidVal,
    uidString: uidString,
    joinToken: joinToken,
    speakingLanguages: speakingLanguages,
    version: $("#stt-version").val(),
    maxIdleTime: $("#max-idle-time").val(),
    sliceDuration: $("#slice-duration").val()
  }));

  if (typeof saveTranslationSettings === 'function') saveTranslationSettings();

  sttModalSaved = true;
  document.getElementById('sttModal').close();
  showPopup("STT settings saved");
}

function cancelConnectionModal() {
  applyConnectionSnapshot(connectionModalSnapshot);
  connectionModalSaved = true;
  document.getElementById('connectionModal').close();
}

function cancelSTTModal() {
  applySTTSnapshot(sttModalSnapshot);
  sttModalSaved = true;
  document.getElementById('sttModal').close();
}

// ============================================================================
// RTC TOKEN GENERATION (uses RtcTokenBuilder2 from convo_ai – RTC only)
// ============================================================================

var RTC_TOKEN_EXPIRE = 1800; // 30 minutes

/** Normalize Agora App ID / App Certificate to 32 hex chars (strip spaces/dashes). Returns null if invalid. */
function normalizeAgoraHex(val) {
  if (!val || typeof val !== "string") return null;
  var s = val.trim().replace(/[\s-]/g, "");
  if (s.length !== 32 || !/^[0-9a-fA-F]+$/.test(s)) return null;
  return s;
}

/**
 * Generate RTC token for joining; uses Channel and User ID above (empty = 0), respects Use string UID.
 */
async function generateJoinRtcToken() {
  var appId = normalizeAgoraHex($("#appid").val());
  var appCertificate = normalizeAgoraHex($("#app-certificate").val());
  var channelName = ($("#channel").val() || "").trim();
  var uidVal = ($("#uid").val() || "").trim();
  var uidString = $("#uid-string").is(":checked");
  var account = (uidVal !== "") ? (uidString ? uidVal : String(parseInt(uidVal, 10))) : "0";
  if (uidVal !== "" && !uidString && isNaN(parseInt(uidVal, 10))) account = uidVal;
  if (!appId || !appCertificate) {
    showPopup("App ID and App Certificate must be 32-character hex.");
    return;
  }
  if (!channelName) {
    showPopup("Set Channel Name first.");
    return;
  }
  try {
    var token = await RtcTokenBuilder.buildTokenWithUserAccount(
      appId,
      appCertificate,
      channelName,
      account,
      RtcRole.PUBLISHER,
      RTC_TOKEN_EXPIRE,
      RTC_TOKEN_EXPIRE
    );
    var el = document.getElementById("join-token");
    if (token && el) {
      el.value = token;
      $("#join-token").val(token);
      showPopup("Join token generated.");
    } else if (!token) {
      showPopup("Invalid App ID or App Certificate (32 hex chars).");
    } else {
      showPopup("Could not find token input.");
    }
  } catch (err) {
    console.error("Token generation error:", err);
    showPopup("Token error: " + (err.message || String(err)));
  }
}

/**
 * Generate an RTC token and put it into the given input.
 * Uses App ID and App Certificate from Connection Settings, channel from STT Settings, UID from the given UID input.
 * @param {string} tokenInputId - ID of the input to receive the token (e.g. 'pusher-token', 'puller-token')
 * @param {string} uidInputId - ID of the input that holds the UID for the token (e.g. 'pusher-uid', 'puller-uid')
 */
async function generateRtcTokenForInput(tokenInputId, uidInputId) {
  var appId = normalizeAgoraHex($("#appid").val());
  var appCertificate = normalizeAgoraHex($("#app-certificate").val());
  var channelName = ($("#channel").val() || "").trim();
  var uidVal = ($("#" + uidInputId).val() || "").trim();
  if (!appId || !appCertificate) {
    showPopup("App ID and App Certificate must be 32-character hex.");
    return;
  }
  if (!channelName) {
    showPopup("Set Channel Name first.");
    return;
  }
  if (!uidVal) {
    showPopup("Enter " + (uidInputId === "pusher-uid" ? "Pub" : "Sub") + " Bot UID first.");
    return;
  }
  try {
    var token = await RtcTokenBuilder.buildTokenWithUserAccount(
      appId,
      appCertificate,
      channelName,
      uidVal,
      RtcRole.PUBLISHER,
      RTC_TOKEN_EXPIRE,
      RTC_TOKEN_EXPIRE
    );
    var el = document.getElementById(tokenInputId);
    if (token && el) {
      el.value = token;
      $("#" + tokenInputId).val(token);
      showPopup("Token generated.");
    } else if (!token) {
      showPopup("Invalid App ID or App Certificate (32 hex chars).");
    } else {
      showPopup("Could not find token input.");
    }
  } catch (err) {
    console.error("Token generation error:", err);
    showPopup("Token error: " + (err.message || String(err)));
  }
}

// ============================================================================
// AUTHENTICATION
// ============================================================================

/**
 * Generate HTTP Basic Authentication header for Agora STT API
 * 
 * @returns {string} Authorization header value (e.g., "Basic base64encodedstring")
 * 
 * WARNING: In production, this should be done on your backend server
 * Never expose customer key/secret in client-side code
 */
function GetAuthorization() {
  const customerKey = $("#key").val();
  const customerSecret = $("#secret").val();
  
  if (!customerKey || !customerSecret) {
    showPopup("Please configure Connection settings (Customer Key and Secret) first");
    return "";
  }
  
  // Base64 encode the credentials for HTTP Basic Auth
  return `Basic ${btoa(`${customerKey}:${customerSecret}`)}`;
}

/**
 * Acquire a builder token for STT API (version 6.x only)
 * 
 * Version 7.x simplified authentication and doesn't require this step.
 * Version 6.x requires acquiring a token before starting transcription.
 * 
 * @returns {Promise<Object>} Object containing { tokenName: string }
 * @throws {Error} If token acquisition fails
 */
async function acquireToken() {
  // Version 7.x doesn't use builder tokens
  if (sttVersion === "7.x") {
    return { tokenName: null };
  }

  // Version 6.x requires token acquisition before starting tasks
  const url = `${gatewayAddress}/v1/projects/${options.appid}/rtsc/speech-to-text/builderTokens`;
  const data = { instanceId: options.channel };
  
  let res = await fetch(url, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Authorization": GetAuthorization()
    },
    body: JSON.stringify(data)
  });
  
  if (res.status == 200) {
    res = await res.json();
    return res;  // Contains { tokenName: "..." }
  } else {
    throw new Error(`Failed to acquire token: ${res.status}`);
  }
}

