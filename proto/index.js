/**
 * ============================================================================
 * AGORA STT PROTOBUF MESSAGE SCHEMA
 * ============================================================================
 * 
 * This file defines the protobuf message format used by Agora's STT agent.
 * The agent sends transcription and translation results as binary protobuf
 * messages via Agora's Data Stream feature.
 * 
 * Why Protobuf?
 * - Compact: Much smaller than JSON (important for real-time streaming)
 * - Fast: Binary parsing is faster than JSON parsing
 * - Typed: Schema definition prevents decoding errors
 * 
 * Message Types:
 * 1. Text - Main message containing transcription/translation
 * 2. Word - Individual transcribed word with timing and confidence
 * 3. Translation - Translation result for a specific target language
 * 
 * The Text message has a "data_type" field that indicates:
 * - "transcribe" - Original transcription in source language
 * - "translate" - Translation(s) in target language(s)
 */

var $protobuf  = protobuf

var $protobufRoot = ($protobuf.roots.default || ($protobuf.roots.default = new $protobuf.Root()))
.addJSON({
  agora: {
    nested: {
      audio2text: {
        options: {
          java_package: "io.agora.rtc.audio2text",
          java_outer_classname: "Audio2TextProtobuffer"
        },
        nested: {
          // Main message type for transcription/translation results
          Text: {
            fields: {
              vendor: {        // STT service vendor ID
                type: "int32",
                id: 1
              },
              version: {       // Protocol version
                type: "int32",
                id: 2
              },
              seqnum: {        // Sequence number for ordering messages
                type: "int32",
                id: 3
              },
              uid: {           // User ID who is speaking
                type: "uint32",
                id: 4
              },
              flag: {          // Message flags
                type: "int32",
                id: 5
              },
              time: {          // Timestamp (milliseconds)
                type: "int64",
                id: 6
              },
              lang: {          // Language code (deprecated, use data_type instead)
                type: "int32",
                id: 7
              },
              starttime: {     // Start time of this segment
                type: "int32",
                id: 8
              },
              offtime: {       // Offset time within segment
                type: "int32",
                id: 9
              },
              words: {         // Array of transcribed words (for "transcribe" messages)
                rule: "repeated",
                type: "Word",
                id: 10
              },
              end_of_segment:{ // Whether this is the final result for this segment
                type: "bool",
                id: 11
              },
              duration_ms:{    // Duration of audio segment in milliseconds
                type: "int32",
                id: 12
              },
              data_type:{      // Message type: "transcribe" or "translate"
                type: "string",
                id: 13
              },
              trans: {         // Array of translations (for "translate" messages)
                rule: "repeated",
                type: "Translation",
                id: 14
              },
            }
          },
          // Individual word in transcription with timing and confidence
          Word: {
            fields: {
              text: {          // The transcribed word or phrase
                type: "string",
                id: 1
              },
              startMs: {       // Start time of word (milliseconds from segment start)
                type: "int32",
                id: 2
              },
              durationMs: {    // Duration of word in milliseconds
                type: "int32",
                id: 3
              },
              isFinal: {       // Whether this is final result or interim
                type: "bool",
                id: 4
              },
              confidence: {    // Confidence score (0.0 to 1.0)
                type: "double",
                id: 5
              }
            }
          },
          // Translation result for a specific target language
          Translation:{
            fields: {
              isFinal: {       // Whether this is final translation or interim
                type: "bool",
                id: 1
              },
              lang: {          // Target language code (e.g., "es-ES", "ru-RU")
                type: "string",
                id: 2
              },
              texts: {         // Array of translated text fragments
                rule: "repeated",
                type: "string",
                id: 3
              }
            }
          }
        }
      }
    }
  }
});

window.$protobufRoot = $protobufRoot
