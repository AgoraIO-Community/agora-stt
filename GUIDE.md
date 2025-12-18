# Building Real-Time Speech-to-Text with Translation Using Agora

Picture this: You're in a video call with colleagues from three different countries. Someone speaks in Spanish, another in Mandarin, and you need to understand everything in real-time. Instead of waiting for someone to translate or missing critical information, you see transcriptions and translations appear instantly on screen as people speak.

This guide shows you how to build exactly that—a web application that combines Agora's Real-Time Communication (RTC) platform with Speech-to-Text (STT) to create live transcriptions and translations that appear as transparent overlays on video streams.

## What We're Building

A browser-based application that:
- Joins an Agora video channel
- Transcribes spoken words in real-time
- Translates transcriptions to multiple target languages
- Displays both transcription and translation as transparent overlays on video
- Allows dynamic control of translation during active sessions

By the end, you'll understand how Agora's Speech-to-Text API works, how to receive and process transcription messages, and how to manage real-time translation configurations.

## Architecture Overview

The application follows a modular structure with clear separation of concerns:

```
┌─────────────────────────────────────────────────────────────┐
│                         Browser                              │
│                                                              │
│  ┌──────────────┐    ┌──────────────┐    ┌──────────────┐  │
│  │   UI Layer   │───▶│  Agora RTC   │───▶│  STT Agent   │  │
│  │  (index.html)│◀───│   Client     │◀───│  (Backend)   │  │
│  └──────────────┘    └──────────────┘    └──────────────┘  │
│         │                    │                    │          │
│         ▼                    ▼                    ▼          │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          JavaScript Modules                          │  │
│  │  • config.js - Global state and initialization      │  │
│  │  • main.js - Event handlers and flow control        │  │
│  │  • agora-client.js - RTC event listeners            │  │
│  │  • transcription.js - STT API integration           │  │
│  │  • translation.js - Real-time translation control   │  │
│  │  • ui.js - UI updates and interactions              │  │
│  │  • settings.js - Configuration management           │  │
│  └──────────────────────────────────────────────────────┘  │
│         │                                                    │
│         ▼                                                    │
│  ┌──────────────────────────────────────────────────────┐  │
│  │          Message Decoder                             │  │
│  │  Decodes stream messages from STT agent             │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

**Why this architecture?**

When I first built this, I tried putting everything in one file. Big mistake. When the STT API changed, I had to hunt through 500 lines of code to find the one function that needed updating. 

The modular approach saves you from that pain:
- **Separation of concerns**: Each module has one job. `transcription.js` talks to the API. `agora-client.js` handles RTC events. `ui.js` updates the DOM. When something breaks, you know exactly where to look.
- **Testability**: You can mock `transcription.js` and test your UI logic without hitting the real API. This becomes crucial when debugging edge cases.
- **Maintainability**: When Agora releases API version 8.x, you'll update `transcription.js` and leave everything else untouched.
- **Clarity**: New developers can read `main.js` and understand the entire flow in 50 lines, then dive into specific modules as needed.

## The Complete User Flow

Before diving into code, let's understand what happens when a user interacts with the application:

```
User Opens App
    │
    ├─▶ Configure Connection Settings
    │   (App ID, Channel Name, UID)
    │
    ├─▶ Configure STT Settings
    │   (API version, credentials, languages)
    │
    ├─▶ Click "Join"
    │   └─▶ Create audio/video tracks
    │   └─▶ Publish to Agora channel
    │   └─▶ Subscribe to remote users
    │
    ├─▶ Click "Start RTT"
    │   └─▶ Call Agora STT API
    │   └─▶ STT agent joins channel
    │   └─▶ Agent subscribes to all users
    │   └─▶ Agent publishes transcription via stream messages
    │
    ├─▶ Speak into microphone
    │   └─▶ Audio streams to channel
    │   └─▶ STT agent transcribes
    │   └─▶ Agent sends result as stream message
    │   └─▶ Client receives stream message
    │   └─▶ Client decodes and displays overlay
    │
    ├─▶ (Optional) Enable/Disable Translation
    │   └─▶ Update task configuration via API
    │   └─▶ Agent adjusts translation behavior
    │
    └─▶ Click "Stop RTT" → Click "Leave"
        └─▶ Clean up tracks and connections
```

## Part 1: Setting Up the Foundation

### Project Structure

```
project/
├── index.html              # UI and structure
├── css/
│   └── styles.css          # Modern gradient-based styling
├── js/
│   ├── config.js           # Global configuration
│   ├── main.js             # Main application flow
│   ├── agora-client.js     # RTC event handlers
│   ├── transcription.js    # STT API calls
│   ├── translation.js      # Translation management
│   ├── ui.js               # UI updates
│   └── settings.js         # Settings UI logic
└── proto/
    ├── protobuf.min.js     # Protobuf library (for decoding STT messages)
    └── index.js            # Message schema definition
```

## Part 2: Understanding Agora's STT API

### API Version: 7.x (Current)

Agora STT uses API version 7.x. This guide focuses entirely on 7.x, which is the current and recommended version.

**Note about 6.x**: The codebase includes support for the deprecated 6.x API for legacy compatibility. However, 6.x is no longer recommended and has significant limitations:
- Requires an extra token acquisition step (two API calls instead of one)
- Supports only 2 languages instead of 4
- More complex endpoint structure
- All new AppIDs default to 7.x

If you're starting a new project, you're already on 7.x. If you're maintaining legacy 6.x code, I strongly recommend migrating—the 7.x API is cleaner, more intuitive, and more powerful. The code examples in this guide use 7.x throughout.

### How the STT API Works (7.x)

Here's what happens when you click "Start RTT" using the 7.x API:

1. **Your app calls the STT API** with configuration (languages, channel name, agent UID)
2. **Agora spins up a virtual "agent"**—think of it as a bot that joins your channel
3. **The agent joins your channel** using the UID you specified (in 7.x, the same UID is used for both subscribing and publishing)
4. **The agent subscribes to all users** automatically—it listens to everyone's audio
5. **As people speak, the agent transcribes** their audio in real-time
6. **The agent publishes results** back to the channel as stream messages via Agora's Data Stream
7. **Your app receives these stream messages** through the RTC client's `stream-message` event
8. **You decode the message** and display the text as an overlay on the video

The mental model that clicked for me: **The STT agent is just another participant in your channel**. It's not some external service—it joins like a user, subscribes to audio like a user, and publishes data like a user. The only difference is it's a bot that converts speech to text.

This design is brilliant because it means:
- The agent benefits from Agora's network optimization (it's on the same infrastructure)
- You use the same RTC client to receive transcriptions as you do for video/audio
- No separate WebSocket connections or polling—everything flows through the existing RTC connection

### Authentication (7.x)

The 7.x API uses HTTP Basic Authentication:

```javascript
function GetAuthorization() {
  const customerKey = $("#key").val();      // From Agora Console
  const customerSecret = $("#secret").val(); // From Agora Console
  
  if (!customerKey || !customerSecret) {
    throw new Error("Please configure STT credentials");
  }
  
  // Base64 encode the credentials
  return `Basic ${btoa(`${customerKey}:${customerSecret}`)}`;
}
```

**Where do you get these credentials?**

1. Log in to [Agora Console](https://console.agora.io)
2. Select your project (or create one if you haven't)
3. Navigate to **Extensions** → **Speech-to-Text**
4. Copy your **Customer Key** and **Customer Secret**

**Critical security warning**: 

I'm showing credentials in client-side code because this is a demo. **Never do this in production.** 

Here's what happens if you expose credentials: Anyone can open your website's JavaScript, copy your key and secret, and use your Agora account to transcribe their own channels—on your dime. Your bill could skyrocket overnight.

Instead, build a backend endpoint that:
1. Validates the user's session
2. Adds the credentials server-side
3. Makes the STT API call from your server
4. Returns the `taskId` or `agent_id` to the client

The client never sees the credentials, and you control who can start transcriptions.

## Part 3: Initializing the Agora RTC Client

### Creating the Client

The Agora RTC client manages your connection to the channel:

```javascript
// Initialize as a "live" broadcast client in "host" mode
const client = AgoraRTC.createClient({
  mode: "live",    // "live" for broadcast, "rtc" for communication
  codec: "vp8",    // Video codec (vp8 or h264)
  role: "host"     // "host" can publish, "audience" can only subscribe
});
```

**Why these settings?**

- **mode: "live"**: This optimizes for broadcast scenarios—a few speakers, many viewers. The network stack prioritizes reliability over low latency. If you're building a peer-to-peer video call where everyone talks equally, use `"rtc"` mode instead. For this demo, `"live"` works because we're demonstrating transcription, not building a full communication app.

- **codec: "vp8"**: VP8 has universal browser support. H.264 requires hardware acceleration on some devices and can fail on older browsers. I've seen H.264 fail silently on Safari—VP8 just works everywhere. If you're building a mobile app, H.264 might be better (better battery life), but for web, VP8 is the safe choice.

- **role: "host"**: This is a safety mechanism. Only hosts can publish media. If someone joins as an audience member, they can't accidentally start broadcasting audio/video. In a real app, you'd control this dynamically—promote users to host when they want to speak, demote them when they're done.

### Global State Management

The application maintains state in global variables (in `config.js`):

```javascript
// Connection configuration
var options = {
  appid: null,      // Your Agora App ID
  channel: null,    // Channel name
  uid: null,        // User ID (can be null for auto-assignment)
  token: null       // RTC token (null for testing without security)
};

