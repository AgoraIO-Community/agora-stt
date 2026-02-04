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
  // Load connection settings (App ID, channel name, UID preferences)
  const savedConnection = JSON.parse(localStorage.getItem('connectionSettings') || '{}');
  if (savedConnection.appid) {
    $("#appid").val(savedConnection.appid);
    options.appid = savedConnection.appid;
  }
  if (savedConnection.channel) {
    $("#channel").val(savedConnection.channel);
    options.channel = savedConnection.channel;
  }
  if (savedConnection.uid !== undefined) {
    $("#uid").val(savedConnection.uid);
  }
  // Restore string UID preference (Agora supports both string and integer UIDs)
  if (savedConnection.uidString) {
    $("#uid-string").prop('checked', true);
  } else {
    $("#uid-string").prop('checked', false);
  }

  // Load STT (Speech-to-Text) settings
  const savedSTT = JSON.parse(localStorage.getItem('sttSettings') || '{}');
  if (savedSTT.key) $("#key").val(savedSTT.key);
  if (savedSTT.secret) $("#secret").val(savedSTT.secret);
  if (savedSTT.version) {
    $("#stt-version").val(savedSTT.version);
    sttVersion = savedSTT.version;
  }
  if (savedSTT.maxIdleTime) $("#max-idle-time").val(savedSTT.maxIdleTime);
  if (savedSTT.speakingLanguage) $("#speaking-language").val(savedSTT.speakingLanguage);
  if (savedSTT.translationLanguage) $("#translation-language").val(savedSTT.translationLanguage);
}

/**
 * Save connection settings to both memory and localStorage
 * Called when user clicks "Save" in the Connection Settings modal
 */
function saveConnectionSettings() {
  options.appid = $("#appid").val();
  options.channel = $("#channel").val();
  
  // Parse UID based on type (string or integer)
  const uidVal = $("#uid").val();
  const uidString = $("#uid-string").is(":checked");
  options.uid = uidVal !== '' ? (uidString ? uidVal : parseInt(uidVal, 10)) : null;
  
  // Persist to localStorage for future sessions
  localStorage.setItem('connectionSettings', JSON.stringify({
    appid: options.appid,
    channel: options.channel,
    uid: uidVal,
    uidString: uidString
  }));
  
  document.getElementById('connectionModal').close();
  showPopup("Connection settings saved");
}

function saveSTTSettings() {
  const speakingLanguages = Array.from(document.querySelectorAll('#speaking-languages input'))
    .map(input => input.value)
    .filter(value => value.trim() !== '');

  localStorage.setItem('sttSettings', JSON.stringify({
    key: $("#key").val(),
    secret: $("#secret").val(),
    speakingLanguages: speakingLanguages,
    version: $("#stt-version").val(),
    maxIdleTime: $("#max-idle-time").val()
  }));
  
  document.getElementById('sttModal').close();
  showPopup("STT settings saved");
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
    showPopup("Please configure STT settings first");
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

