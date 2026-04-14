"use strict";

// ============================================================
// CONFIGURATION
// Behavioral constants — not exposed to users.
// API settings (key / endpoint / model) live in Zotero Preferences.
// ============================================================
const CONFIG = {
    debounceMs: 3000,       // Wait this long after last note edit before processing
    maxContextLength: 2000, // Max chars of context sent to the model
};

const PREF_PREFIX = "extensions.paper-partner.";
const PREF_DEFAULTS = {
    apiKey:      "",
    apiEndpoint: "https://api.deepseek.com/v1/chat/completions",
    model:       "deepseek-chat",
};

/** Read a user-configurable preference, falling back to PREF_DEFAULTS. */
function getPref(key) {
    try {
        const val = Zotero.Prefs.get(PREF_PREFIX + key, true);
        return (val !== undefined && val !== null && val !== "") ? val : PREF_DEFAULTS[key];
    } catch (_) {
        return PREF_DEFAULTS[key];
    }
}

let rootURI = "";

// ============================================================
// NOTE PARSER
// Turns Zotero note HTML into a flat list of typed paragraphs,
// then finds which Q: questions still need answers.
// ============================================================
const NoteParser = {
    /**
     * Parse note HTML into an array of paragraph descriptors.
     * Each item: { type: "question"|"answer"|"content", index, el, text, status?, content? }
     *
     * Zotero stores notes as HTML (e.g. <div data-schema-version="8"><p>...</p></div>).
     * We parse with DOMParser and walk all <p> elements.
     */
    parse(html) {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html || "", "text/html");
        const paragraphs = Array.from(doc.querySelectorAll("p"));

        return paragraphs.map((el, index) => {
            const text = el.textContent.trim();
            const qMatch = text.match(/^Q:\s*([\s\S]*)/);
            const aMatch = text.match(/^A\[(\w+)\]:([\s\S]*)/);

            if (qMatch) {
                return { type: "question", index, el, text: qMatch[1].trim() };
            } else if (aMatch) {
                return { type: "answer", index, el, status: aMatch[1], content: aMatch[2].trim() };
            } else {
                return { type: "content", index, el, text };
            }
        });
    },

    /**
     * From the parsed item list, return questions that have no following A[...].
     * Each result includes the question text, its local context (paragraphs between
     * this Q and the previous Q/A boundary), and the DOM element for writing back.
     */
    findPending(items) {
        const pending = [];

        for (let i = 0; i < items.length; i++) {
            if (items[i].type !== "question") continue;

            // If this Q is the last paragraph, the user is likely still typing it.
            // Only process once the user has pressed Enter to start a new paragraph.
            if (i === items.length - 1) continue;

            // Look forward: is there already an A[...] before the next Q?
            let hasAnswer = false;
            for (let j = i + 1; j < items.length; j++) {
                if (items[j].type === "question") break;
                if (items[j].type === "answer") { hasAnswer = true; break; }
            }
            if (hasAnswer) continue;

            // Look backward: collect context up to the previous Q or A boundary
            const contextParts = [];
            for (let j = i - 1; j >= 0; j--) {
                if (items[j].type === "question" || items[j].type === "answer") break;
                contextParts.unshift(items[j].text);
            }

            pending.push({
                questionText: items[i].text,
                contextText: contextParts.join("\n").slice(0, CONFIG.maxContextLength),
                el: items[i].el,
            });
        }

        return pending;
    },

    /**
     * A string that captures both the question and its context.
     * Used to detect whether the note changed while we were calling the API.
     */
    fingerprint(questionText, contextText) {
        return questionText + "\x00" + contextText;
    },
};