// STT configuration
let taskId = '';               // Current STT agent ID (7.x)
let translationEnabled = false; // Current translation state

// Translation settings stored persistently
let translationSettings = {
  pairs: []  // Array of {source, targets} objects
};
```

**Why global variables?**

I know, I know—globals are "bad practice." But here's the reality: This is a demo, not a production React app. Adding Redux or Zustand would add 200 lines of boilerplate for managing 5 pieces of state.

The globals live in `config.js` and are clearly documented. They're not scattered across files. They're not mutated randomly. They're a simple, pragmatic solution that works.

If you're building a production app, by all means use proper state management. But for learning and demos, globals are fine. Don't let perfect be the enemy of working.

### Joining a Channel

Here's the complete flow for joining a channel:

```javascript
$("#join").click(async function() {
  // Validate configuration
  if (!options.appid || !options.channel) {
    showPopup("Please configure connection settings first");
    return;
  }
  
  // Parse UID (can be string or integer)
  const uidVal = $("#uid").val();
  const uidString = $("#uid-string").is(":checked");
  let joinUid = null;
  
  if (uidVal !== '') {
    // Convert to number if not using string UID
    joinUid = uidString ? uidVal : parseInt(uidVal, 10);
    if (!uidString && isNaN(joinUid)) joinUid = null;
  }
  
  try {
    // Join the channel (returns assigned UID if joinUid is null)
    options.uid = await client.join(
      options.appid,
      options.channel,
      null,      // RTC token (null for testing)
      joinUid    // Desired UID (null for auto-assignment)
    );
    
    console.log("Joined with UID:", options.uid);
    
    // Create microphone and camera tracks
    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
    localAudioTrack = audioTrack;
    localTrack = videoTrack;
    
    // Publish both tracks to the channel
    await client.publish([audioTrack, videoTrack]);
    
    // Display local video
    videoTrack.play("local-player");
    
    // Initialize UI for transcription display
    updateLanguageSelector(options.uid);
    updateButtonStates('joined');
    
    showPopup("Joined channel successfully");
  } catch (error) {
    console.error(error);
    showPopup("Failed to join channel: " + error.message);
  }
});
```

**Key points:**

1. **UID flexibility**: Agora supports both integer and string UIDs. I use integers in demos (easier to type), but strings are powerful for production—you can use usernames, email addresses, or GUIDs. The checkbox in the UI lets you toggle between them.

2. **Track creation**: `createMicrophoneAndCameraTracks()` does two things: requests browser permissions (that popup you see) and creates the actual media tracks. If the user denies permissions, this throws an error. Always handle that case.

3. **Publishing**: Once you publish, your audio/video streams are live. Everyone in the channel can see and hear you. There's no "preview mode"—publishing means broadcasting.

4. **Error handling**: WebRTC is unreliable by nature. Network drops, codec mismatches, firewall issues—they all cause errors. The try/catch here prevents the entire app from crashing when something goes wrong. I've seen production apps crash because they didn't handle `client.join()` failures.

## Part 4: Starting Transcription

### Building the Request Body

The STT API requires a detailed configuration. Here's how we build it:

```javascript
function buildStartRequestBody() {
  // Core configuration
  const body = {
    // Speaking languages (source languages for transcription)
    languages: Array.from(document.querySelectorAll('#speaking-languages input'))
      .map(input => input.value)
      .filter(value => value.trim() !== ''),
    
    // How long the agent waits for audio before timing out
    maxIdleTime: parseInt($("#max-idle-time").val()) || 60,
    
    // RTC configuration for the agent
    rtcConfig: {
      channelName: options.channel,
      pubBotUid: $("#pusher-uid").val(),    // UID for publishing results
      subBotUid: $("#puller-uid").val(),    // UID for subscribing to audio
    }
  };
  
  // Agent name (required for 7.x)
  body.name = options.channel;
  
  // Optional: RTC tokens for the agent
  const pushToken = $("#pusher-token").val();
  if (pushToken) body.rtcConfig.pubBotToken = pushToken;
  
  const pullToken = $("#puller-token").val();
  if (pullToken) body.rtcConfig.subBotToken = pullToken;
  
  // Optional: Encryption settings
  const decryptionMode = $("#decryption-mode").val();
  const secret = $("#encryption-secret").val();
  const salt = $("#encryption-salt").val();
  
  if (decryptionMode) body.rtcConfig.cryptionMode = parseInt(decryptionMode);
  if (secret) body.rtcConfig.secret = secret;
  if (salt) body.rtcConfig.salt = salt;
  
  // Translation configuration
  const translationPairs = Array.from(document.querySelectorAll('.translation-pair'))
    .map(pair => {
      const source = pair.querySelector('.source-lang').value;
      const targets = Array.from(pair.querySelectorAll('.target-languages input'))
        .map(input => input.value);
      return { source, target: targets };
    })
    .filter(pair => pair.source && pair.target.length > 0);
  
  if (translationPairs.length > 0) {
    body.translateConfig = {
      enable: true,
      forceTranslateInterval: 5,  // Seconds between forced translations
      languages: translationPairs
    };
  }
  
  // Optional: Storage configuration for saving transcripts
  const s3Bucket = $("#s3-bucket").val();
  if (s3Bucket) {
    body.captionConfig = {
      sliceDuration: 60,  // Save every 60 seconds
      storage: {
        bucket: s3Bucket,
        accessKey: $("#s3-access-key").val(),
        secretKey: $("#s3-secret-key").val(),
        vendor: parseInt($("#s3-vendor").val() || "1"),
        region: parseInt($("#s3-region").val() || "0"),
        fileNamePrefix: [$("#s3-fileNamePrefix").val()]
      }
    };
  }
  
  return body;
}
```

**Understanding the configuration:**

- **languages**: Array of locale codes like `["en-US", "zh-CN"]`. The agent listens for any of these languages. If someone speaks Spanish but you only configured English and Chinese, the agent won't transcribe it. This is a cost-saving feature—don't pay for languages you don't need.

- **maxIdleTime**: This is your safety net. If no one speaks for 60 seconds (or whatever you set), the agent automatically stops. Without this, a forgotten transcription session could run for hours, racking up costs. I set it to 60 seconds for demos, but production apps might use 300 seconds (5 minutes) to handle natural conversation pauses.

- **pubBotUid / subBotUid**: In 7.x, these can be the same UID—the agent uses a single UID for both subscribing to audio and publishing transcription results. This simplifies configuration and reduces the chance of UID conflicts.

- **translateConfig.forceTranslateInterval**: Here's a gotcha I learned the hard way: If someone speaks continuously for 30 seconds, the agent might wait until they finish before translating. That creates a jarring experience. The `forceTranslateInterval` (set to 5 seconds) forces a translation every 5 seconds even during ongoing speech, so translations appear incrementally.

- **captionConfig**: This saves transcripts to S3 (or compatible storage) as JSON files. Each file contains 60 seconds of transcription (configurable via `sliceDuration`). Useful for compliance, analytics, or building a transcript history feature.

### Making the API Call (7.x)

```javascript
async function startTranscription() {
  // Get authentication
  const authorization = GetAuthorization();
  if (!authorization) {
    throw new Error("key or secret is empty");
  }
  
  // Build request body
  const body = buildStartRequestBody();
  
  console.log("Starting transcription with body:", body);
  
  // 7.x endpoint - no token needed
  const url = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/join`;
  
  // Make the request
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Authorization": authorization
    },
    body: JSON.stringify(body)
  });
  
  // Parse response
  const responseText = await res.text();
  let responseData;
  try {
    responseData = JSON.parse(responseText);
  } catch (e) {
    responseData = { message: responseText };
  }
  
  // Handle errors
  if (!res.ok) {
    // Special case: task already exists (409 conflict)
    if (res.status === 409 && responseData.taskId) {
      taskId = responseData.taskId;
      updateButtonStates('transcribing');
      return { taskId };
    }
    throw new Error(responseData.message || `HTTP error ${res.status}`);
  }
  
  // Extract agent ID from response (7.x returns agent_id)
  if (!responseData.agent_id) {
    throw new Error("No agent_id received from server");
  }
  taskId = responseData.agent_id;
  
  // Verify agent started successfully
  if (responseData.status !== "RUNNING") {
    throw new Error(`Unexpected status: ${responseData.status}`);
  }
  
  // Update UI state
  updateButtonStates('transcribing');
  
  // Track translation state
  if (body.translateConfig && body.translateConfig.enable) {
    translationEnabled = true;
  } else {
    translationEnabled = false;
  }
  updateTranslationStatus();
  
  return responseData;
}
```

**Why this approach?**

- **Error recovery**: The 409 Conflict handling is crucial. Here's the scenario: User clicks "Start RTT", network glitches, request times out. User clicks again. Without 409 handling, the second request fails because an agent already exists. With it, we recover gracefully by using the existing agent ID. This prevents user frustration.

- **State tracking**: I update the UI immediately after getting the response. If I waited, users might click "Start RTT" multiple times thinking it didn't work. The button disable happens before the API call, but the state update happens right after success.

- **Detailed logging**: I log the entire request body because debugging STT issues is painful without it. When something goes wrong, you need to see exactly what you sent. The console log saves hours of debugging.

**Note**: The codebase includes legacy support for the deprecated 6.x API (which required token acquisition), but 7.x eliminates that step entirely—one less API call, one less point of failure, faster startup time.

## Part 5: Receiving and Decoding Transcriptions

### Understanding Stream Messages

Agora STT sends transcription results as stream messages via the Data Stream. The messages are in protobuf format (Agora's standard), which the protobuf.js library decodes automatically.

**What you need to know:**

The STT agent sends two types of messages, identified by the `data_type` field:
1. **"transcribe"** - Contains the original transcribed text with word-level timing and confidence scores
2. **"translate"** - Contains translations in multiple target languages (if translation is enabled)

Each message includes:
- **uid** - Which user is speaking
- **words** - Array of transcribed text
- **trans** - Array of translations (one per target language)
- **isFinal** - Whether this is the final result or an interim update

The message schema is defined in `proto/index.js` and the decoding happens automatically.

### Handling Stream Messages

When the STT agent publishes results, your app receives them as stream messages. Here's the basic flow:

```javascript
client.on("stream-message", function(uid, data) {
  try {
    // Decode the stream message
    const Text = $protobufRoot.lookup("agora.audio2text.Text");
    const msg = Text.decode(data);
    
    // Show the overlay
    showOverlay(msg.uid);
    
    // Handle transcription
    if (msg.data_type === "transcribe") {
      const text = msg.words.map(word => word.text).join("");
      $(`#transcriptioncaps-${msg.uid}`).text(text);
    } 
    // Handle translation
    else if (msg.data_type === "translate") {
      const selectedLang = $(`#translation-lang-${msg.uid}`).val();
      const translation = msg.trans.find(t => t.lang === selectedLang);
      if (translation) {
        const text = translation.texts.join("");
        $(`#translationcaps-${msg.uid}`).text(text);
      }
    }
  } catch (error) {
    console.error("Error handling stream message:", error);
  }
});
```

**What's happening:**

1. The RTC client fires a `stream-message` event whenever the STT agent publishes data
2. We decode the message using the schema defined in `proto/index.js`
3. The `data_type` field tells us if this is a transcription (`"transcribe"`) or translation (`"translate"`)
4. For transcriptions, we join all word fragments into a single string and display it
5. For translations, we find the translation matching the user's selected language and display it
6. Errors are caught and logged—we never want a bad message to crash the entire app

The key insight: Each user has their own language selector. If User A speaks English and User B speaks Spanish, you can view User A's translation in French while viewing User B's translation in German. The selector is per-user, not global.

### Displaying Overlays

The transcription overlay is positioned absolutely over the video:

```html
<div class="transcription-overlay hidden">
  <div id="transcriptioncaps-${uid}" class="text-xl mb-2"></div>
  <div id="translationcaps-${uid}" class="text-gray-300"></div>
