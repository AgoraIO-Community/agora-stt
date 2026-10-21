# Speech-to-Text with Agora RTC

## Overview

Pair Agora RTC audio with speech-to-text so spoken conversations become live text.

Repository: [AgoraIO-Community/agora-stt](https://github.com/AgoraIO-Community/agora-stt)

## Prerequisites and Setup

1. Serve the repository directory with a static web server (the README suggests `npx serve`) and open the app in a modern browser.
2. Under Connection Settings, enter your test App ID, channel and UID. Under STT Settings, configure the supported API version, Customer Key/Secret and speaking/translation languages for that test project.
3. Join the channel and click Start RTT. Use a second audio client in the same channel to check remote speech.
4. While transcription is active, exercise translation enable/disable and language changes. Finish with Stop RTT and Leave.

## What To Check

- Confirm that transcribed speech and selected translations appear on the correct participant tiles.
- Inspect request previews and error responses when configuration is invalid.
- Verify stopping RTT terminates the transcription task before leaving the channel.

## Integration Notes

The browser demo handles privileged STT credentials for testing. Use a trusted backend for production service control, and verify that your project has access to the API version selected in the UI.

Keep App Certificates, customer secrets and privileged token generation on a trusted backend for production. Use only your own test credentials while configuring historical demos; do not commit them. Preserve the sample's existing dependency versions and lifecycle until a separate migration is tested.

## Source References

- [README.md](../../README.md)

## Validation Status

This recipe was checked against the repository's source and setup documents. The platform build and live service/device flow have not been run as part of this documentation change. Complete the checks above in an environment with the required SDKs, hardware and service access before treating it as a validated deployment.

## Implementation Prompt

```text
You are working in AgoraIO-Community/agora-stt. Use docs/ai/RECIPE.md and its linked source files to adapt the Speech-to-Text with Agora RTC reference to this project.

Start by inspecting the actual sample directory and configuration described above. Resolve its listed missing prerequisites before claiming it is runnable. Preserve the existing architecture and compatible dependency versions. Implement the recipe's feature-specific flow, permissions and resource cleanup. Use a trusted backend for privileged credentials and tokens in production.

Run the repository-specific build or launch flow, then perform each What To Check item. Report the commands run, the observed results and anything blocked by service access, hardware or incomplete sample code. Do not claim live validation from a documentation or catalog build alone.
```
