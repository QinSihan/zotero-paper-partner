"use strict";

// ============================================================
// CONFIGURATION
// Behavioral constants.
// User-facing settings live in Zotero Preferences.
// ============================================================
const CONFIG = {
    maxContextLength: 2000, // Max chars of context sent to the model
    requestTimeoutMs: 60000,
    triggerDelays: {
        immediate: 0,
        short: 1000,
        medium: 2000,
        long: 3000,
    },
};

const PREF_PREFIX = "extensions.paper-partner.";
const PREF_DEFAULTS = {
    provider:    "custom",
    apiFormat:   "auto",
    authMode:    "bearer",
    chatTokenParam: "auto",
    maxOutputTokens: "",
    orcaMaxOutputTokens: "",
    apiKey:      "",
    apiEndpoint: "https://api.deepseek.com/v1/chat/completions",
    model:       "deepseek-chat",
    answerMode:  "brief",
    triggerDelay: "medium",
    orcaApiKey:  "",
    orcaModel:   "orcarouter/free",
};

const ORCA_ENDPOINT = "https://api.orcarouter.ai/v1/chat/completions";

function normalizeApiEndpoint(endpoint, format) {
    // Accept the base URLs shown in these vendors' SDK examples, without probing
    // another host or changing a user's explicit protocol/route.
    if (!["auto", "chat"].includes(format)) return endpoint;
    try {
        const url = new URL(endpoint);
        const path = url.pathname.replace(/\/$/, "");
        if (["api.moonshot.cn", "api.moonshot.ai"].includes(url.hostname) && ["", "/v1"].includes(path)) {
            url.pathname = "/v1/chat/completions";
        } else if (["open.bigmodel.cn", "api.z.ai"].includes(url.hostname) && ["", "/api/paas/v4"].includes(path)) {
            url.pathname = "/api/paas/v4/chat/completions";
        } else {
            return endpoint;
        }
        return url.href;
    } catch (_) { return endpoint; }
}

function getApiCompatibility(config, format) {
    const url = new URL(config.endpoint);
    const model = config.model.toLowerCase();
    const profile = { extra: {}, reasoning: false, modernTokens: false, bearer: false };
    const path = url.pathname.replace(/\/$/, "");
    const kimiRoute = (format === "chat" && path === "/v1/chat/completions") ||
        (format === "responses" && path === "/v1/responses") ||
        (format === "anthropic" && path === "/anthropic/v1/messages");
    if (kimiRoute &&
        ["api.moonshot.cn", "api.moonshot.ai"].includes(url.hostname)) {
        profile.bearer = true;
        profile.modernTokens = true;
        if (model === "kimi-k2.6") {
            if (format === "chat") profile.extra.thinking = { type: "disabled" };
            else profile.reasoning = true;
        } else if (model === "kimi-k3") {
            profile.extra.reasoning_effort = "low";
            profile.reasoning = true;
        } else if (["kimi-k2.7-code", "kimi-k2.7-code-highspeed", "kimi-k2-thinking",
            "kimi-k2-thinking-turbo", "kimi-thinking-preview"].includes(model)) {
            // These models cannot be switched to non-thinking mode.
            profile.reasoning = true;
        }
    } else if (format === "chat" && path === "/api/paas/v4/chat/completions" &&
        ["open.bigmodel.cn", "api.z.ai"].includes(url.hostname)) {
        profile.bearer = true;
        if (/^glm-5\.3(?:-flashx?)?$/.test(model)) {
            profile.extra.reasoning_effort = "low";
            profile.reasoning = true;
        } else if (/^glm-(?:4\.[567](?:-(?:air|airx|x|flash|flashx))?|5(?:\.[12])?(?:-turbo)?)$/.test(model)) {
            profile.extra.thinking = { type: "disabled" };
        }
    }
    return profile;
}