</div>
```

With CSS (in `styles.css`):

```css
.transcription-overlay {
  position: absolute;
  bottom: 0;
  left: 0;
  right: 0;
  background: transparent;
  padding: 1.5rem;
  color: white;
  z-index: 10;
  text-align: center;
  transition: opacity 0.3s ease;
}

.transcription-overlay div {
  text-shadow: 0 2px 8px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.8);
  background: rgba(0, 0, 0, 0.3);
  padding: 0.5rem 0.75rem;
  border-radius: 0.5rem;
  display: block;
  margin-bottom: 0.5rem;
  width: fit-content;
  max-width: 90%;
}

.transcription-overlay.hidden {
  opacity: 0;
  pointer-events: none;
}
```

**Design decisions:**

- **Transparent background**: The video is the main content. The transcription should enhance it, not obscure it. A fully opaque overlay would block important visual information.

- **Text shadow**: This is critical. Without it, white text on a white shirt or light background becomes unreadable. The double shadow (`0 2px 8px rgba(0, 0, 0, 0.9), 0 0 4px rgba(0, 0, 0, 0.8)`) ensures the text is readable on any background.

- **Semi-transparent badge**: The `rgba(0, 0, 0, 0.3)` background provides just enough contrast to make text readable while still showing the video behind it. I experimented with different opacities—0.3 was the sweet spot.

- **Auto-hide**: Overlays fade out after 5 seconds of silence. Why? Because persistent overlays are distracting. Users found that overlays staying on screen after someone stopped talking made it hard to focus on the video. The 5-second delay gives enough time to read the text without being intrusive.

### Managing Overlay Visibility

To prevent overlays from permanently covering video, we auto-hide them:

```javascript
// In config.js
const overlayTimeouts = new Map(); // uid -> timeout
const OVERLAY_HIDE_DELAY = 5000;   // 5 seconds

