// ============================================================================
// MAIN APPLICATION FLOW
// ============================================================================
// This module handles initialization and primary user interactions:
// - Join/leave channel
// - Start/stop transcription
// - Page load initialization

/**
 * Initialize application on page load
 * 
 * Sets up:
 * 1. Button states (which actions are available)
 * 2. Loads saved settings from localStorage
 * 3. Applies version-specific UI changes
 * 4. Loads translation configuration
 */
$(document).ready(function() {
  updateButtonStates('initial');
  loadSavedSettings();
  
  // Apply version-specific UI changes after settings are loaded
  handleVersionChange();
  
  // COMMENTED OUT: Event listeners for auto-sync behavior
  // This was removed because it caused confusion - users prefer explicit control
  /*
  // Add event listeners for pub bot fields to sync with sub bot fields in 7.x
  $("#pusher-uid, #pusher-token").on('input', function() {
    if (sttVersion === "7.x") {
      const fieldId = $(this).attr('id');
      const value = $(this).val();
      
      if (fieldId === 'pusher-uid') {
        $("#puller-uid").val(value);
      } else if (fieldId === 'pusher-token') {
        $("#puller-token").val(value);
      }
    }
  });
  */
});

// Load translation settings from localStorage when page loads
document.addEventListener('DOMContentLoaded', loadTranslationSettings);

// Revert modal forms on close without Save (click-away or Cancel)
document.getElementById('connectionModal').addEventListener('close', function () {
  if (!connectionModalSaved) revertConnectionFormFromStorage();
  connectionModalSaved = false;
});
document.getElementById('sttModal').addEventListener('close', function () {
  if (!sttModalSaved) revertSTTFormFromStorage();
  sttModalSaved = false;
});

// ============================================================================
// CHANNEL JOIN/LEAVE HANDLERS
// ============================================================================

/**
 * Join an Agora RTC channel
 * 
 * This is the entry point for real-time communication. Steps:
 * 1. Validate configuration (App ID and channel name required)
 * 2. Parse UID from input (can be string or integer)
 * 3. Join the Agora channel
 * 4. Create and publish audio/video tracks
 * 5. Display local video and transcription UI
 * 6. Update button states to reflect new state
 * 
 * After joining, you can start transcription to enable STT features.
 */
$("#join").click(async function() {
  // Read channel and UID from STT form (they live in STT Settings modal)
  options.channel = $("#channel").val() || null;
  const uidVal = $("#uid").val();
  const uidString = $("#uid-string").is(":checked");
  let joinUid = null;
  if (uidVal !== '') {
    joinUid = uidString ? uidVal : parseInt(uidVal, 10);
    if (!uidString && isNaN(joinUid)) joinUid = null;
  }

  // Validation: must have App ID and channel configured
  if (!options.appid || !options.channel) {
    showPopup("Please configure connection settings (App ID) and STT settings (Channel name)");
    return;
  }

  try {
    if (uidString) {
      AgoraRTC.setParameter("EXPERIMENTS", { enableStringuidCompatible: true });
    }
    var joinToken = $("#join-token").val();
    joinToken = (joinToken && joinToken.trim()) ? joinToken.trim() : null;
    options.uid = await client.join(options.appid, options.channel, joinToken, joinUid);
    console.log("Joined with UID:", options.uid);
    
    // Request camera and microphone access, create tracks
    const [audioTrack, videoTrack] = await AgoraRTC.createMicrophoneAndCameraTracks();
    localTrack = videoTrack;
    localAudioTrack = audioTrack;
    
    // Publish tracks to channel (other users can now see/hear you)
    await client.publish([audioTrack, videoTrack]);
    
    // Create local video container with transcription overlay
    const localContainer = $(`
      <div id="video-wrapper-${options.uid}" class="video-wrapper">
        <div class="language-selector">
          <select id="translation-lang-${options.uid}" 
                  class="bg-gray-800 rounded px-2 py-1 text-sm" 
                  onchange="updateTranslationView('${options.uid}')">
          </select>
        </div>
        <div class="video-container">
          <div id="local-player" class="w-full h-full"></div>
          <div class="transcription-overlay">
            <div id="transcriptioncaps-${options.uid}" class="text-xl mb-2"></div>
            <div id="translationcaps-${options.uid}" class="text-gray-300"></div>
          </div>
        </div>
      </div>
    `);

    // Replace existing local player placeholder
    $("#local-player").parent().parent().replaceWith(localContainer);
    
    // Start playing local video
    videoTrack.play("local-player");
    
    // Initialize language selector for local user
    updateLanguageSelector(options.uid);
    
    // Update button states
    updateButtonStates('joined');
    
    // Edge case: if transcription was started before joining (unusual but possible)
    if (taskId) {
      $("#start-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").removeClass('hidden');
    }
    
    showPopup("Joined channel successfully");
  } catch (error) {
    console.error(error);
    showPopup("Failed to join channel: " + error.message);
  }
});