// ============================================================
// NOTE WRITER
// Inserts or replaces the A[...] paragraph that immediately follows a Q.
// Always re-fetches the note from Zotero before writing to pick up concurrent edits.
// ============================================================
const NoteWriter = {
    /**
     * Find the Q paragraph by its full text content, then insert or replace
     * the immediately following A[...] paragraph.
     *
     * @param {Zotero.Item} item         - The note item
     * @param {Element}     questionEl   - The Q paragraph element (used for text matching)
     * @param {string}      status       - pending | running | done | stale | error
     * @param {string}      [content=""] - Answer text (only for "done")
     * @returns {boolean} false if the question paragraph was not found
     */
    async write(item, questionEl, status, content = "") {
        const html = item.getNote();
        const parser = new DOMParser();
        const doc = parser.parseFromString(html || "", "text/html");
        const paragraphs = Array.from(doc.querySelectorAll("p"));

        // Match by full text: "Q: <question text>"
        const fullQText = questionEl.textContent.trim();
        const qEl = paragraphs.find(p => p.textContent.trim() === fullQText);

        if (!qEl) {
            Zotero.debug("[PaperPartner] Could not find Q paragraph to update: " + fullQText.slice(0, 60));
            return false;
        }

        const answerLine = content ? `A[${status}]: ${content}` : `A[${status}]:`;

        // If the next sibling <p> is already an A[...], replace it in-place.
        // Otherwise insert a new paragraph after the Q.
        const next = qEl.nextElementSibling;
        if (next && next.tagName === "P" && /^A\[\w+\]:/.test(next.textContent.trim())) {
            next.textContent = answerLine;
        } else {
            const aEl = doc.createElement("p");
            aEl.textContent = answerLine;
            qEl.insertAdjacentElement("afterend", aEl);
        }

        item.setNote(doc.body.innerHTML);
        await item.saveTx();
        return true;
    },
};

// ============================================================
// API CLIENT
// OpenAI-compatible chat completion. DeepSeek by default.
// ============================================================
const ApiClient = {
    async query(questionText, contextText) {
        const systemPrompt =
            "You are a quiet reading assistant for academic papers. " +
            "Answer the user's question in 1–3 short sentences. " +
            "Focus only on clarifying the specific term or claim the user asked about, " +
            "using the provided local context. " +
            "Do not explain background theory at length, do not list related work, " +
            "do not summarize the paper. Be direct and locally focused.";

        const userMessage = contextText
            ? `Context from my reading notes:\n${contextText}\n\nQuestion: ${questionText}`
            : `Question: ${questionText}`;

        const response = await fetch(getPref("apiEndpoint"), {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "Authorization": `Bearer ${getPref("apiKey")}`,
            },
            body: JSON.stringify({
                model: getPref("model"),
                messages: [
                    { role: "system", content: systemPrompt },
                    { role: "user", content: userMessage },
                ],
                max_tokens: 200,
                temperature: 0.3,
            }),
        });

        if (!response.ok) {
            const body = await response.text().catch(() => "");
            throw new Error(`HTTP ${response.status}: ${body.slice(0, 200)}`);
        }

        const data = await response.json();
        return data.choices[0].message.content.trim();
    },
};

// ============================================================
// TASK QUEUE
// Per-note debounce + global serial execution.
// One note is processed at a time; multiple notes queue up in order.
// ============================================================
const TaskQueue = {
    _debounceTimers: new Map(), // noteId → timer handle
    _queue: [],                 // noteIds waiting to be processed
    _processing: false,

    /** Called when a note is modified. Resets the debounce window. */
    schedule(itemId) {
        const existing = this._debounceTimers.get(itemId);
        if (existing) clearTimeout(existing);

        const timer = setTimeout(() => {
            this._debounceTimers.delete(itemId);
            this._enqueue(itemId);
        }, CONFIG.debounceMs);

        this._debounceTimers.set(itemId, timer);
    },

    _enqueue(itemId) {
        if (this._queue.includes(itemId)) return; // Already waiting
        this._queue.push(itemId);
        if (!this._processing) this._drain();
    },

    async _drain() {
        if (this._queue.length === 0) { this._processing = false; return; }
        this._processing = true;

        const itemId = this._queue.shift();
        try {
            await processNote(itemId);
        } catch (e) {
            Zotero.debug("[PaperPartner] Unhandled error for note " + itemId + ": " + e.message);
        }

        // Process next item (call synchronously to avoid deep recursion via setTimeout)
        this._drain();
    },

    /** Cancel all pending timers and flush the queue. Called on plugin shutdown. */
    clear() {
        for (const t of this._debounceTimers.values()) clearTimeout(t);
        this._debounceTimers.clear();
        this._queue.length = 0;
        this._processing = false;
    },
};

// ============================================================
// CORE PROCESSING
// For each unanswered Q in a note, drives the full pending→running→done flow.
// ============================================================
async function processNote(itemId) {
    if (!getPref("apiKey")) {
        Zotero.debug("[PaperPartner] API key not set — configure in Zotero Preferences → Paper Partner.");
        return;
    }

    const item = Zotero.Items.get(itemId);
    if (!item || !item.isNote()) return;

    Zotero.debug("[PaperPartner] Scanning note " + itemId);

    const items = NoteParser.parse(item.getNote());
    const pending = NoteParser.findPending(items);

    if (pending.length === 0) {
        Zotero.debug("[PaperPartner] No unanswered questions, done.");
        return;
    }

    Zotero.debug("[PaperPartner] " + pending.length + " unanswered question(s) found.");

    for (const q of pending) {
        await processQuestion(item, q);
    }
}