function getApiConfig() {
    const provider = getPref("provider");
    if (provider !== "custom" && provider !== "orcarouter") {
        throw new Error("Unknown API provider. Choose a provider in Paper Partner settings.");
    }
    const isOrca = provider === "orcarouter";
    return {
        provider,
        apiFormat: isOrca ? "chat" : getPref("apiFormat"),
        authMode: isOrca ? "bearer" : getPref("authMode"),
        chatTokenParam: isOrca ? "auto" : getPref("chatTokenParam"),
        maxOutputTokens: getPref(isOrca ? "orcaMaxOutputTokens" : "maxOutputTokens"),
        endpoint: isOrca ? ORCA_ENDPOINT : normalizeApiEndpoint(getPref("apiEndpoint").trim(), getPref("apiFormat")),
        // An empty OrcaRouter key must never fall back to another provider's key.
        apiKey: getPref(isOrca ? "orcaApiKey" : "apiKey").trim(),
        model: getPref(isOrca ? "orcaModel" : "model").trim(),
    };
}

function validateApiConfig(config) {
    let url;
    try { url = new URL(config.endpoint); } catch (_) {
        throw new Error("Invalid API Endpoint. Enter the full URL for the selected API format.");
    }
    const local = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if (url.username || url.password ||
        (url.protocol !== "https:" && !(url.protocol === "http:" && local))) {
        throw new Error("API Endpoint must use HTTPS (HTTP is allowed only on localhost).");
    }
    if (!["auto", "chat", "responses", "anthropic", "gemini"].includes(config.apiFormat)) {
        throw new Error("Unknown API format. Check Paper Partner settings.");
    }
    if (!["bearer", "api-key"].includes(config.authMode) ||
        !["auto", "max_tokens", "max_completion_tokens"].includes(config.chatTokenParam)) {
        throw new Error("Invalid API authentication or token parameter setting.");
    }
    if (config.maxOutputTokens !== "" && (!/^\d+$/.test(String(config.maxOutputTokens)) ||
        Number(config.maxOutputTokens) < 64 || Number(config.maxOutputTokens) > 32768)) {
        throw new Error("Max generated tokens must be a whole number from 64 to 32768, or blank.");
    }
    if (!config.apiKey) throw new Error("API Key is missing for the selected provider.");
    if (!config.model) throw new Error("Model is missing for the selected provider.");
}

/** Read a user-configurable preference, falling back to PREF_DEFAULTS. */
function getPref(key) {
    try {
        const val = Zotero.Prefs.get(PREF_PREFIX + key, true);
        return (val !== undefined && val !== null && val !== "") ? val : PREF_DEFAULTS[key];
    } catch (_) {
        return PREF_DEFAULTS[key];
    }
}

// Zotero's bootstrap sandbox exposes fetch but not always AbortController.
function createRequestController() {
    if (typeof AbortController !== "undefined") return new AbortController();
    const win = Zotero.getMainWindow() || Services.appShell.hiddenDOMWindow;
    return new win.AbortController();
}

function getApiFormat(config) {
    if (config.apiFormat !== "auto") return config.apiFormat;
    const path = new URL(config.endpoint).pathname;
    if (/\/responses\/?$/.test(path)) return "responses";
    if (/\/messages\/?$/.test(path)) return "anthropic";
    if (/:generateContent$/.test(path)) return "gemini";
    return "chat";
}

function getAnswerMode() {
    return getPref("answerMode") === "detailed" ? "detailed" : "brief";
}

function getTriggerDelayMs() {
    const delay = getPref("triggerDelay");
    return CONFIG.triggerDelays[delay] ?? CONFIG.triggerDelays.medium;
}

function getEndpointHost(endpoint) {
    try {
        return new URL(endpoint).host;
    } catch (_) {
        return "invalid-endpoint";
    }
}

let rootURI = "";
const PLUGIN_ID = "paper-partner@qinsihan.github.io";

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
    _setParagraphText(el, text) {
        el.textContent = "";

        const lines = String(text).split("\n");
        lines.forEach((line, index) => {
            if (index > 0) el.appendChild(el.ownerDocument.createElement("br"));
            el.appendChild(el.ownerDocument.createTextNode(line));
        });
    },

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
            Zotero.debug("[PaperPartner] Could not find question paragraph to update.");
            return false;
        }

        const answerLine = content ? `A[${status}]: ${content}` : `A[${status}]:`;

        // If the next sibling <p> is already an A[...], replace it in-place.
        // Otherwise insert a new paragraph after the Q.
        const next = qEl.nextElementSibling;
        if (next && next.tagName === "P" && /^A\[\w+\]:/.test(next.textContent.trim())) {
            this._setParagraphText(next, answerLine);
        } else {
            const aEl = doc.createElement("p");
            this._setParagraphText(aEl, answerLine);
            qEl.insertAdjacentElement("afterend", aEl);
        }

        item.setNote(doc.body.innerHTML);
        await item.saveTx();
        return true;
    },
};