/**
 * Leave the Agora RTC channel
 * 
 * Performs complete cleanup:
 * 1. Clear all overlay auto-hide timers
 * 2. Hide all transcription overlays
 * 3. Stop and close local media tracks (releases camera/mic)
 * 4. Leave the channel
 * 5. Clear all UI elements (local and remote video)
 * 6. Reset button states
 * 
 * Note: This does NOT stop transcription. The STT agent continues running
 * in the channel even after you leave. Call Stop RTT first if you want to
 * stop transcription.
 */
$("#leave").click(async function() {
  try {
    // Clear all pending overlay timeouts (prevents memory leaks)
    overlayTimeouts.forEach((timeout, uid) => {
      clearTimeout(timeout);
    });
    overlayTimeouts.clear();
    
    // Hide all transcription overlays
    $(`.transcription-overlay`).addClass('hidden');
    
    // Stop and close local video track
    if (localTrack) {
      localTrack.stop();   // Stop the camera
      localTrack.close();  // Free resources
    }
    
    // Stop and close local audio track
    if (localAudioTrack) {
      localAudioTrack.stop();   // Stop the microphone
      localAudioTrack.close();  // Free resources
    }
    
    // Leave the Agora channel
    await client.leave();
    
    // Clear all video UI elements
    $("#local-player").empty();
    $("#remote-playerlist").empty();
    
    // Reset to initial state
    updateButtonStates('initial');
    
    // Edge case: transcription still running after leaving
    // (unusual but possible - user left channel but STT agent still active)
    if (taskId) {
      $("#start-trans").prop('disabled', true).addClass('opacity-50 cursor-not-allowed');
      $("#stop-trans").prop('disabled', false).removeClass('opacity-50 cursor-not-allowed');
      $("#translation-controls").addClass('hidden');
    }
    
    showPopup("Left channel successfully");
  } catch (error) {
    console.error(error);
    showPopup("Failed to leave channel");
  }
});

// ============================================================================
// TRANSCRIPTION START/STOP HANDLERS
// ============================================================================

/**
 * Start real-time transcription
 * 
 * Validates configuration and calls the STT API to start transcription.
 * The API creates an "agent" that joins the channel, subscribes to audio,
 * and publishes transcription/translation results as stream messages.
 * 
 * Prerequisites:
 * - STT credentials (customer key and secret)
 * - App ID and channel name
 * - Optionally: join the channel first (can start before joining)
 */
$("#start-trans").click(async function() {
  try {
    // Validate STT credentials
    if (!$("#key").val() || !$("#secret").val()) {
      showPopup("Please configure STT settings first");
      document.getElementById('sttModal').showModal();
      return;
    }

    // Validate connection settings
    if (!options.appid || !options.channel) {
      showPopup("Please configure connection settings first");
      document.getElementById('connectionModal').showModal();
      return;
    }

    // Disable button to prevent double-clicking
    $("#start-trans").prop('disabled', true);
    
    // Call the STT API
    await startTranscription();
    
    showPopup("Started transcription");
  } catch (error) {
    console.error(error);
    showPopup(error.message || "Failed to start transcription");
    
    // Re-enable button on error
    $("#start-trans").prop('disabled', false);
  }
});

/**
 * Stop real-time transcription
 * 
 * Tells the STT agent to leave the channel and stop processing.
 * - Clears all transcription/translation overlays
 * - Resets translation state
 * - Hides translation controls
 * 
 * After stopping, you can start transcription again with new settings.
 */
$("#stop-trans").click(async function() {
  try {
    // Disable button to prevent double-clicking
    $("#stop-trans").prop('disabled', true);
    
    // Call the stop API
    await stopTranscription();
    
    // Re-enable start button
    $("#start-trans").prop('disabled', false);
    
    showPopup("Stopped transcription");
  } catch (error) {
    console.error(error);
    showPopup("Failed to stop transcription");
    
    // Re-enable button on error
    $("#stop-trans").prop('disabled', false);
  }
});

