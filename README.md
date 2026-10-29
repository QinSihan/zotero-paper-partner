<p align="center">
  <img src="./assets/image.png" alt="Zotero Paper Partner icon" width="120">
</p>

# Zotero Paper Partner

A Zotero plugin that answers `Q:` questions you write inside notes — silently, in the background, without breaking your reading flow.

![Zotero](https://img.shields.io/badge/Zotero-10-E05A47?logo=zotero&logoColor=white)
![JavaScript](https://img.shields.io/badge/JavaScript-ES6-F7DF1E?logo=javascript&logoColor=000)
![OpenAI Compatible](https://img.shields.io/badge/API-OpenAI--compatible-412991?logo=openai&logoColor=white)

[Download](https://github.com/QinSihan/zotero-paper-partner/releases/latest) · [Report an issue](https://github.com/QinSihan/zotero-paper-partner/issues) · [中文说明](./README.zh-CN.md)

[![Demo](./assets/demo.gif)](./assets/demo.mp4)

---

## The idea

This plugin is for a very specific moment: you're reading a paper, something doesn't click, and you don't want to stop everything just to ask AI about it.

So instead of opening a chat window, pasting context, and breaking your flow, you just type a `Q:` in the Zotero note you're already writing. Then you keep going. A little later, the answer shows up right under the question.

```
The model uses a representation-agnostic objective.
Q: What does representation-agnostic mean here?

A[done]: It means the method does not depend on a specific internal representation,
but works across different ways of encoding the same underlying information.
```

That's really the whole idea: keep the question, the context, and the answer in one place, and don't make reading feel heavier than it already is.

## Why it feels different

**Stay in the note.** Most AI reading tools ask you to step out of your notes and into some other interface. This one doesn't. The question lives in your note, the answer comes back to that same note, and what you end up with is still just a normal reading note you can keep.

**Don't break the flow.** You write `Q:`, press Enter, and move on. The plugin waits a moment, works in the background, and fills in the answer when it's ready. If you change the note while it's working, it marks the result as stale instead of pretending the old answer is still valid.

---

## Install

Download `paper-partner.xpi` from the [latest release](https://github.com/QinSihan/zotero-paper-partner/releases/latest), then in Zotero: `Tools → Plugins → Install Add-on From File`.

## Configure

`Zotero Preferences → Paper Partner` — set your API key, endpoint, and model. Defaults to DeepSeek's OpenAI-compatible API.

## Requirements

Zotero 7–10 (tested on Zotero 9 and 10.0.6). Any OpenAI-compatible API endpoint works.

---

## Development

The plugin is a small JavaScript add-on: `bootstrap.js` contains the note processing and API logic, `prefs.xhtml` contains the settings UI, and `manifest.json` defines the add-on metadata. There is no dependency-install or build step.

To package a modified version, run this command from the repository root (requires `zip`):

```sh
zip -j paper-partner.xpi manifest.json bootstrap.js prefs.xhtml icon.png icon@2x.png
```

Install the resulting `paper-partner.xpi` in Zotero using the steps above. Before submitting a change, check it in a scratch note:

- Add a short context paragraph and a `Q:` question, press Enter, and confirm an answer appears under the question.
- Edit the context while a request is running and confirm an outdated answer is not silently written back as current.
- Check that an API failure is shown as `A[error]` without losing the question or surrounding note text.

These are manual checks; the repository does not currently include an automated test suite. When [reporting an issue](https://github.com/QinSihan/zotero-paper-partner/issues), include your Zotero version, plugin version, and steps to reproduce.

This project was built with extensive AI assistance—honestly, roughly 99% vibe coding. The original prompt/spec is public in [`target.md`](./target.md) for anyone who wants to understand, rebuild, or extend the idea.
