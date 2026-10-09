const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'bootstrap.js'), 'utf8');

function runtime(initial = {}, overrides = {}) {
    const prefs = new Map(Object.entries(initial));
    const calls = [];
    const logs = [];
    const context = vm.createContext({
        URL, AbortController, TypeError, setTimeout, clearTimeout,
        Zotero: {
            Prefs: { get: key => prefs.get(key.replace('extensions.paper-partner.', '')) },
            debug: message => logs.push(message),
        },
        fetch: async (url, options) => {
            calls.push({ url, options });
            return { ok: true, status: 200, json: async () => ({
                choices: [{ message: { content: ' A public answer. ' }, finish_reason: 'stop' }],
            }) };
        },
        ...overrides,
    });
    vm.runInContext(source + '\nglobalThis.api = { ApiClient, getApiConfig, CONFIG, createRequestController, getTriggerDelayMs, startup, shutdown, NoteParser, NoteWriter, processQuestion };', context);
    return { ...context.api, prefs, calls, logs };
}

test('upgrading keeps an existing custom endpoint, key and model', async () => {
    const r = runtime({ apiEndpoint: 'https://example.org/v1/chat/completions', apiKey: 'legacy-key', model: 'legacy-model' });
    assert.equal(await r.ApiClient.query('Public question', 'Public excerpt'), 'A public answer.');
    assert.equal(r.calls[0].url, 'https://example.org/v1/chat/completions');
    assert.equal(r.calls[0].options.headers.Authorization, 'Bearer legacy-key');
    assert.equal(JSON.parse(r.calls[0].options.body).model, 'legacy-model');
});

test('provider switches isolate credentials and do not configure paid fallback or retries', async () => {
    const r = runtime({ apiKey: 'legacy-key', model: 'legacy-model', orcaApiKey: 'orca-key', provider: 'orcarouter' });
    await r.ApiClient.query('Public question', '');
    assert.equal(r.calls[0].url, 'https://api.orcarouter.ai/v1/chat/completions');
    assert.equal(r.calls[0].options.headers.Authorization, 'Bearer orca-key');
    const body = JSON.parse(r.calls[0].options.body);
    assert.equal(body.model, 'orcarouter/free');
    assert.equal(body.models, undefined);
    assert.equal(body.extra_body, undefined);
    assert.equal(r.calls[0].options.redirect, 'error');
    r.prefs.set('provider', 'custom');
    await r.ApiClient.query('Public question', '');
    assert.equal(r.calls[1].options.headers.Authorization, 'Bearer legacy-key');
    assert.equal(JSON.parse(r.calls[1].options.body).model, 'legacy-model');
});

test('a missing OrcaRouter key never uses the existing provider key', async () => {
    const r = runtime({ provider: 'orcarouter', apiKey: 'legacy-secret' });
    await assert.rejects(r.ApiClient.query('Question', ''), /API Key is missing/);
    assert.equal(r.calls.length, 0);
});

test('rejects credential-bearing and insecure remote URLs before sending secrets', async () => {
    for (const apiEndpoint of ['http://remote.example/v1', 'https://name:password@example.org/v1', 'broken']) {
        const r = runtime({ apiKey: 'secret', apiEndpoint });
        await assert.rejects(r.ApiClient.query('Question', ''));
        assert.equal(r.calls.length, 0);
    }
    const r = runtime({ apiKey: 'local-key', apiEndpoint: 'http://localhost:8000/v1/chat/completions' });
    await r.ApiClient.query('Question', '');
    assert.equal(r.calls.length, 1);
});

test('upstream errors cannot echo private content into notes or debug logs, and are not retried', async () => {
    for (const status of [400, 401, 402, 403, 429, 503]) {
        let attempts = 0;
        const r = runtime({ provider: 'orcarouter', orcaApiKey: 'secret-key' }, {
            fetch: async () => {
                attempts++;
                return { ok: false, status, text: async () => 'PRIVATE QUESTION secret-key' };
            },
        });
        await assert.rejects(r.ApiClient.query('PRIVATE QUESTION', 'PRIVATE EXCERPT'), error => {
            assert.match(error.message, new RegExp(`HTTP ${status}:`));
            assert.doesNotMatch(error.message, /PRIVATE|secret-key/);
            return true;
        });
        assert.equal(attempts, 1);
        assert.doesNotMatch(r.logs.join('\n'), /PRIVATE|secret-key/);
    }
});