// In ui.js
function showOverlay(uid) {
  // Clear existing timeout if any
  if (overlayTimeouts.has(uid)) {
    clearTimeout(overlayTimeouts.get(uid));
  }
  
  // Show overlay
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
    $(`.video-container .transcription-overlay`).addClass('hidden');
  } else {
    $(`#video-wrapper-${uid} .transcription-overlay`).removeClass('hidden');
  }
  overlayTimeouts.delete(uid);
}
```

**Why auto-hide?**

Early versions of this demo kept overlays visible forever. User feedback was clear: "It's too cluttered" and "I can't see the video." 

The 5-second auto-hide strikes a balance: long enough to read the transcription, short enough to not be distracting. Each new message resets the timer, so active conversations keep the overlay visible, while silence clears the screen.

The implementation uses a `Map` to track timeouts per user. When a new message arrives, we clear the old timeout and start a new one. This prevents memory leaks and ensures each user's overlay is managed independently.

## Part 6: Dynamic Translation Control

Here's where this demo gets interesting: You can enable, disable, or completely reconfigure translation **while transcription is running**. No need to stop, restart, or lose context. This is a game-changer for real-world usage.

### Enabling Translation Mid-Session

```javascript
async function enableTranslationDuringSession() {
  try {
    if (!taskId) {
      showPopup("No active transcription session");
      return;
    }
    
    // Get current translation pairs from settings
    const translationPairs = Array.from(document.querySelectorAll('#translation-pairs .translation-pair'))
      .map(pair => {
        const source = pair.querySelector('.source-lang').value;
        const targets = Array.from(pair.querySelectorAll('.target-languages input'))
          .map(input => input.value);
        return { source, target: targets };
      })
      .filter(pair => pair.source && pair.target.length > 0);
    
    if (translationPairs.length === 0) {
      showPopup("No translation pairs configured. Please configure translation pairs in STT settings first.");
      return;
    }
    
    // Build update request
    const updateMask = "translateConfig.enable,translateConfig.languages";
    const body = {
      translateConfig: {
        enable: true,
        languages: translationPairs
      }
    };
    
    // Call update API
    await updateTaskConfiguration(updateMask, body);
    
    // Update local state
    translationEnabled = true;
    updateTranslationStatus();
    
    // Update UI
    $("#enable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    $("#disable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    
    showPopup("Translation enabled");
  } catch (error) {
    console.error("Error enabling translation:", error);
    showPopup("Failed to enable translation: " + error.message);
  }
}
```

**What's happening here?**

1. **Validation**: We check `taskId` exists—if transcription isn't running, there's nothing to update. This prevents confusing error messages.

2. **Configuration retrieval**: We read translation pairs directly from the STT settings modal DOM. This means users can configure languages in the modal, then enable them without restarting transcription.

3. **API call**: The `updateMask` parameter is crucial—it tells Agora "only update these specific fields." Without it, you'd have to send the entire configuration, which is error-prone and verbose.

4. **State synchronization**: We update `translationEnabled` and call `updateTranslationStatus()` to keep the UI in sync. If the API call succeeds but the UI doesn't update, users get confused.

5. **UI update**: We disable the "Enable" button and enable the "Disable" button. This prevents double-enabling and makes the current state obvious.

### The Update Mask Pattern

The `updateMask` parameter is a comma-separated list of field paths:

```javascript
// Update only the enable flag
updateMask = "translateConfig.enable"

// Update both enable flag and languages
updateMask = "translateConfig.enable,translateConfig.languages"

// Update speaking languages
updateMask = "languages"
```

This pattern allows fine-grained updates without resending the entire configuration.

### Disabling Translation

```javascript
async function disableTranslationDuringSession() {
  try {
    if (!taskId) {
      showPopup("No active transcription session");
      return;
    }
    
    const updateMask = "translateConfig.enable";
    const body = {
      translateConfig: {
        enable: false
      }
    };
    
    await updateTaskConfiguration(updateMask, body);
    
    // Update state
    translationEnabled = false;
    updateTranslationStatus();
    
    // Clear translation overlays (but keep transcription)
    $("[id^=translationcaps-]").text("");
    
    // Update UI
    $("#enable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
    $("#disable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
    
    showPopup("Translation disabled during session");
  } catch (error) {
    console.error("Error disabling translation:", error);
    showPopup("Failed to disable translation: " + error.message);
  }
}
```

**Why keep the controls visible?**

I initially hid the translation controls when disabled. User testing revealed a problem: users forgot translation existed. They'd disable it, then later want it back but couldn't find the button.

Keeping controls visible serves two purposes:
1. **Discoverability**: Users see that translation is available even when disabled
2. **Quick re-enable**: One click to turn it back on, no hunting through menus

The status indicator shows "Disabled" in gray, making the current state clear without hiding functionality.

### Updating Translation Languages

Users can also change which languages are being translated:

```javascript
async function updateTranslationLanguagesDuringSession() {
  try {
    if (!taskId) {
      showPopup("No active transcription session");
      return;
    }
    
    // Get translation pairs from the modal
    const translationPairs = Array.from(document.querySelectorAll('#session-translation-pairs .translation-pair-modal'))
      .map(pair => {
        const source = pair.querySelector('.source-lang').value;
        const targets = Array.from(pair.querySelectorAll('.target-languages input'))
          .map(input => input.value);
        return { source, target: targets };
      })
      .filter(pair => pair.source && pair.target.length > 0);
    
    if (translationPairs.length === 0) {
      showPopup("No translation pairs configured. Please configure translation pairs first.");
      return;
    }
    
    // Consolidate pairs by source language (avoid duplicates)
    const consolidatedPairs = {};
    translationPairs.forEach(pair => {
      if (!consolidatedPairs[pair.source]) {
        consolidatedPairs[pair.source] = [];
      }
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
    
    // Update configuration
    const updateMask = "translateConfig.enable,translateConfig.languages";
    const body = {
      translateConfig: {
        enable: true,
        languages: finalPairs
      }
    };
    
    await updateTaskConfiguration(updateMask, body);
    
    // Update state
    translationEnabled = true;
    updateTranslationStatus();
    
    // Sync the main STT settings modal
    updateSTTSettingsFromSession();
    
    showPopup("Translation languages updated and enabled");
    document.getElementById('translationConfigModal').close();
  } catch (error) {
    console.error("Error updating translation languages:", error);
    showPopup("Failed to update translation languages: " + error.message);
  }
}
```

**The consolidation step is crucial:**

Here's a bug I hit early: If a user configures two pairs with the same source language:
- `en-US → es-ES`
- `en-US → ru-RU`

And you send both to the API, Agora returns an error: "Duplicate source language." The API expects one source language with multiple targets, not multiple pairs with the same source.

The consolidation step merges these into:
- `en-US → [es-ES, ru-RU]`

This prevents API errors and also creates a cleaner UI—the language selector shows "en-US → es-ES" and "en-US → ru-RU" as separate options, which is what users expect.

### The Update API Call

```javascript
async function updateTaskConfiguration(updateMask, body) {
  if (!taskId) {
    throw new Error("No active task to update");
  }
  
  // Sequence ID ensures updates are applied in order
  let sequenceId = Date.now();
  
  // 7.x endpoint - POST to /update
  const url = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/agents/${taskId}/update?sequenceId=${sequenceId}&updateMask=${updateMask}`;
  
  // Make the request
  const response = await fetch(url, {
    method: 'POST',
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
```

**Why use sequenceId?**

Imagine this scenario: User clicks "Enable Translation" and immediately clicks "Configure" to change languages. Two API calls fire almost simultaneously. Without `sequenceId`, the API might process them out of order—you enable translation with old languages, then update languages but translation is already enabled with the wrong config.

The `sequenceId` ensures updates are applied in the order you send them. Agora uses it to queue updates and process them sequentially.

I use `Date.now()` as the sequence ID because it's simple and monotonically increasing. For production apps with high update rates, you might want a proper sequence counter, but for this demo, timestamps work fine.

## Part 7: Managing Translation Language Selectors

### The Challenge

In a multi-user channel with translation, each user might speak different source languages. The UI needs to let viewers select which translation they want to see for each user.

For example:
- User A speaks English
- User B speaks Chinese
- Translation is configured: `en-US → [es-ES, ru-RU]` and `zh-CN → [en-US, es-ES]`
- Viewer should be able to select Spanish or Russian for User A, and English or Spanish for User B

### Building the Language Selector

```javascript
function updateLanguageSelector(uid) {
  const selector = $(`#translation-lang-${uid}`);
  const currentSelection = selector.val();
  
  // Get all configured target languages from settings
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
  
  // Create options showing source → target
  const allTargetLanguages = Object.entries(consolidatedPairs).reduce((acc, [source, targets]) => {
    targets.forEach(target => {
      acc.push({ source, target });
    });
    return acc;
  }, []);
  
  // Populate dropdown
  selector.empty();
  allTargetLanguages.forEach(({ source, target }) => {
    const option = $(`<option value="${target}">${source} → ${target}</option>`);
    selector.append(option);
  });
  
  // Restore previous selection if possible
  if (currentSelection && selector.find(`option[value="${currentSelection}"]`).length) {
    selector.val(currentSelection);
  } else {
    selector.find('option:first').prop('selected', true);
  }
  
  console.log(`Language selector for ${uid} set to:`, selector.val());
}
```

**Why show "source → target"?**

I tried just showing the target language ("es-ES") in the dropdown. Users were confused: "Is this translating from English? Spanish? Chinese?" Without context, the selector was useless.

The "en-US → es-ES" format makes it immediately clear: "This option shows Spanish translations of English speech." In a multi-language channel where different users speak different languages, this context is essential.

The format also helps when you have multiple source languages. If you configure `en-US → es-ES` and `zh-CN → es-ES`, the dropdown shows both, and users can choose which source language they want to see translated to Spanish.

### Persisting User Preferences

```javascript
function updateTranslationView(uid) {
  const selectedLang = $(`#translation-lang-${uid}`).val();
  
  // Save preference to localStorage
  localStorage.setItem(`translation-pref-${uid}`, selectedLang);
  
  // Clear current translation (new one will appear with next message)
  $(`#translationcaps-${uid}`).text('');
}
```

When a user returns to the app, their language preferences are restored:

```javascript
// In updateLanguageSelector, after populating options:
const savedPref = localStorage.getItem(`translation-pref-${uid}`);
if (savedPref && selector.find(`option[value="${savedPref}"]`).length) {
  selector.val(savedPref);
}
```

This creates a seamless experience across sessions.

## Part 8: Stopping Transcription and Cleanup

### Stopping the STT Agent (7.x)

```javascript
async function stopTranscription() {
  if (!taskId) return;
  
  // 7.x endpoint - POST to /leave
  const url = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/agents/${taskId}/leave`;
  
  // Make the request
  await fetch(url, {
    method: 'POST',
    headers: {
      "Content-Type": "application/json",
      "Authorization": GetAuthorization()
    }
  });
  
  // Reset state
  taskId = null;
  translationEnabled = false;
  
  // Update UI
  $("#enable-translation").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
  $("#disable-translation").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
  $("#translation-controls").addClass('hidden');
  updateButtonStates('joined');
  
  // Clear all caption overlays
  $("[id^=transcriptioncaps-]").text("");
  $("[id^=translationcaps-]").text("");
}
```

**Why clear captions?**

When you stop transcription, the overlays still show the last message that was transcribed. If you restart transcription later, those old captions would still be visible, creating confusion: "Is this new transcription or old transcription?"

Clearing captions on stop ensures a clean slate. When you start transcription again, the overlays are empty and ready for new data. It's a small detail, but it prevents user confusion.

### Leaving the Channel

```javascript
$("#leave").click(async function() {
  try {
    // Clear all overlay timeouts
    overlayTimeouts.forEach((timeout, uid) => {
      clearTimeout(timeout);
    });
    overlayTimeouts.clear();
    
    // Hide all overlays
    $(`.transcription-overlay`).addClass('hidden');
    
    // Stop and close local tracks
    if (localTrack) {
      localTrack.stop();
      localTrack.close();
    }
    if (localAudioTrack) {
      localAudioTrack.stop();
      localAudioTrack.close();
    }
    
    // Leave the channel
    await client.leave();
    
    // Clear UI
    $("#local-player").empty();
    $("#remote-playerlist").empty();
    
    // Update button states
    updateButtonStates('initial');
    
    showPopup("Left channel successfully");
  } catch (error) {
    console.error(error);
    showPopup("Failed to leave channel");
  }
});
```

**The importance of cleanup:**

I learned this the hard way: If you don't properly clean up, the app becomes unusable after a few join/leave cycles. Here's what each step does:

- **Stop tracks**: Releases the camera and microphone hardware. Without this, the browser keeps the camera light on and other apps can't access the camera.

- **Close tracks**: Frees the memory used by the track objects. Agora tracks hold buffers and codec state—they're not tiny. Leaving them open causes memory leaks.

- **Clear timeouts**: The overlay auto-hide uses `setTimeout`. If you leave the channel without clearing them, those timeouts still fire and try to manipulate DOM elements that no longer exist. This causes errors and memory leaks.

- **Clear UI**: Removes all video elements from the DOM. Without this, you'd see ghost video elements from previous sessions.

Proper cleanup is the difference between a demo that works once and a production app that works reliably.

## Part 9: UI/UX Considerations

### Button State Management

The application uses explicit state management for buttons:

```javascript
function updateButtonStates(state) {
  switch(state) {
    case 'initial':
      // Can join and start RTT (if credentials configured)
      $("#join").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#leave").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#start-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").addClass('hidden');
      break;
      
    case 'joined':
      // Can leave and start RTT
      $("#join").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#leave").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#start-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").addClass('hidden');
      break;
      
    case 'transcribing':
      // Can stop RTT and manage translation
      $("#start-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").removeClass('hidden');
      break;
  }
}
```

**Why explicit states?**

Early versions of this demo used boolean flags: `isJoined`, `isTranscribing`. The problem? You could have `isJoined = false` and `isTranscribing = true`—an impossible state that broke the UI.

The explicit state machine prevents this. There are only three valid states:
- `initial`: Not joined, can join
- `joined`: Joined, can start transcription
- `transcribing`: Transcribing, can stop

Each state transition is explicit and validated. You can't start transcription in `initial` state because the button is disabled. You can't join in `transcribing` state because the join button is disabled.

This makes the flow obvious to users—disabled buttons show what you can't do, enabled buttons show what you can do. No guessing, no confusion.

### Popup Notifications

For transient feedback, we use popup notifications:

```javascript
var popups = 0; // Track number of active popups

function showPopup(message) {
  const newPopup = popups + 1;
  const y = $(`<div id="popup-${newPopup}" class="popupHidden">${message}</div>`);
  $("#popup-section").append(y);
  
  const x = document.getElementById(`popup-${newPopup}`);
  x.className = "popupShow";
  
  // Offset multiple popups
  const z = popups * 10;
  $(`#popup-${newPopup}`).css("left", `${50 + z}%`);
  
  popups++;
  
  // Auto-remove after 3 seconds
  setTimeout(function() {
    $(`#popup-${newPopup}`).remove();
    popups--;
  }, 3000);
}
```

**Why not use `alert()`?**

`alert()` is the nuclear option. It blocks the entire browser, looks terrible, and can't be styled. For a modern web app, it's unacceptable.

The custom popup system solves three problems:
- **Non-blocking**: Users can continue interacting while the popup is visible. If you use `alert()`, the entire app freezes until the user clicks OK.

- **Stackable**: If multiple events fire (e.g., "Joined channel" and "Started transcription"), both popups appear. With `alert()`, you'd only see the last one.

- **Branded**: The popups use the same gradient styling as the rest of the app. They feel integrated, not like browser errors.

The implementation tracks popup count and offsets each new popup slightly to the right, so multiple popups don't overlap. After 3 seconds, they auto-dismiss.

### Modal Dialogs

Settings are configured via modal dialogs using HTML `<dialog>`:

```html
<dialog id="sttModal">
  <div class="flex items-center gap-3 mb-8 pb-4 border-b border-slate-700/50">
    <h2>STT Settings</h2>
  </div>
  
  <div class="space-y-6">
    <!-- Settings fields -->
  </div>
  
  <div class="flex justify-end gap-4 mt-8">
    <button onclick="this.closest('dialog').close()">Cancel</button>
    <button onclick="saveSTTSettings()">Save</button>
  </div>
</dialog>
```

Opened with:

```javascript
document.getElementById('sttModal').showModal();
```

**Why `<dialog>`?**

I used to build modals with `<div>` elements and custom JavaScript. Then I discovered the `<dialog>` element and never looked back.

- **Built-in backdrop**: The `::backdrop` pseudo-element handles the dimming automatically. No need to create a separate overlay div.

- **Focus management**: When you open a dialog, focus automatically moves to the first focusable element inside it. When you close it, focus returns to the element that opened it. This is crucial for keyboard navigation and screen readers.

- **ESC handling**: Press ESC, the dialog closes. No event listeners needed. This is expected behavior that users rely on.

- **Accessibility**: Screen readers announce dialogs properly. The `role="dialog"` and `aria-modal` attributes are handled automatically.

The only gotcha: Some older browsers don't support `<dialog>`. For this demo, that's fine—modern browsers all support it. For production, you might need a polyfill.

## Part 10: Advanced Features

### Request Preview

Before starting transcription, users can preview the exact JSON that will be sent:

```javascript
function previewStartRequest() {
  try {
    // Build the request body (same function used for actual start)
    const body = buildStartRequestBody();
    
    // Format with indentation
    const formattedJson = JSON.stringify(body, null, 2);
    
    // Display in a <pre> element
    document.getElementById('request-body').textContent = formattedJson;
    document.getElementById('request-preview').classList.remove('hidden');
    
    // Scroll to preview
    const sttModal = document.getElementById('sttModal');
    if (sttModal && typeof sttModal.scrollTo === 'function') {
      sttModal.scrollTo({ top: sttModal.scrollHeight, behavior: 'smooth' });
    }
  } catch (error) {
    console.error('Error building request preview:', error);
    showSTTModalAlert('Error building request preview: ' + error.message);
  }
}
```

This feature saved me hours of debugging. Here's why it's invaluable:

- **Debugging**: When transcription fails, the first question is "what did we actually send?" The preview shows the exact JSON, so you can spot configuration errors immediately.

- **Learning**: New developers can see the API format without reading documentation. They configure the UI, preview the request, and understand how the pieces fit together.

- **Documentation**: When reporting bugs to Agora support, you can copy the exact request body. This makes debugging much faster than describing the configuration verbally.

The preview uses `JSON.stringify(body, null, 2)` to format the JSON with proper indentation, making it readable. There's also a "Copy" button to quickly copy it to the clipboard.

### S3 Storage Integration

For long-term storage of transcripts:

```javascript
// In buildStartRequestBody()
const s3Bucket = $("#s3-bucket").val();
if (s3Bucket) {
  body.captionConfig = {
    sliceDuration: 60,  // Save every 60 seconds
    storage: {
      bucket: s3Bucket,
      accessKey: $("#s3-access-key").val(),
      secretKey: $("#s3-secret-key").val(),
      vendor: parseInt($("#s3-vendor").val() || "1"),  // 1 = AWS, others for different providers
      region: parseInt($("#s3-region").val() || "0"),
      fileNamePrefix: [$("#s3-fileNamePrefix").val()]
    }
  };
}
```

The STT agent will save transcripts as JSON files to your S3 bucket. File names follow the pattern:

```
{fileNamePrefix}_{channelName}_{uid}_{timestamp}.json
```

**Use cases:**

- **Compliance**: Some industries (healthcare, finance) require call recording and transcription. S3 storage provides an audit trail.

- **Analytics**: Store transcripts, then analyze them later. Build features like "search past meetings" or "sentiment analysis of conversations."

- **Archival**: Keep a permanent record of important meetings. The JSON format makes it easy to parse and display later.

The files are saved with a naming pattern: `{fileNamePrefix}_{channelName}_{uid}_{timestamp}.json`. This makes it easy to organize and find specific transcripts.

### Encryption Support

If your Agora channel uses encryption:

```javascript
const decryptionMode = $("#decryption-mode").val();
const secret = $("#encryption-secret").val();
const salt = $("#encryption-salt").val();

if (decryptionMode) body.rtcConfig.cryptionMode = parseInt(decryptionMode);
if (secret) body.rtcConfig.secret = secret;
if (salt) body.rtcConfig.salt = salt;
```

The STT agent must use the same encryption settings as your channel to decrypt audio streams.

**Encryption modes:**

Agora supports multiple encryption algorithms. The mode number corresponds to:
- `1`: AES-128-XTS (common for general use)
- `2`: AES-128-ECB (less secure, not recommended)
- `3`: AES-256-XTS (stronger, for sensitive data)
- `5`: SM4-128-ECB (Chinese standard, for compliance in China)
- `7`: AES-128-GCM2 (authenticated encryption, recommended)
- `8`: AES-256-GCM2 (strongest, for highly sensitive data)

The STT agent must use the same encryption settings as your channel. If your channel uses mode 3 but the agent uses mode 1, the agent can't decrypt the audio and transcription fails silently.

## Part 11: Production Considerations

### Security Best Practices

**Never expose credentials in client-side code:**

```javascript
// ❌ BAD: Credentials in frontend
const customerKey = "your-key-here";
const customerSecret = "your-secret-here";

// ✅ GOOD: Call your backend
async function startTranscription() {
  const response = await fetch('/api/start-transcription', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      channel: options.channel,
      languages: ['en-US'],
      translationPairs: [{ source: 'en-US', target: ['es-ES'] }]
    })
  });
  
  return await response.json();
}
```

Your backend server becomes a proxy:
1. **Validates the request**: Check user authentication, rate limits, channel permissions
2. **Adds credentials**: Inject the Customer Key and Secret server-side (never exposed to client)
3. **Calls Agora STT API**: Make the actual API call from your server
4. **Returns the taskId**: Send just the `taskId` or `agent_id` back to the client

The client never sees the credentials, and you have full control over who can start transcriptions. You can also add features like usage tracking, cost monitoring, and automatic cleanup of forgotten sessions.

### Token-Based Channel Security

For production channels, use RTC tokens:

```javascript
// Generate token on your backend
const token = generateAgoraToken(appId, appCertificate, channelName, uid);

// Join with token
options.uid = await client.join(options.appid, options.channel, token, uid);
```

Tokens expire after a configurable duration (default 24 hours). This is a security feature—even if someone steals a token, it becomes useless after expiration. For production, generate short-lived tokens (1-2 hours) and refresh them automatically.

### Error Handling

Production apps need comprehensive error handling:

```javascript
async function startTranscription() {
  try {
    const authorization = GetAuthorization();
    
    // ... API call ...
    
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        "Content-Type": "application/json",
        "Authorization": authorization
      },
      body: JSON.stringify(body)
    });
    
    // Check HTTP status
    if (!response.ok) {
      const errorData = await response.json();
      
      // Handle specific errors
      switch (response.status) {
        case 401:
          throw new Error("Invalid STT credentials. Please check your key and secret.");
        case 404:
          throw new Error("STT API endpoint not found. Verify your App ID.");
        case 409:
          throw new Error("Transcription task already exists for this channel.");
        case 429:
          throw new Error("Rate limit exceeded. Please try again later.");
        default:
          throw new Error(errorData.message || `HTTP ${response.status}`);
      }
    }
    
    return await response.json();
  } catch (error) {
    console.error("Failed to start transcription:", error);
    
    // User-friendly error display
    if (error.message.includes("NetworkError") || error.message.includes("Failed to fetch")) {
      showPopup("Network error. Please check your connection and try again.");
    } else {
      showPopup(error.message);
    }
    
    // Report to error tracking service
    if (window.Sentry) {
      Sentry.captureException(error);
    }
    
    throw error;
  }
}
```

### Performance Optimization

**Minimize re-renders:**

The STT agent sends word-level updates. If you update the DOM for every word, you're triggering hundreds of reflows per second. This kills performance.

```javascript
// ❌ BAD: Update on every word (causes hundreds of DOM updates)
msg.words.forEach(word => {
  $(`#transcriptioncaps-${msg.uid}`).append(word.text);
});