async function processQuestion(item, q) {
    const { questionText, contextText, el } = q;
    const fp = NoteParser.fingerprint(questionText, contextText);

    Zotero.debug("[PaperPartner] → Q: " + questionText.slice(0, 80));

    // ① Mark as running (API call about to start)
    await NoteWriter.write(item, el, "running");

    // ② Call the model
    let answer;
    try {
        answer = await ApiClient.query(questionText, contextText);
    } catch (e) {
        Zotero.debug("[PaperPartner] API error: " + e.message);
        await NoteWriter.write(item, el, "error", e.message.slice(0, 120));
        return;
    }

    // ③ Consistency check: re-parse the note and verify Q + context haven't changed.
    //    If the user edited the question or its surrounding text while we were waiting,
    //    the answer is no longer valid — mark stale instead of writing garbage back.
    const freshItems = NoteParser.parse(item.getNote());
    const freshQ = freshItems.find(it => it.type === "question" && it.text === questionText);

    if (!freshQ) {
        Zotero.debug("[PaperPartner] Question was removed while processing, skipping.");
        return;
    }

    const freshContextParts = [];
    for (let j = freshQ.index - 1; j >= 0; j--) {
        if (freshItems[j].type === "question" || freshItems[j].type === "answer") break;
        freshContextParts.unshift(freshItems[j].text);
    }
    const freshContext = freshContextParts.join("\n").slice(0, CONFIG.maxContextLength);

    if (NoteParser.fingerprint(questionText, freshContext) !== fp) {
        Zotero.debug("[PaperPartner] Context changed during processing, marking stale.");
        await NoteWriter.write(item, freshQ.el, "stale", "Context changed while processing. Edit this question again to reprocess.");
        return;
    }

    // ④ Write the answer back
    await NoteWriter.write(item, freshQ.el, "done", answer);
    Zotero.debug("[PaperPartner] ✓ Answer written for: " + questionText.slice(0, 80));
}

// ============================================================
// NOTIFIER OBSERVER
// Listens for item modifications and routes notes to the task queue.
// ============================================================
let _observerID = null;

function registerObserver() {
    _observerID = Zotero.Notifier.registerObserver(
        {
            notify(event, type, ids /*, extraData */) {
                if (type !== "item" || event !== "modify") return;
                for (const id of ids) {
                    const item = Zotero.Items.get(id);
                    if (item && item.isNote()) {
                        TaskQueue.schedule(id);
                    }
                }
            },
        },
        ["item"],
        "paper-partner"
    );
    Zotero.debug("[PaperPartner] Observer registered (id=" + _observerID + ")");
}

function unregisterObserver() {
    if (_observerID !== null) {
        Zotero.Notifier.unregisterObserver(_observerID);
        _observerID = null;
    }
}

// ============================================================
// PLUGIN LIFECYCLE
// ============================================================
function install(data, reason) {
    Zotero.debug("[PaperPartner] install");
}

function startup(data, reason) {
    Zotero.debug("[PaperPartner] startup");
    rootURI = data.rootURI;

    Zotero.initializationPromise.then(() => {
        // All prefs logic is inline in the onload of prefs.xhtml — no scripts array needed.
        try {
            Zotero.PreferencePanes.register({
                pluginID: "paper-partner@local.dev",
                src:      rootURI + "prefs.xhtml",
                label:    "Paper Partner",
            });
            Zotero.debug("[PaperPartner] Preferences pane registered.");
        } catch (e) {
            Zotero.debug("[PaperPartner] PreferencePanes.register failed: " + e.message);
        }

        registerObserver();
        Zotero.debug("[PaperPartner] Ready.");
    });
}

function shutdown(data, reason) {
    Zotero.debug("[PaperPartner] shutdown");
    try { Zotero.PreferencePanes.unregister("paper-partner@local.dev"); } catch (_) {}
    unregisterObserver();
    TaskQueue.clear();
}

function uninstall(data, reason) {
    Zotero.debug("[PaperPartner] uninstall");
}