test('timeout aborts a stalled request and clears its timer', async () => {
    let attempts = 0, cleared = false;
    const r = runtime({ apiKey: 'key' }, {
        setTimeout: callback => { queueMicrotask(callback); return 99; },
        clearTimeout: id => { assert.equal(id, 99); cleared = true; },
        fetch: async (url, options) => {
            attempts++;
            return new Promise((resolve, reject) => {
                options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
            });
        },
    });
    await assert.rejects(r.ApiClient.query('Question', ''), /timed out/);
    assert.equal(attempts, 1);
    assert.equal(cleared, true);
});

test('invalid JSON, empty output and token truncation remain explicit failures', async () => {
    for (const [json, expected] of [
        [async () => { throw new Error('PRIVATE RAW BODY'); }, /Invalid JSON/],
        [async () => ({ choices: [{ message: { content: '' } }] }), /Empty response/],
        [async () => ({ choices: [{ message: { content: 'partial' }, finish_reason: 'length' }] }), /cut off/],
    ]) {
        const r = runtime({ apiKey: 'key' }, { fetch: async () => ({ ok: true, status: 200, json }) });
        await assert.rejects(r.ApiClient.query('Question', ''), expected);
        assert.doesNotMatch(r.logs.join('\n'), /PRIVATE RAW BODY/);
    }
});

function preferences(initial = {}) {
    const prefs = new Map(Object.entries(initial));
    const elements = new Map();
    for (const key of ['provider', 'apiKey', 'apiEndpoint', 'model', 'answerMode', 'triggerDelay', 'orcaNotice', 'apiFormat', 'authMode', 'chatTokenParam', 'maxOutputTokens', 'endpointRow', 'customOptions']) {
        const listeners = new Map();
        elements.set('pp-' + key, {
            value: '', hidden: false, readOnly: false,
            addEventListener: (event, callback) => listeners.set(event, callback),
            emit(event = 'change') { listeners.get(event)?.(); },
        });
    }
    const xml = fs.readFileSync(path.join(root, 'prefs.xhtml'), 'utf8');
    const script = xml.match(/onload="([\s\S]*?)">/)[1]
        .replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>').replaceAll('&quot;', '"');
    const context = vm.createContext({
        document: { getElementById: id => elements.get(id) },
        Zotero: { Prefs: {
            get: key => prefs.get(key.replace('extensions.paper-partner.', '')),
            set: (key, value) => prefs.set(key.replace('extensions.paper-partner.', ''), value),
        } },
    });
    vm.runInContext(script, context);
    return { prefs, el: key => elements.get('pp-' + key) };
}

test('settings upgrade preserves legacy values; switching exposes notice and separate credentials', () => {
    const p = preferences({ apiKey: 'legacy-key', apiEndpoint: 'https://legacy.example/chat/completions', model: 'legacy-model' });
    assert.equal(p.el('provider').value, 'custom');
    assert.equal(p.el('apiKey').value, 'legacy-key');
    assert.equal(p.el('orcaNotice').hidden, true);
    assert.equal(p.el('endpointRow').hidden, false);
    assert.equal(p.el('customOptions').hidden, false);
    p.el('provider').value = 'orcarouter'; p.el('provider').emit();
    assert.equal(p.el('apiKey').value, '');
    assert.equal(p.el('apiEndpoint').readOnly, true);
    assert.equal(p.el('model').value, 'orcarouter/free');
    assert.equal(p.el('orcaNotice').hidden, false);
    assert.equal(p.el('endpointRow').hidden, true);
    assert.equal(p.el('customOptions').hidden, true);
    p.el('apiKey').value = 'orca-key'; p.el('apiKey').emit('input');
    p.el('model').value = 'chosen/model'; p.el('model').emit();
    assert.equal(p.prefs.get('apiKey'), 'legacy-key');
    assert.equal(p.prefs.get('orcaApiKey'), 'orca-key');
    p.el('provider').value = 'custom'; p.el('provider').emit();
    assert.equal(p.el('apiKey').value, 'legacy-key');
    assert.equal(p.el('apiEndpoint').value, 'https://legacy.example/chat/completions');
    assert.equal(p.el('apiEndpoint').readOnly, false);
    assert.equal(p.el('endpointRow').hidden, false);
    assert.equal(p.el('customOptions').hidden, false);
    assert.equal(p.el('model').value, 'legacy-model');
    p.el('provider').value = 'orcarouter'; p.el('provider').emit();
    assert.equal(p.el('apiKey').value, 'orca-key');
    assert.equal(p.el('model').value, 'chosen/model');
    const reopened = preferences(Object.fromEntries(p.prefs));
    assert.equal(reopened.el('provider').value, 'orcarouter');
    assert.equal(reopened.el('apiKey').value, 'orca-key');
});