// ✅ GOOD: Batch updates (single DOM update)
const text = msg.words.map(word => word.text).join("");
$(`#transcriptioncaps-${msg.uid}`).text(text);
```

The difference? The bad approach updates the DOM 50 times for a 50-word sentence. The good approach updates it once. On slower devices, this is the difference between smooth 60fps and choppy 10fps.

**Debounce language selector changes:**

When users change the language selector, we clear the current translation and wait for the next message. But if they're rapidly switching languages (clicking through options to see what's available), we don't want to clear the translation on every click.

```javascript
let languageSelectorTimeout;

function updateTranslationView(uid) {
  clearTimeout(languageSelectorTimeout);
  
  // Wait 300ms before clearing translation
  // If user changes selector again within 300ms, cancel the clear
  languageSelectorTimeout = setTimeout(() => {
    const selectedLang = $(`#translation-lang-${uid}`).val();
    localStorage.setItem(`translation-pref-${uid}`, selectedLang);
    $(`#translationcaps-${uid}`).text('');
  }, 300);
}
```

The 300ms debounce means: if the user clicks through 5 languages in 1 second, we only clear the translation once (after they stop clicking), not 5 times. This prevents flickering and improves the user experience.

**Lazy-load video elements:**

Only create video containers when users actually publish video, not preemptively.

### Monitoring and Analytics

Track key metrics:

```javascript
// Track transcription latency
let transcriptionStartTime;

