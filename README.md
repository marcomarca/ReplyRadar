# ReplyRadar

ReplyRadar is a lightweight userscript for ChatGPT and Gemini. It adds a floating conversation navigator and optional response-completion notifications.

## Features

- Floating panel for navigating ChatGPT and Gemini conversations
- Previous/next navigation between conversation blocks
- Conversation list with filters:
  - All messages
  - User prompts
  - AI responses
- Response-completion notifications/alarms
- Light, dark, and automatic theme modes
- Draggable panel with saved position
- Works on:
  - `chatgpt.com`
  - `gemini.google.com`

## Installation

Install a userscript manager first:

- [Tampermonkey](https://www.tampermonkey.net/)
- [Violentmonkey](https://violentmonkey.github.io/)

Then install ReplyRadar from the raw script URL:

```text
https://raw.githubusercontent.com/marcomarca/ReplyRadar/main/ReplyRadar.user.js
```

Your userscript manager should detect the `.user.js` file and open the installation screen.

## Manual installation

1. Open Tampermonkey or Violentmonkey.
2. Create a new userscript.
3. Delete the default template code.
4. Copy the full raw contents of `ReplyRadar.user.js`.
5. Paste it into the userscript editor.
6. Save the script.
7. Open ChatGPT or Gemini.

## Usage

After installation, open ChatGPT or Gemini. ReplyRadar displays a floating panel with:

- Previous/next buttons
- Current message counter
- Conversation list button
- Theme toggle
- Notification toggle
- Panel reset button

Notifications only fire when enabled and when the page is hidden, in the background, or not focused.

## Repository structure

```text
ReplyRadar/
├─ ReplyRadar.user.js
├─ README.md
├─ LICENSE
├─ CHANGELOG.md
└─ assets/
   └─ .gitkeep
```

## Userscript metadata

The script includes update metadata for GitHub raw installs:

```js
// @downloadURL  https://raw.githubusercontent.com/marcomarca/ReplyRadar/main/ReplyRadar.user.js
// @updateURL    https://raw.githubusercontent.com/marcomarca/ReplyRadar/main/ReplyRadar.user.js
```

These lines let supported userscript managers check for updates.

## Permissions

ReplyRadar uses these userscript permissions:

- `GM_notification`: display desktop-style notifications
- `unsafeWindow`: monitor network activity for response-completion detection
- `GM_addStyle`: compatibility with userscript styling support

The script is limited to:

- `https://chatgpt.com/*`
- `https://gemini.google.com/*`

## License

MIT