test('shared answer settings persist across provider changes', () => {
    const p = preferences();
    p.el('answerMode').value = 'detailed'; p.el('answerMode').emit();
    p.el('triggerDelay').value = 'long'; p.el('triggerDelay').emit();
    p.el('provider').value = 'orcarouter'; p.el('provider').emit();
    assert.equal(p.prefs.get('answerMode'), 'detailed');
    assert.equal(p.prefs.get('triggerDelay'), 'long');
});

function wireFor(initial) {
    const r = runtime({ apiKey: 'provider-key', ...initial });
    return r.ApiClient._buildRequest(r.getApiConfig(), r.ApiClient._buildMessages('Public question', 'Public excerpt', 'brief'));
}

test('OpenAI modern chat uses max_completion_tokens and omits unsupported temperature', () => {
    const w = wireFor({ apiEndpoint: 'https://api.openai.com/v1/chat/completions', model: 'gpt-current' });
    assert.equal(w.format, 'chat');
    assert.equal(w.body.max_completion_tokens, 300);
    assert.equal(w.body.max_tokens, undefined);
    assert.equal(w.body.temperature, undefined);
    assert.equal(w.headers.Authorization, 'Bearer provider-key');
    const legacy = wireFor({ chatTokenParam: 'max_tokens', apiEndpoint: 'https://api.openai.com/v1/chat/completions' });
    assert.equal(legacy.body.max_tokens, 300);
});

test('Responses sends instructions/input, turns storage off, and reads only visible output', async () => {
    const w = wireFor({ apiEndpoint: 'https://api.openai.com/v1/responses', maxOutputTokens: '4096' });
    assert.equal(w.format, 'responses');
    assert.equal(w.body.max_output_tokens, 4096);
    assert.equal(w.body.store, false);
    assert.equal(w.body.messages, undefined);
    assert.match(w.body.input, /Public question/);
    assert.match(w.body.instructions, /reading assistant/);
    const r = runtime({ apiKey: 'key', apiEndpoint: 'https://api.openai.com/v1/responses' }, {
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ status: 'completed', output: [
            { type: 'reasoning', summary: [{ text: 'PRIVATE THOUGHT' }] },
            { type: 'message', content: [{ type: 'output_text', text: 'Visible answer' }] },
        ] }) }),
    });
    assert.equal(await r.ApiClient.query('Question', ''), 'Visible answer');
});

test('Claude Messages uses native headers, system field and only text content blocks', async () => {
    const w = wireFor({ apiEndpoint: 'https://api.anthropic.com/v1/messages' });
    assert.equal(w.format, 'anthropic');
    assert.equal(w.headers['x-api-key'], 'provider-key');
    assert.equal(w.headers['anthropic-version'], '2023-06-01');
    assert.equal(w.headers.Authorization, undefined);
    assert.equal(w.body.messages.length, 1);
    assert.equal(w.body.messages[0].role, 'user');
    assert.match(w.body.system, /reading assistant/);
    const r = runtime({ apiKey: 'key', apiEndpoint: 'https://api.anthropic.com/v1/messages' }, {
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ stop_reason: 'end_turn', content: [
            { type: 'thinking', thinking: 'PRIVATE THOUGHT', text: 'PRIVATE THOUGHT' },
            { type: 'text', text: 'Visible answer' },
        ] }) }),
    });
    assert.equal(await r.ApiClient.query('Question', ''), 'Visible answer');
});