// ============================================================
// API CLIENT
// Text Q&A using Chat Completions, Responses, Messages or generateContent.
// ============================================================
const ApiClient = {
    _modes: {
        brief: {
            maxTokens: 300,
            systemPrompt:
                "You are a quiet reading assistant embedded in a Zotero note. " +
                "Give a compact answer that can be inserted directly below the user's question. " +
                "Explain only the exact term, sentence, or local claim being asked about. " +
                "Use the provided local note excerpt when it helps. " +
                "Do not add broad background, related work, long summaries, bullet lists, or follow-up suggestions.",
            userInstruction:
                "Answer in 1-3 short sentences. Stay local to the question and the provided local note excerpt. " +
                "The local note excerpt may be truncated to 2000 characters. Keep your answer within 300 output tokens.",
        },
        detailed: {
            maxTokens: 1500,
            systemPrompt:
                "You are a careful academic reading assistant embedded in a Zotero note. " +
                "Help the reader genuinely understand the specific point they asked about. " +
                "You may explain the relevant concept, mechanism, causal relationship, and assumptions, using the same local note excerpt provided for this question. " +
                "Format detailed answers with visible paragraph breaks so they remain easy to scan inside a note. " +
                "Do not drift into a full paper summary, broad literature review, or unrelated background.",
            userInstruction:
                "Answer in 2-4 short paragraphs separated by a blank line. " +
                "Use a brief list only if it makes the explanation clearer, and keep list items short. " +
                "Explain the idea more fully while staying anchored to this question and the provided local note excerpt. " +
                "The local note excerpt may be truncated to 2000 characters. Keep your answer within 1500 output tokens.",
        },
    },

    _buildMessages(questionText, contextText, mode) {
        const config = this._modes[mode] || this._modes.brief;
        const userMessage = contextText
            ? `Context from my reading notes:\n${contextText}\n\nQuestion: ${questionText}`
            : `Question: ${questionText}`;

        return {
            maxTokens: config.maxTokens,
            instruction: config.userInstruction,
            messages: [
                { role: "system", content: config.systemPrompt },
                { role: "user", content: config.userInstruction + "\n\n" + userMessage },
            ],
        };
    },

    _normalizeContent(content) {
        if (typeof content === "string") return content.trim();
        if (Array.isArray(content)) {
            return content
                .map(part => {
                    if (typeof part === "string") return part;
                    if (part && (!part.type || ["text", "output_text"].includes(part.type)) && typeof part.text === "string") return part.text;
                    if (part && (!part.type || ["text", "output_text"].includes(part.type)) && typeof part.content === "string") return part.content;
                    return "";
                })
                .join("")
                .trim();
        }
        return "";
    },

    _buildRequest(config, request) {
        const format = getApiFormat(config);
        const compatibility = getApiCompatibility(config, format);
        const maxTokens = config.maxOutputTokens === ""
            ? (compatibility.reasoning ? Math.max(8192, request.maxTokens) : request.maxTokens)
            : Number(config.maxOutputTokens);
        const timeoutMs = compatibility.reasoning ? 180000 : CONFIG.requestTimeoutMs;
        const system = request.messages.filter(m => m.role === "system").map(m => m.content).join("\n\n");
        const users = request.messages.filter(m => m.role === "user").map(m => m.content).join("\n\n");
        const headers = { "Content-Type": "application/json" };
        let endpoint = config.endpoint;
        let body;
        if (format === "anthropic") {
            if (compatibility.bearer) headers.Authorization = `Bearer ${config.apiKey}`;
            else headers["x-api-key"] = config.apiKey;
            headers["anthropic-version"] = "2023-06-01";
            body = { model: config.model, system, messages: [{ role: "user", content: users }], max_tokens: maxTokens };
            if (compatibility.extra.reasoning_effort) body.output_config = { effort: compatibility.extra.reasoning_effort };
        } else if (format === "gemini") {
            headers["x-goog-api-key"] = config.apiKey;
            const model = encodeURIComponent(config.model.replace(/^models\//, ""));
            if (endpoint.includes("{model}")) {
                endpoint = endpoint.replace("{model}", model);
            } else if (!/:generateContent(?:\?|$)/.test(endpoint)) {
                const url = new URL(endpoint);
                url.pathname = url.pathname.replace(/\/$/, "") + "/models/" + model + ":generateContent";
                endpoint = url.href;
            } else {
                const endpointModel = new URL(endpoint).pathname.match(/\/models\/([^/]+):generateContent$/);
                if (!endpointModel || decodeURIComponent(endpointModel[1]) !== decodeURIComponent(model)) {
                    throw new Error("Gemini endpoint and Model differ. Use a /v1beta base URL or a {model} placeholder.");
                }
            }
            body = {
                systemInstruction: { parts: [{ text: system }] },
                contents: [{ role: "user", parts: [{ text: users }] }],
                generationConfig: { maxOutputTokens: maxTokens },
            };
        } else {
            if (config.authMode === "api-key" && !compatibility.bearer) headers["api-key"] = config.apiKey;
            else headers.Authorization = `Bearer ${config.apiKey}`;
            if (format === "responses") {
                body = { model: config.model, instructions: system, input: users, max_output_tokens: maxTokens, store: false };
                if (compatibility.extra.reasoning_effort) body.reasoning = { effort: compatibility.extra.reasoning_effort };
            } else {
                const host = new URL(endpoint).hostname;
                const modernTokens = config.chatTokenParam === "max_completion_tokens" ||
                    (config.chatTokenParam === "auto" &&
                        (compatibility.modernTokens || host === "api.openai.com" || host.endsWith(".openai.azure.com") || host.endsWith(".services.ai.azure.com")));
                body = { model: config.model, messages: request.messages, stream: false,
                    [modernTokens ? "max_completion_tokens" : "max_tokens"]: maxTokens,
                    ...compatibility.extra };
                // Some Qwen models reject non-streaming requests with thinking enabled.
                if ((host === "dashscope.aliyuncs.com" || host === "dashscope-intl.aliyuncs.com" ||
                    host === "dashscope-us.aliyuncs.com") && /^qwen[3-9]/i.test(config.model)) {
                    body.enable_thinking = false;
                }
            }
        }
        // Omit temperature: several current reasoning models reject fixed sampling parameters.
        return { format, endpoint, headers, body, timeoutMs };
    },

    _providerError(data, config) {
        if (!config || !data || !data.error) return "";
        const host = new URL(config.endpoint).hostname;
        if (["open.bigmodel.cn", "api.z.ai"].includes(host)) {
            // Only known codes select local text; never display the upstream message.
            const errors = {
                "1113": "API balance is insufficient. Coding Plan quota does not fund standard API calls.",
                "1211": "Unknown model ID. Check the model name on this GLM platform.",
                "1212": "This model does not support the configured API method.",
                "1220": "This API key does not have permission for the selected model or endpoint.",
            };
            return Object.prototype.hasOwnProperty.call(errors, data.error.code) ? errors[data.error.code] : "";
        }
        if (["api.moonshot.cn", "api.moonshot.ai"].includes(host)) {
            const errors = {
                invalid_authentication_error: "Check this region's API Platform key; Kimi Code keys are separate.",
                resource_not_found_error: "Model not found or unavailable to this account. Check its current model ID.",
                exceeded_current_quota_error: "API balance is insufficient. Check the Kimi API Platform billing account.",
            };
            return Object.prototype.hasOwnProperty.call(errors, data.error.type) ? errors[data.error.type] : "";
        }
        return "";
    },

    _parseResponse(format, data, config) {
        if (!data || data.error || data.type === "error") {
            throw new Error(this._providerError(data, config) || "The provider returned an API error.");
        }
        let content = "";
        let finishReason;
        if (format === "responses") {
            if (data.status === "incomplete") {
                throw new Error("Response is incomplete. Check the token budget (including reasoning) or provider restrictions.");
            }
            if (data.status && data.status !== "completed") throw new Error("Response did not complete.");
            const messages = (Array.isArray(data.output) ? data.output : []).filter(item => item.type === "message");
            const blocks = messages.flatMap(item => Array.isArray(item.content) ? item.content : []);
            if (blocks.some(block => block.type === "refusal")) throw new Error("The provider refused this request.");
            content = blocks.filter(block => block.type === "output_text").map(block => block.text || "").join("\n").trim();
            finishReason = "completed";
        } else if (format === "anthropic") {
            finishReason = data.stop_reason;
            if (finishReason === "max_tokens") throw new Error("Response was cut off by the token limit; increase Max generated tokens.");
            if (finishReason === "refusal") throw new Error("The provider refused this request.");
            if (finishReason === "tool_use" || finishReason === "pause_turn") throw new Error("The provider requested an unsupported tool or continuation.");
            content = (Array.isArray(data.content) ? data.content : [])
                .filter(block => block.type === "text").map(block => block.text || "").join("\n").trim();
        } else if (format === "gemini") {
            if (data.promptFeedback && data.promptFeedback.blockReason) throw new Error("The provider blocked this request.");
            const candidate = data.candidates && data.candidates[0];
            finishReason = candidate && candidate.finishReason;
            if (finishReason === "MAX_TOKENS") throw new Error("Response was cut off by the token limit; increase Max generated tokens.");
            if (finishReason && finishReason !== "STOP") throw new Error("The provider blocked or could not finish this response.");
            const parts = candidate && candidate.content && candidate.content.parts;
            content = (Array.isArray(parts) ? parts : []).filter(part => !part.thought && typeof part.text === "string")
                .map(part => part.text).join("\n").trim();
        } else {
            const choice = data.choices && data.choices[0];
            finishReason = choice && choice.finish_reason;
            if (finishReason === "length") throw new Error("Response was cut off by the token limit; increase Max generated tokens.");
            if (finishReason === "content_filter" || finishReason === "sensitive") throw new Error("The provider blocked this response.");
            if (finishReason === "network_error") throw new Error("The provider could not finish inference. No automatic retry was made.");
            if (finishReason === "model_context_window_exceeded") throw new Error("Model context limit exceeded. Shorten the input or lower Max generated tokens.");
            if (finishReason === "tool_calls" || finishReason === "function_call") throw new Error("The provider requested an unsupported tool.");
            content = choice && choice.message ? this._normalizeContent(choice.message.content) : "";
        }
        if (!content) throw new Error("Empty response from API. Reasoning models may need a larger Max generated tokens budget.");
        return content;
    },

    async query(questionText, contextText) {
        const config = getApiConfig();
        validateApiConfig(config);
        const { endpoint, model } = config;
        const mode = getAnswerMode();
        const request = this._buildMessages(questionText, contextText, mode);
        const wire = this._buildRequest(config, request);

        Zotero.debug(
            "[PaperPartner] API request: host=" + getEndpointHost(endpoint) +
            ", model=" + model +
            ", mode=" + mode +
            ", format=" + wire.format +
            ", instruction_length=" + request.instruction.length +
            ", message_count=" + request.messages.length
        );

        const controller = createRequestController();
        const timeout = setTimeout(() => controller.abort(), wire.timeoutMs);
        try {
            const response = await fetch(wire.endpoint, {
                method: "POST",
                signal: controller.signal,
                redirect: "error",
                credentials: "omit",
                headers: wire.headers,
                body: JSON.stringify(wire.body),
            });

            if (!response.ok) {
                Zotero.debug(
                    "[PaperPartner] API HTTP error: host=" + getEndpointHost(endpoint) +
                    ", model=" + model +
                    ", status=" + response.status
                );
                // Never copy arbitrary upstream error text into logs or synced notes.
                let detail = "Check the selected provider's settings and service status.";
                if (response.status === 401 || response.status === 403) {
                    detail = "Check this provider's API Key and model permissions.";
                } else if (response.status === 402) {
                    detail = "Check the provider's balance or billing settings.";
                } else if (response.status === 429) {
                    detail = "Rate or usage limit reached. Check the provider's quota before retrying.";
                } else if (response.status === 400) {
                    detail = "Check the model, API format and token limit.";
                } else if (response.status === 404 || response.status === 405) {
                    detail = "Check the full API Endpoint and model ID; a base URL alone may be incomplete.";
                }
                try { detail = this._providerError(await response.json(), config) || detail; } catch (_) {}
                const url = new URL(endpoint);
                if (["api.kimi.com", "api.kimi.ai"].includes(url.hostname) && /^\/coding(?:\/|$)/.test(url.pathname)) {
                    detail = "Use a Kimi API Platform URL and matching key for this reading plugin; Kimi Code is separate.";
                } else if (["open.bigmodel.cn", "api.z.ai"].includes(url.hostname) && /^\/api\/coding(?:\/|$)/.test(url.pathname)) {
                    detail = "Use GLM's standard API endpoint. Coding Plan quota is limited to supported tools.";
                }
                throw new Error(`HTTP ${response.status}: ${detail}`);
            }

            let data;
            try {
                data = await response.json();
            } catch (e) {
                Zotero.debug(
                    "[PaperPartner] API JSON parse error: host=" + getEndpointHost(endpoint) +
                    ", model=" + model +
                    ", status=" + response.status
                );
                throw new Error("Invalid JSON from API");
            }

            const content = this._parseResponse(wire.format, data, config);
            Zotero.debug(
                "[PaperPartner] API response OK: host=" + getEndpointHost(endpoint) +
                ", format=" + wire.format +
                ", status=" + response.status +
                ", content_length=" + content.length
            );

            return content;
        } catch (e) {
            if (controller.signal.aborted) {
                throw new Error(`API request timed out after ${wire.timeoutMs / 1000} seconds. No automatic retry was made.`);
            }
            if (e instanceof TypeError) {
                throw new Error("API connection failed. Check the endpoint and network; redirects are not allowed.");
            }
            throw e;
        } finally {
            clearTimeout(timeout);
        }
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

        const delayMs = getTriggerDelayMs();
        const timer = setTimeout(() => {
            this._debounceTimers.delete(itemId);
            this._enqueue(itemId);
        }, delayMs);

        this._debounceTimers.set(itemId, timer);
        Zotero.debug("[PaperPartner] Scheduled note " + itemId + " in " + delayMs + "ms.");
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
    if (!getApiConfig().apiKey) {
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

    Zotero.debug("[PaperPartner] Processing question.");

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
    Zotero.debug("[PaperPartner] Answer written.");
}

// ============================================================
// NOTIFIER OBSERVER
// Listens for item modifications and routes notes to the task queue.
// ============================================================
let _observerID = null;
let _preferencePaneID = null;
let _active = false;

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
    _active = true;

    return Zotero.initializationPromise.then(async () => {
        if (!_active) return;
        // All prefs logic is inline in the onload of prefs.xhtml — no scripts array needed.
        try {
            _preferencePaneID = await Zotero.PreferencePanes.register({
                id: "paper-partner-preferences",
                pluginID: PLUGIN_ID,
                src:      rootURI + "prefs.xhtml",
                label:    "Paper Partner",
            });
            Zotero.debug("[PaperPartner] Preferences pane registered.");
        } catch (e) {
            Zotero.debug("[PaperPartner] PreferencePanes.register failed: " + e.message);
        }

        if (!_active) {
            if (_preferencePaneID) Zotero.PreferencePanes.unregister(_preferencePaneID);
            _preferencePaneID = null;
            return;
        }
        registerObserver();
        Zotero.debug("[PaperPartner] Ready.");
    });
}

function shutdown(data, reason) {
    Zotero.debug("[PaperPartner] shutdown");
    _active = false;
    try { if (_preferencePaneID) Zotero.PreferencePanes.unregister(_preferencePaneID); } catch (_) {}
    _preferencePaneID = null;
    unregisterObserver();
    TaskQueue.clear();
}

function uninstall(data, reason) {
    Zotero.debug("[PaperPartner] uninstall");
}