async function startTranscription() {
  transcriptionStartTime = Date.now();
  const result = await /* ... API call ... */;
  const latency = Date.now() - transcriptionStartTime;
  
  // Send to analytics
  analytics.track('Transcription Started', {
    latency_ms: latency,
    version: sttVersion,
    languages: body.languages,
    translationEnabled: body.translateConfig?.enable || false
  });
}

// Track message received latency
client.on("stream-message", function(uid, data) {
  const receiveTime = Date.now();
  const msg = Text.decode(data);
  
  // Calculate end-to-end latency
  const latency = receiveTime - msg.time;
  
  analytics.track('Transcription Message Received', {
    latency_ms: latency,
    uid: msg.uid,
    data_type: msg.data_type,
    word_count: msg.words?.length || 0
  });
  
  // ... rest of handling ...
});
```

Track these metrics to understand your app's performance:

- **Transcription start latency**: How long from "Start RTT" click to agent actually running. If this is >5 seconds, users will think the app is broken.

- **Message delivery latency**: Time from when someone speaks to when transcription appears on screen. This is the most important metric—users notice if transcriptions lag behind speech.

- **Translation accuracy**: Collect user feedback. Agora's translation is good, but not perfect. Track which language pairs have issues.

- **Error rates**: Failed starts, network errors, decode failures. High error rates indicate infrastructure problems or configuration issues.

I use these metrics to set SLAs. For example: "95% of transcriptions start within 3 seconds" or "Average message latency < 2 seconds." Without metrics, you're flying blind.

## Part 12: Common Issues and Troubleshooting

I've spent hours debugging these issues. Here's what I learned so you don't have to.

### Issue: No Transcription Messages Received

This is the most common problem. You click "Start RTT," see "Started transcription," but no text appears. Here's what's usually wrong:

**Possible causes:**
1. **STT agent UID conflicts with a user UID**: If your `pubBotUid` is 123 and a user joins with UID 123, the agent can't join. Agora UIDs must be unique.
2. **Agent hasn't subscribed yet**: The agent takes 2-5 seconds to join and subscribe. Be patient.
3. **No audio is being published**: Check that your microphone is working and you've published audio tracks.
4. **Encryption mismatch**: If your channel uses encryption but the agent doesn't have the keys, it can't decrypt audio.

**Debugging steps:**

```javascript
// 1. Verify agent joined
console.log(`Agent UID: ${$("#pusher-uid").val()}`);

