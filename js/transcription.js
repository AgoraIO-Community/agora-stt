// ============================================================================
// TRANSCRIPTION MANAGEMENT
// ============================================================================
// This module handles starting/stopping transcription and building API requests

/**
 * Start real-time transcription by calling Agora STT API
 * 
 * This function:
 * 1. Authenticates with Agora
 * 2. Acquires a token (if using 6.x API)
 * 3. Builds the configuration request body
 * 4. Calls the appropriate API endpoint based on version
 * 5. Creates an STT "agent" that joins the channel and listens to audio
 * 
 * The agent publishes transcription/translation results back via stream messages
 * 
 * @returns {Promise<Object>} API response with taskId (6.x) or agent_id (7.x)
 * @throws {Error} If authentication fails or API returns error
 */
async function startTranscription() {
  // Get HTTP Basic Auth header
  const authorization = GetAuthorization();
  if (!authorization) {
    throw new Error("key or secret is empty");
  }

  // For version 6.x, acquire a builder token first
  // Version 7.x simplified this and doesn't require a separate token
  const data = await acquireToken();
  tokenName = data.tokenName;

  // Build the complete configuration for the STT agent
  const body = buildStartRequestBody();
  currentSpeakingLanguages = body.languages || [];

  console.log("Starting transcription with body:", body);

  // API endpoints differ between versions
  let url;
  if (sttVersion === "7.x") {
    // 7.x uses /join endpoint
    url = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/join`;
  } else {
    // 6.x uses /tasks endpoint with builder token
    url = `${gatewayAddress}/v1/projects/${options.appid}/rtsc/speech-to-text/tasks?builderToken=${tokenName}`;
  }

  // Make the API call to start transcription
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Authorization": authorization
    },
    body: JSON.stringify(body)
  });

  // Parse response (handle non-JSON responses gracefully)
  const responseText = await res.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch (e) {
    responseData = { message: responseText };
  }

  // Handle HTTP errors
  if (!res.ok) {
    // Special case: 409 Conflict means task already exists
    // This can happen if there was a network glitch and we retry
    if (res.status === 409 && responseData.taskId) {
      taskId = responseData.taskId;
      updateButtonStates('transcribing');
      return { taskId };
    }
    throw new Error(responseData.message || `HTTP error ${res.status}`);
  }

  // Extract task/agent ID from response (different field names per version)
  if (sttVersion === "7.x") {
    if (!responseData.agent_id) {
      throw new Error("No agent_id received from server");
    }
    taskId = responseData.agent_id;
    
    // Verify agent started successfully
    if (responseData.status !== "RUNNING") {
      throw new Error(`Unexpected status: ${responseData.status}`);
    }
  } else {
    // Version 6.x returns "taskId"
    if (!responseData.taskId) {
      throw new Error("No taskId received from server");
    }
    taskId = responseData.taskId;
  }

  // Update UI to reflect transcription is active
  updateButtonStates('transcribing');
  clearTranscriptHistory();

  if (body.translateConfig && body.translateConfig.enable) {
    translationEnabled = true;
  } else {
    translationEnabled = false;
  }
  updateTranslationStatus();
  
  return responseData;
}

// Update stopTranscription to handle button states
async function stopTranscription() {
  if (!taskId) return;
  
  // Determine URL and method based on version
  let url;
  let method;
  if (sttVersion === "7.x") {
    url = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/agents/${taskId}/leave`;
    method = 'POST';
  } else {
    url = `${gatewayAddress}/v1/projects/${options.appid}/rtsc/speech-to-text/tasks/${taskId}?builderToken=${tokenName}`;
    method = 'DELETE';
  }
  
  await fetch(url, {
    method: method,
    headers: {
      "Content-Type": "application/json",
      "Authorization": GetAuthorization()
    }
  });
  
  taskId = null;
  translationEnabled = false;
  $("#enable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
  $("#disable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
  $("#translation-controls").addClass('hidden');
  updateButtonStates('joined');
  
  // Clear all transcriptions captions
  $("[id^=transcriptioncaps-]").text("");
  $("[id^=translationcaps-]").text("");
}

/**
 * Build the request body for starting transcription
 * 
 * This function consolidates all configuration from the UI into the format
 * expected by the Agora STT API. It handles:
 * - Speaking languages (source languages for transcription)
 * - Translation configuration
 * - Bot UIDs and tokens
 * - Encryption settings
 * - Storage configuration (S3)
 * 
 * @returns {Object} Complete configuration object ready for API submission
 */
function buildStartRequestBody() {
  // Core configuration
  const body = {
    // Speaking languages: languages the agent should transcribe
    // For 6.x: max 2 languages, for 7.x: max 4 languages
    languages: Array.from(document.querySelectorAll('#speaking-languages input'))
      .map(input => input.value)
      .filter(value => value.trim() !== ''),
    
    // Max idle time: seconds of silence before agent automatically stops
    // Useful for cost management - agent won't run indefinitely if users are silent
    maxIdleTime: parseInt($("#max-idle-time").val()) || 60,
    
    // RTC configuration: how the agent joins and operates in the Agora channel
    rtcConfig: {
      channelName: options.channel,
      pubBotUid: $("#pusher-uid").val()  // UID for publishing transcription results
    }
  };

  // Bot UIDs and tokens
  // In 6.x: pubBotUid and subBotUid must be different
  // In 7.x: they can be the same (agent uses single UID)
  body.rtcConfig.subBotUid = $("#puller-uid").val();  // UID for subscribing to audio
  const pullToken = $("#puller-token").val();
  if (pullToken) body.rtcConfig.subBotToken = pullToken;

  // Version 7.x requires a "name" field for the agent
  if (sttVersion === "7.x") {
    body.name = options.channel; // Using channel name as the agent name
  }

  // Optional: RTC token for pub bot (if channel requires authentication)
  const pushToken = $("#pusher-token").val();
  if (pushToken) body.rtcConfig.pubBotToken = pushToken;

  // Optional: Encryption settings (if your channel uses encryption)
  // The agent must decrypt audio to transcribe it
  const decryptionMode = $("#decryption-mode").val();
  const secret = $("#encryption-secret").val();
  const salt = $("#encryption-salt").val();
  if (decryptionMode) body.rtcConfig.cryptionMode = parseInt(decryptionMode);
  if (secret) body.rtcConfig.secret = secret;
  if (salt) body.rtcConfig.salt = salt;

  // Translation configuration
  // Extract all source→target language pairs from the UI
  const translationPairs = Array.from(document.querySelectorAll('.translation-pair')).map(pair => {
    const source = pair.querySelector('.source-lang').value;
    const targets = Array.from(pair.querySelectorAll('.target-languages input')).map(input => input.value);
    return {
      source,
      target: targets
    };
  }).filter(pair => pair.source && pair.target.length > 0);

  // Only include translation config if pairs are configured
  if (translationPairs.length > 0) {
    body.translateConfig = {
      enable: true,
      forceTranslateInterval: 5,  // Force translation every 5 seconds even during ongoing speech
      languages: translationPairs
    };
  }

  // Optional: Caption/recording config (7.x) – only sent when storage is configured; sliceDuration applies to recorded slices
  const s3Bucket = $("#s3-bucket").val();
  const sliceDurationVal = parseInt($("#slice-duration").val(), 10);
  const sliceDuration = (sliceDurationVal >= 5 && sliceDurationVal <= 28800) ? sliceDurationVal : 60;
  if (s3Bucket) {
    body.captionConfig = {
      sliceDuration: sliceDuration,
      storage: {
        bucket: s3Bucket
      }
    };

    // S3 credentials (required for private buckets)
    const s3AccessKey = $("#s3-access-key").val();
    const s3SecretKey = $("#s3-secret-key").val();
    if (s3AccessKey && s3SecretKey) {
      body.captionConfig.storage.accessKey = s3AccessKey;
      body.captionConfig.storage.secretKey = s3SecretKey;
    }

    // Storage provider and region
    const s3Vendor = $("#s3-vendor").val();
    if (s3Vendor) {
      body.captionConfig.storage.vendor = parseInt(s3Vendor);  // 1 = AWS, others for different providers
    }

    const s3Region = $("#s3-region").val();
    if (s3Region) {
      body.captionConfig.storage.region = parseInt(s3Region);
    }

    // File naming prefix (e.g., "transcripts/2024/")
    const s3FileNamePrefix = $("#s3-fileNamePrefix").val();
    if (s3FileNamePrefix) {
      body.captionConfig.storage.fileNamePrefix = [s3FileNamePrefix];
    }
  }

  return body;
}

// Add helper functions for transcription display
function addTranscribeItem(uid, text) {
  const timestamp = new Date().toLocaleTimeString();
  const itemId = `transcribecaps-${uid}-${transcribeIndex}`;
  
  if ($(`#${itemId}`)[0]) {
    $(`#${itemId} .msg`).html(text);
  } else {
    const $item = $(`
      <div class="item" id="${itemId}">
        <span class="timestamp">[${timestamp}]</span>
        <span class="uid">${uid}</span>:
        <span class="msg">${text}</span>
      </div>
    `);
    $("#stt-transcribe .content").prepend($item);
  }
}

function addTranslateItem(uid, text) {
  const timestamp = new Date().toLocaleTimeString();
  const itemId = `translatecaps-${uid}-${translateIndex}`;
  
  if ($(`#${itemId}`)[0]) {
    $(`#${itemId} .msg`).html(text);
  } else {
    const $item = $(`
      <div class="item" id="${itemId}">
        <span class="timestamp">[${timestamp}]</span>
        <span class="uid">${uid}</span>:
        <span class="msg">${text}</span>
      </div>
    `);
    $("#stt-translate .content").append($item);
  }
}