test('Gemini native uses model URL, header authentication and parts without exposing thoughts', async () => {
    const w = wireFor({ apiFormat: 'gemini', apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-current' });
    assert.equal(w.endpoint, 'https://generativelanguage.googleapis.com/v1beta/models/gemini-current:generateContent');
    assert.equal(w.headers['x-goog-api-key'], 'provider-key');
    assert.equal(w.headers.Authorization, undefined);
    assert.equal(new URL(w.endpoint).searchParams.has('key'), false);
    assert.equal(w.body.generationConfig.maxOutputTokens, 300);
    assert.match(w.body.systemInstruction.parts[0].text, /reading assistant/);
    const template = wireFor({ apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', model: 'gemini-current' });
    assert.equal(template.endpoint, w.endpoint);
    const r = runtime({ apiKey: 'key', apiFormat: 'gemini', apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta', model: 'gemini-current' }, {
        fetch: async () => ({ ok: true, status: 200, json: async () => ({ candidates: [{ finishReason: 'STOP', content: { parts: [
            { thought: true, text: 'PRIVATE THOUGHT' }, { text: 'Visible answer' },
        ] } }] }) }),
    });
    assert.equal(await r.ApiClient.query('Question', ''), 'Visible answer');
    assert.throws(() => wireFor({ apiFormat: 'gemini', apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta/models/other:generateContent', model: 'gemini-current' }), /differ/);
});

test('Azure supports API-key auth for Chat and Responses without sending a second credential header', () => {
    for (const apiFormat of ['chat', 'responses']) {
        const endpoint = apiFormat === 'chat' ? 'chat/completions' : 'responses';
        const w = wireFor({ authMode: 'api-key', apiFormat, apiEndpoint: 'https://resource.openai.azure.com/openai/v1/' + endpoint, model: 'deployment-name' });
        assert.equal(w.headers['api-key'], 'provider-key');
        assert.equal(w.headers.Authorization, undefined);
        assert.equal(w.body.model, 'deployment-name');
        if (apiFormat === 'chat') assert.equal(w.body.max_completion_tokens, 300);
    }
});

test('Qwen official non-streaming calls explicitly disable thinking; other services receive no Qwen extension', () => {
    const qwen = wireFor({ apiEndpoint: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', model: 'qwen3-current' });
    assert.equal(qwen.body.enable_thinking, false);
    const other = wireFor({ model: 'qwen3-current' });
    assert.equal(other.body.enable_thinking, undefined);
});

test('all native response formats reject errors, blocked answers and incomplete output', () => {
    const r = runtime();
    for (const [format, payload, pattern] of [
        ['responses', { status: 'incomplete', output: [] }, /incomplete/],
        ['responses', { status: 'failed', output: [] }, /did not complete/],
        ['responses', { output: [{ type: 'message', content: [{ type: 'refusal', refusal: 'raw' }] }] }, /refused/],
        ['anthropic', { stop_reason: 'max_tokens', content: [{ type: 'text', text: 'partial' }] }, /cut off/],
        ['anthropic', { stop_reason: 'refusal' }, /refused/],
        ['gemini', { promptFeedback: { blockReason: 'SAFETY' } }, /blocked/],
        ['gemini', { candidates: [{ finishReason: 'MAX_TOKENS', content: { parts: [{ text: 'partial' }] } }] }, /cut off/],
        ['gemini', { candidates: [{ finishReason: 'SAFETY' }] }, /blocked/],
        ['chat', { choices: [{ finish_reason: 'content_filter' }] }, /blocked/],
        ['chat', { choices: [{ finish_reason: 'sensitive', message: { content: 'partial' } }] }, /blocked/],
        ['chat', { choices: [{ finish_reason: 'network_error', message: { content: 'partial' } }] }, /could not finish/],
        ['chat', { choices: [{ finish_reason: 'model_context_window_exceeded', message: { content: 'partial' } }] }, /context limit/],
    ]) assert.throws(() => r.ApiClient._parseResponse(format, payload), pattern);
    for (const format of ['chat', 'responses', 'anthropic', 'gemini']) {
        assert.throws(() => r.ApiClient._parseResponse(format, { error: { message: 'PRIVATE ERROR' } }), error => {
            assert.doesNotMatch(error.message, /PRIVATE/); return true;
        });
    }
});

test('token budgets and protocol settings are validated before sending any request', async () => {
    for (const invalid of ['-1', '0', '63', '32769', '300.5', 'NaN']) {
        const r = runtime({ apiKey: 'key', maxOutputTokens: invalid });
        await assert.rejects(r.ApiClient.query('Question', ''), /Max generated tokens/);
        assert.equal(r.calls.length, 0);
    }
    const r = runtime({ apiKey: 'key', apiFormat: 'unknown' });
    await assert.rejects(r.ApiClient.query('Question', ''), /Unknown API format/);
    assert.equal(r.calls.length, 0);
});

test('OrcaRouter retains a fixed chat format and its own token budget while custom settings persist', () => {
    const p = preferences({ apiFormat: 'responses', authMode: 'api-key', chatTokenParam: 'max_completion_tokens', maxOutputTokens: '4096' });
    p.el('provider').value = 'orcarouter'; p.el('provider').emit();
    assert.equal(p.el('apiFormat').value, 'chat');
    assert.equal(p.el('apiFormat').disabled, true);
    assert.equal(p.el('authMode').value, 'bearer');
    assert.equal(p.el('maxOutputTokens').value, '');
    p.el('maxOutputTokens').value = '8192'; p.el('maxOutputTokens').emit();
    p.el('provider').value = 'custom'; p.el('provider').emit();
    assert.equal(p.el('apiFormat').value, 'responses');
    assert.equal(p.el('apiFormat').disabled, false);
    assert.equal(p.el('authMode').value, 'api-key');
    assert.equal(p.el('maxOutputTokens').value, '4096');
    assert.equal(p.prefs.get('orcaMaxOutputTokens'), '8192');
});

test('Zotero sandbox without a global AbortController uses the main window implementation', () => {
    const r = runtime({}, { AbortController: undefined, Zotero: {
        Prefs: { get: () => undefined }, debug: () => {}, getMainWindow: () => ({ AbortController }),
    } });
    const controller = r.createRequestController();
    assert.equal(controller.signal.aborted, false);
    controller.abort();
    assert.equal(controller.signal.aborted, true);
});

test('immediate trigger remains immediate instead of falling back to two seconds', () => {
    assert.equal(runtime({ triggerDelay: 'immediate' }).getTriggerDelayMs(), 0);
});

test('Zotero startup awaits pane registration and shutdown unregisters the exact pane ID', async () => {
    let registered, removed, observerRemoved;
    const r = runtime({}, { Zotero: {
        Prefs: { get: () => undefined }, debug: () => {}, initializationPromise: Promise.resolve(),
        PreferencePanes: {
            register: async options => { registered = options; return 'actual-pane-id'; },
            unregister: id => { removed = id; },
        },
        Notifier: { registerObserver: () => 101, unregisterObserver: id => { observerRemoved = id; } },
    } });
    await r.startup({ rootURI: 'file:///test-plugin/' });
    assert.equal(registered.id, 'paper-partner-preferences');
    assert.equal(registered.src, 'file:///test-plugin/prefs.xhtml');
    r.shutdown();
    assert.equal(removed, 'actual-pane-id');
    assert.equal(observerRemoved, 101);
});

test('Zotero shutdown during initialization cannot register a late observer', async () => {
    let resolveInit, registrations = 0;
    const init = new Promise(resolve => { resolveInit = resolve; });
    const r = runtime({}, { Zotero: {
        Prefs: { get: () => undefined }, debug: () => {}, initializationPromise: init,
        PreferencePanes: { register: async () => { registrations++; }, unregister: () => {} },
        Notifier: { registerObserver: () => { registrations++; }, unregisterObserver: () => {} },
    } });
    const start = r.startup({ rootURI: 'file:///test-plugin/' });
    r.shutdown(); resolveInit(); await start;
    assert.equal(registrations, 0);
});

test('install manifest targets Zotero 10.0.4 and retains Zotero 7 minimum', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));
    assert.equal(manifest.applications.zotero.strict_max_version, '10.0.*');
    assert.equal(manifest.applications.zotero.strict_min_version, '7.0');
});

async function localServer(t, handler) {
    const http = require('node:http');
    const server = http.createServer(handler);
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(async () => {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
    });
    return `http://127.0.0.1:${server.address().port}`;
}

test('four protocols complete real localhost HTTP round trips with their own payload and key headers', async t => {
    const received = [];
    const responses = {
        '/v1/chat/completions': { choices: [{ message: { content: 'Chat answer' }, finish_reason: 'stop' }] },
        '/v1/responses': { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'Responses answer' }] }] },
        '/v1/messages': { stop_reason: 'end_turn', content: [{ type: 'thinking', thinking: 'Ignore this' }, { type: 'text', text: 'Claude answer' }] },
        '/v1beta/models/test-model:generateContent': { candidates: [{ finishReason: 'STOP', content: { parts: [{ thought: true, text: 'Ignore this' }, { text: 'Gemini answer' }] } }] },
    };
    const base = await localServer(t, async (req, res) => {
        let raw = '';
        for await (const chunk of req) raw += chunk;
        const route = new URL(req.url, base).pathname;
        received.push({ route, headers: req.headers, body: JSON.parse(raw), method: req.method, url: req.url });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(responses[route]));
    });
    for (const [route, format, answer] of [
        ['/v1/chat/completions', 'auto', 'Chat answer'],
        ['/v1/responses', 'auto', 'Responses answer'],
        ['/v1/messages', 'auto', 'Claude answer'],
        ['/v1beta?test=preserved', 'gemini', 'Gemini answer'],
    ]) {
        const r = runtime({ apiEndpoint: base + route, apiKey: 'fake-test-key', model: 'test-model', apiFormat: format }, { fetch });
        assert.equal(await r.ApiClient.query('Public question', 'Public context'), answer);
    }
    assert.equal(received.length, 4);
    for (const req of received) {
        assert.equal(req.method, 'POST');
        assert.equal(req.headers['content-type'], 'application/json');
        assert.equal(req.headers.cookie, undefined);
        assert.equal(req.body.temperature, undefined);
    }
    assert.equal(received[0].headers.authorization, 'Bearer fake-test-key');
    assert.equal(received[0].body.messages[0].role, 'system');
    assert.equal(received[1].body.store, false);
    assert.equal(received[1].body.max_output_tokens, 300);
    assert.equal(received[2].headers.authorization, undefined);
    assert.equal(received[2].headers['x-api-key'], 'fake-test-key');
    assert.equal(received[2].headers['anthropic-version'], '2023-06-01');
    assert.equal(received[3].headers.authorization, undefined);
    assert.equal(received[3].headers['x-goog-api-key'], 'fake-test-key');
    assert.match(received[3].url, /\?test=preserved$/);
    assert.doesNotMatch(received[3].url, /fake-test-key/);
    assert.equal(received[3].body.generationConfig.maxOutputTokens, 300);
});

test('real HTTP redirects cannot forward credentials to another endpoint', async t => {
    let destinationCalls = 0, sourceCalls = 0;
    const destination = await localServer(t, (req, res) => { destinationCalls++; res.end('{}'); });
    const origin = await localServer(t, (req, res) => {
        sourceCalls++;
        res.writeHead(307, { Location: destination + '/capture' }); res.end();
    });
    const r = runtime({ apiEndpoint: origin + '/v1/chat/completions', apiKey: 'fake-test-key' }, { fetch });
    await assert.rejects(r.ApiClient.query('Public question', ''), /redirects are not allowed/);
    assert.equal(sourceCalls, 1);
    assert.equal(destinationCalls, 0);
    assert.doesNotMatch(r.logs.join('\n'), /fake-test-key|Public question/);
});

test('chat content arrays ignore typed reasoning blocks even if they use a content string', () => {
    const r = runtime();
    const output = r.ApiClient._parseResponse('chat', { choices: [{ message: { content: [
        { type: 'reasoning', text: 'hidden', content: 'also hidden' },
        { type: 'text', text: 'Visible answer' },
    ] }, finish_reason: 'stop' }] });
    assert.equal(output, 'Visible answer');
});

test('successful question processing never logs the question or note context', async () => {
    const r = runtime({ apiKey: 'fake-test-key' });
    const writes = [];
    const el = { textContent: 'Q: PRIVATE QUESTION' };
    r.NoteWriter.write = async (item, question, status, content) => { writes.push({ status, content }); return true; };
    r.NoteParser.parse = () => [
        { type: 'content', text: 'PRIVATE CONTEXT', index: 0 },
        { type: 'question', text: 'PRIVATE QUESTION', index: 1, el },
    ];
    await r.processQuestion({ getNote: () => '' }, { questionText: 'PRIVATE QUESTION', contextText: 'PRIVATE CONTEXT', el });
    assert.equal(writes.at(-1).status, 'done');
    assert.equal(writes.at(-1).content, 'A public answer.');
    assert.doesNotMatch(r.logs.join('\n'), /PRIVATE QUESTION|PRIVATE CONTEXT|fake-test-key/);
});

test('Kimi and GLM official SDK base URLs resolve on the same host without losing query parameters', () => {
    for (const [base, expected] of [
        ['https://api.moonshot.cn/v1/', 'https://api.moonshot.cn/v1/chat/completions'],
        ['https://api.moonshot.ai', 'https://api.moonshot.ai/v1/chat/completions'],
        ['https://open.bigmodel.cn/api/paas/v4/', 'https://open.bigmodel.cn/api/paas/v4/chat/completions'],
        ['https://api.z.ai/api/paas/v4', 'https://api.z.ai/api/paas/v4/chat/completions'],
    ]) {
        const w = wireFor({ apiEndpoint: base });
        assert.equal(w.endpoint, expected);
        assert.equal(new URL(w.endpoint).hostname, new URL(base).hostname);
    }
    assert.equal(wireFor({ apiEndpoint: 'https://api.moonshot.cn/v1/?test=keep' }).endpoint,
        'https://api.moonshot.cn/v1/chat/completions?test=keep');
    assert.equal(wireFor({ apiEndpoint: 'https://custom.example/v1' }).endpoint, 'https://custom.example/v1');
    assert.equal(wireFor({ apiEndpoint: 'https://api.moonshot.cn/v1', apiFormat: 'responses' }).endpoint,
        'https://api.moonshot.cn/v1');
});

test('Kimi K2.6 uses non-thinking short Q&A, native Bearer auth and its current token field', () => {
    for (const host of ['api.moonshot.cn', 'api.moonshot.ai']) {
        const w = wireFor({ apiEndpoint: `https://${host}/v1`, model: 'kimi-k2.6', authMode: 'api-key' });
        assert.equal(w.body.thinking.type, 'disabled');
        assert.equal(w.body.reasoning_effort, undefined);
        assert.equal(w.body.max_completion_tokens, 300);
        assert.equal(w.body.max_tokens, undefined);
        assert.equal(w.body.temperature, undefined);
        assert.equal(w.body.stream, false);
        assert.equal(w.headers.Authorization, 'Bearer provider-key');
        assert.equal(w.headers['api-key'], undefined);
    }
});

test('mandatory Kimi thinking models get room for reasoning without unsupported switches', () => {
    for (const model of ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.7-code-highspeed', 'kimi-k2-thinking']) {
        const w = wireFor({ apiEndpoint: 'https://api.moonshot.cn/v1', model });
        assert.equal(w.body.thinking, undefined);
        assert.equal(w.body.reasoning_effort, model === 'kimi-k3' ? 'low' : undefined);
        assert.equal(w.body.max_completion_tokens, 8192);
        assert.equal(w.timeoutMs, 180000);
    }
    const regular = wireFor({ apiEndpoint: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' });
    assert.equal(regular.body.thinking, undefined);
    assert.equal(regular.body.max_completion_tokens, 300);
    assert.equal(regular.timeoutMs, 60000);
});

test('GLM optional thinking models use short Q&A while older models receive no thinking extension', () => {
    for (const host of ['open.bigmodel.cn', 'api.z.ai']) {
        for (const model of ['glm-4.5', 'glm-4.5-air', 'glm-4.7-flash', 'glm-5', 'glm-5.2']) {
            const w = wireFor({ apiEndpoint: `https://${host}/api/paas/v4`, model, authMode: 'api-key' });
            assert.equal(w.body.thinking.type, 'disabled');
            assert.equal(w.body.max_tokens, 300);
            assert.equal(w.body.reasoning_effort, undefined);
            assert.equal(w.headers.Authorization, 'Bearer provider-key');
        }
    }
    const old = wireFor({ apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' });
    assert.equal(old.body.thinking, undefined);
    assert.equal(old.body.reasoning_effort, undefined);
});

test('mandatory GLM thinking models are never sent a forbidden disabled flag', () => {
    for (const model of ['glm-5.3', 'glm-5.3-flash', 'glm-5.3-flashx']) {
        const w = wireFor({ apiEndpoint: 'https://open.bigmodel.cn/api/paas/v4', model });
        assert.equal(w.body.thinking, undefined);
        assert.equal(w.body.reasoning_effort, 'low');
        assert.equal(w.body.max_tokens, 8192);
        assert.equal(w.timeoutMs, 180000);
    }
});

test('explicit generation and token field overrides survive vendor defaults', () => {
    const w = wireFor({ apiEndpoint: 'https://api.moonshot.cn/v1', model: 'kimi-k3', maxOutputTokens: '2048', chatTokenParam: 'max_tokens' });
    assert.equal(w.body.max_tokens, 2048);
    assert.equal(w.body.max_completion_tokens, undefined);
});

test('vendor-specific thinking flags and larger budgets never leak to other services or protocols', () => {
    for (const apiEndpoint of ['https://proxy.example/v1/chat/completions', 'https://api.moonshot.cn.evil.example/v1/chat/completions']) {
        const w = wireFor({ apiEndpoint, model: 'kimi-k3' });
        assert.equal(w.body.reasoning_effort, undefined);
        assert.equal(w.body.thinking, undefined);
        assert.equal(w.body.max_tokens, 300);
        assert.equal(w.timeoutMs, 60000);
    }
    const responses = wireFor({ apiEndpoint: 'https://api.moonshot.cn/v1/responses', model: 'kimi-k3' });
    assert.equal(responses.body.reasoning_effort, undefined);
    assert.equal(responses.body.reasoning.effort, 'low');
    assert.equal(responses.body.max_output_tokens, 8192);
    assert.equal(responses.timeoutMs, 180000);
    const messages = wireFor({ apiEndpoint: 'https://api.moonshot.cn/anthropic/v1/messages', model: 'kimi-k3' });
    assert.equal(messages.body.thinking, undefined);
    assert.equal(messages.body.reasoning_effort, undefined);
    assert.equal(messages.body.output_config.effort, 'low');
    assert.equal(messages.body.max_tokens, 8192);
    assert.equal(messages.timeoutMs, 180000);
    assert.equal(messages.headers.Authorization, 'Bearer provider-key');
    assert.equal(messages.headers['x-api-key'], undefined);
});

test('chat messages contain one user turn with both the instruction and question', () => {
    const w = wireFor({});
    assert.deepEqual(Array.from(w.body.messages, m => m.role), ['system', 'user']);
    assert.match(w.body.messages[1].content, /Answer in 1-3 short sentences/);
    assert.match(w.body.messages[1].content, /Public question/);
    assert.match(w.body.messages[1].content, /Public excerpt/);
});

test('provider error codes give useful local guidance without copying upstream private text', async () => {
    for (const [endpoint, status, error, expected] of [
        ['https://open.bigmodel.cn/api/paas/v4', 400, { code: '1211' }, /Unknown model ID/],
        ['https://api.z.ai/api/paas/v4', 429, { code: 1113 }, /balance is insufficient/],
        ['https://api.moonshot.cn/v1', 401, { type: 'invalid_authentication_error' }, /Kimi Code keys are separate/],
        ['https://api.moonshot.ai/v1', 429, { type: 'exceeded_current_quota_error' }, /billing account/],
        ['https://api.moonshot.cn/v1', 404, { type: 'resource_not_found_error' }, /current model ID/],
    ]) {
        const r = runtime({ apiEndpoint: endpoint, apiKey: 'fake-test-key' }, {
            fetch: async () => ({ ok: false, status, json: async () => ({ error: { ...error, message: 'PRIVATE PROMPT fake-test-key' } }) }),
        });
        await assert.rejects(r.ApiClient.query('PRIVATE PROMPT', ''), err => {
            assert.match(err.message, expected);
            assert.doesNotMatch(err.message, /PRIVATE PROMPT|fake-test-key/);
            return true;
        });
        assert.doesNotMatch(r.logs.join('\n'), /PRIVATE PROMPT|fake-test-key/);
    }
    const r = runtime();
    for (const code of ['toString', '__proto__', 'PRIVATE']) {
        assert.equal(r.ApiClient._providerError({ error: { code } }, { endpoint: 'https://api.z.ai/api/paas/v4' }), '');
    }
});

test('coding endpoint failures explain the separate service without changing hosts or impersonating a coding tool', async () => {
    for (const [apiEndpoint, expected] of [
        ['https://api.kimi.com/coding/v1/chat/completions', /Kimi API Platform/],
        ['https://api.z.ai/api/coding/paas/v4/chat/completions', /Coding Plan quota/],
    ]) {
        let calls = 0;
        const r = runtime({ apiEndpoint, apiKey: 'fake-test-key' }, { fetch: async (url, options) => {
            calls++;
            assert.equal(url, apiEndpoint);
            assert.equal(options.headers['User-Agent'], undefined);
            return { ok: false, status: 403, json: async () => ({ error: { message: 'PRIVATE' } }) };
        } });
        await assert.rejects(r.ApiClient.query('Question', ''), expected);
        assert.equal(calls, 1);
    }
});

test('mandatory reasoning requests use their extended deadline and report it correctly', async () => {
    let deadline;
    const r = runtime({ apiEndpoint: 'https://api.moonshot.cn/v1', apiKey: 'fake-test-key', model: 'kimi-k3' }, {
        setTimeout: (callback, ms) => { deadline = ms; queueMicrotask(callback); return 1; },
        clearTimeout: () => {},
        fetch: async (url, options) => new Promise((resolve, reject) => {
            options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
        }),
    });
    await assert.rejects(r.ApiClient.query('Question', ''), /180 seconds/);
    assert.equal(deadline, 180000);
});