// 2. Check if client is publishing audio
client.on("user-published", (user, mediaType) => {
  console.log(`User ${user.uid} published ${mediaType}`);
});

// 3. Log stream messages
client.on("stream-message", (uid, data) => {
  console.log(`Stream message from UID ${uid}, size: ${data.byteLength} bytes`);
  // ... decode and display ...
});

// 4. Verify encryption settings
console.log("Encryption mode:", $("#decryption-mode").val());
```

### Issue: Translation Not Appearing

You see transcriptions but no translations. This usually means one of three things:

**Possible causes:**
1. **Translation not enabled**: You configured translation pairs but didn't enable translation. Check the initial request body—does it have `translateConfig.enable: true`?
2. **Wrong target language selected**: The dropdown shows "en-US → es-ES" but you selected "en-US → ru-RU" and the user is speaking English. Make sure the selected language matches a configured target.
3. **Source language mismatch**: You configured `en-US → es-ES` but the user is speaking Spanish. The agent only translates from the source languages you configured.

**Solution:**

```javascript
// Verify translation config
const config = buildStartRequestBody();
console.log("Translation config:", config.translateConfig);

// Check selected language
client.on("stream-message", (uid, data) => {
  const msg = Text.decode(data);
  if (msg.data_type === "translate") {
    console.log("Available translations:", msg.trans.map(t => t.lang));
    console.log("Selected language:", $(`#translation-lang-${msg.uid}`).val());
  }
});
```

### Issue: High Latency

Transcriptions appear, but they're 5-10 seconds behind the speech. This kills the user experience.

**Possible causes:**
1. **Network congestion**: Your connection to Agora is slow or unstable. Check your network speed and latency to `api.agora.io`.
2. **Agent processing load**: The agent is processing too many streams simultaneously. Each additional user adds processing time.
3. **Too many translation targets**: Translating to 5 languages takes longer than translating to 1. Each target language adds processing overhead.

**Mitigation:**

```javascript
// Reduce translation targets
body.translateConfig = {
  enable: true,
  forceTranslateInterval: 10,  // Increase interval to 10 seconds
  languages: [
    { source: 'en-US', target: ['es-ES'] }  // Limit to 1-2 targets
  ]
};

// Monitor latency
const startTime = Date.now();
client.on("stream-message", (uid, data) => {
  const msg = Text.decode(data);
  console.log(`Latency: ${Date.now() - startTime}ms`);
});
```

### Issue: Agent Stops Unexpectedly

Everything is working, then suddenly transcriptions stop. No error message, just silence.

**Possible causes:**
1. **`maxIdleTime` reached**: No one spoke for 60 seconds (or whatever you configured), so the agent automatically stopped. This is by design—it prevents forgotten sessions from running forever.
2. **Channel became empty**: All users left the channel. The agent detects this and stops to save resources.
3. **API error or rate limit**: Agora's API returned an error, or you hit rate limits. Check the browser console for error messages.

**Solution:**

```javascript
// Increase idle time
body.maxIdleTime = 300;  // 5 minutes

// Monitor agent status (7.x)
setInterval(async () => {
  if (taskId) {
    try {
      const statusUrl = `${gatewayAddress}/api/speech-to-text/v1/projects/${options.appid}/agents/${taskId}`;
      
      const response = await fetch(statusUrl, {
        headers: { "Authorization": GetAuthorization() }
      });
      
      const status = await response.json();
      console.log("Agent status:", status);
    } catch (error) {
      console.error("Failed to check agent status:", error);
    }
  }
}, 30000);  // Check every 30 seconds
```

## Part 13: Testing Your Implementation

### Manual Testing Checklist

1. **Basic Flow**
   - [ ] Join channel successfully
   - [ ] Local video appears
   - [ ] Start transcription without errors
   - [ ] Speak and see transcription overlay
   - [ ] Stop transcription
   - [ ] Leave channel

2. **Multi-User**
   - [ ] Remote user joins and video appears
   - [ ] Remote user's transcription appears on their video
   - [ ] Each user has independent language selector
   - [ ] Leaving user's video is removed

3. **Translation**
   - [ ] Translation appears below transcription
   - [ ] Changing language selector updates translation shown
   - [ ] Enable/disable buttons work during session
   - [ ] Configure modal updates languages in real-time

4. **Edge Cases**
   - [ ] Start transcription before joining (should show error)
   - [ ] Join without credentials (should show error)
   - [ ] Network interruption handling
   - [ ] Rapid start/stop cycles
   - [ ] Empty language configurations

### Automated Testing

For production apps, add automated tests:

```javascript
// Example using Jest
describe('Transcription', () => {
  test('builds correct request body for 7.x', () => {
    // Mock DOM inputs
    document.getElementById = jest.fn((id) => {
      const mocks = {
        'stt-version': { value: '7.x' },
        'max-idle-time': { value: '60' },
        'pusher-uid': { value: '12345' },
        'puller-uid': { value: '12345' }
      };
      return mocks[id] || {};
    });
    
    const body = buildStartRequestBody();
    
    expect(body.name).toBe(options.channel);
    expect(body.maxIdleTime).toBe(60);
    expect(body.rtcConfig.pubBotUid).toBe('12345');
  });
  
  test('consolidates translation pairs', () => {
    const pairs = [
      { source: 'en-US', target: ['es-ES'] },
      { source: 'en-US', target: ['ru-RU'] }
    ];
    
    const consolidated = consolidatePairs(pairs);
    
    expect(consolidated).toEqual([
      { source: 'en-US', target: ['es-ES', 'ru-RU'] }
    ]);
  });
});
```

## Conclusion

You've built something impressive: a real-time transcription and translation system that works in the browser. The architecture is modular, the API integration handles edge cases, and the user experience is polished.

**What you've learned:**

1. **Agora's STT API is powerful but requires careful configuration** - The preview feature isn't just nice-to-have, it's essential for debugging. One typo in a language code can break everything.

2. **Message decoding is straightforward** - Agora STT sends messages in a standard format. The decoding library handles the details automatically.

3. **Dynamic translation control changes everything** - Being able to enable/disable translation without restarting is the difference between a demo and a production feature.

4. **Proper state management prevents bugs** - The explicit state machine prevents impossible states that would confuse users and break the app.

5. **Error handling and monitoring are non-negotiable** - WebRTC is unreliable. Network issues happen. Codec mismatches happen. Your app needs to handle them gracefully.

### What's Next?

**Extend the application:**
- **Speaker identification (diarization)**: Know who said what, not just what was said
- **Transcript history**: Save and search past conversations
- **Multiple channels**: Support users in multiple rooms simultaneously
- **Custom vocabulary**: Add domain-specific terms (medical, legal, technical)
- **Mobile apps**: Port this to React Native or Flutter
- **LLM integration**: Real-time summarization, sentiment analysis, action items

**Optimize for production:**
- **Backend proxy**: Move STT API calls to your server (security and control)
- **Connection pooling**: Reuse connections for better performance
- **Caching**: Cache language configurations to reduce API calls
- **Load balancing**: Distribute transcription load across multiple agents
- **Monitoring**: Track latency, error rates, and usage metrics

The code in this repository works for small to medium deployments. For enterprise scale, you'll need additional infrastructure: load balancers, monitoring systems, and proper backend architecture. But the core concepts you've learned here apply at any scale.

### Final Thoughts

Building this demo taught me that real-time communication is deceptively complex. What looks simple—"just show text on video"—requires careful architecture, error handling, and user experience design.

The most important lesson? **Always test with real users.** I thought the auto-hide overlay was perfect until users told me it was distracting. I thought the language selector was obvious until users got confused. Real feedback beats assumptions every time.

Now go build something amazing. And when you do, share it with the community. We're all learning together.

## Resources

- [Agora STT API Documentation](https://docs.agora.io/en/real-time-stt/overview/product-overview)
- [Agora RTC SDK Reference](https://docs.agora.io/en/video-calling/reference/web-sdk)
- [Supported Languages and Locales](https://docs.agora.io/en/real-time-stt/reference/supported-languages)
- [GitHub Repository](https://github.com/AgoraIO-Community/stt)

---

*This guide was written for developers building real-time communication applications. If you found it helpful, star the repository and share your implementations!*

