# API compatibility / API 兼容说明

Documentation reviewed: 2026-10-08. Applies to Paper Partner 0.1.4.

The plugin implements **single-turn, non-streaming text Q&A** using four protocols. The table maps official documented routes to these implementations; it is not a claim that every vendor or model has been tested with a live account. Models, regional URLs, quotas, and permissions must match your account.

插件实现了四种协议的**单轮、非流式文本问答**。下表依据官方文档核对接入方式，并不代表逐家、逐模型完成了真实账号测试。模型名称、地域地址、额度和权限需要与你的账号一致。除 OrcaRouter 外，以下服务均选择 `Custom` 并修改接口、Key 和模型；默认 DeepSeek 配置只是保留旧设置，不保证旧模型别名一直有效。

## Provider routes / 厂商接入表

Settings normally need only your key, endpoint, and model. Protocol, authentication, token parameter, and generation limit overrides are under the collapsed **Advanced** section.

`Automatic` detects `/responses`, `/messages`, and `:generateContent`; other URLs default to Chat Completions. Native Anthropic normally uses `x-api-key` plus `anthropic-version`; Kimi's Messages route uses its documented Bearer token instead. Native Gemini uses `x-goog-api-key`. The Authentication control applies to custom Chat and Responses routes; recognized Kimi/GLM routes choose the required authentication automatically.

| Provider / 厂商 | API Format | Full endpoint / 完整接口示例 | Notes / 注意事项及官方依据 |
| --- | --- | --- | --- |
| OpenAI | Responses or Chat | `https://api.openai.com/v1/responses` or `https://api.openai.com/v1/chat/completions` | Bearer；Chat 自动用 `max_completion_tokens`，Responses 用 `max_output_tokens`、`store: false`。[Responses](https://developers.openai.com/api/reference/python/resources/responses/methods/create)、[reasoning](https://developers.openai.com/api/docs/guides/reasoning?api-mode=chat) |
| Anthropic Claude | Anthropic Messages | `https://api.anthropic.com/v1/messages` | 顶层 `system`、`max_tokens`；仅写回 text 内容块，不写回 thinking。[Messages](https://platform.claude.com/docs/en/api/http/messages/create)、[authentication](https://platform.claude.com/docs/en/manage-claude/authentication) |
| Google Gemini | Gemini generateContent | `https://generativelanguage.googleapis.com/v1beta` | 基础地址必须手动选 Gemini；自动补上 `/models/{model}:generateContent`。也支持完整方法 URL 或 `{model}` 占位符。[Native API](https://ai.google.dev/api/generate-content) |
| Google Gemini compatibility | Chat | `https://generativelanguage.googleapis.com/v1beta/openai/chat/completions` | 使用 Bearer Key，与 Gemini 原生格式二选一。[OpenAI compatibility](https://ai.google.dev/gemini-api/docs/openai) |
| Azure OpenAI | Responses or Chat | `https://YOUR-RESOURCE.openai.azure.com/openai/v1/responses` or `https://YOUR-RESOURCE.openai.azure.com/openai/v1/chat/completions` | Auth 选 `api-key`；Model 填部署名。旧版完整部署 URL 可保留 `api-version` 查询参数；旧模型若不接受现代 token 字段，手动选 `max_tokens`。[Azure Responses](https://learn.microsoft.com/en-us/rest/api/microsoft-foundry/azureopenai/responses) |
| DeepSeek | Chat | `https://api.deepseek.com/v1/chat/completions` | Bearer；配置账号当前可用的聊天模型。推理模型通常需要较高生成预算。[Chat API](https://api-docs.deepseek.com/api/create-chat-completion/) |
| Alibaba Qwen / 阿里百炼 | Chat | `https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions` | 国际地域地址不同。官方 DashScope 地址上，`qwen3` 及后续命名系列发送 `enable_thinking: false`，适配非流式问答；不包括只能流式或需专用多模态协议的模型。[Chat API](https://help.aliyun.com/zh/model-studio/qwen-api-via-openai-chat-completions) |
| Kimi / Moonshot | Chat | `https://api.moonshot.cn/v1/chat/completions` | 国内站；国际站为 `api.moonshot.ai`，Key 与余额不互通。官方基础地址可自动补全，模型差异见下节。[API overview](https://platform.kimi.com/docs/api/overview)、[model parameters](https://platform.kimi.com/docs/api/models-overview) |
| GLM / Z.ai | Chat | 国内 `https://open.bigmodel.cn/api/paas/v4/chat/completions`；全球 `https://api.z.ai/api/paas/v4/chat/completions` | 使用对应平台的 Key、模型和余额；官方基础地址可自动补全。[国内 API](https://docs.bigmodel.cn/api-reference/模型-api/对话补全)、[全球 API](https://docs.z.ai/api-reference/llm/chat-completion) |
| ByteDance Doubao / 火山方舟 | Chat | `https://ark.cn-beijing.volces.com/api/v3/chat/completions` | Model 按服务要求填模型 ID 或推理接入点 ID；只覆盖非流式文本路径。[Official API explorer](https://api.volcengine.com/api-explorer/?action=ChatCompletions&groupName=Chat+API&serviceCode=ark&version=2024-01-01) |
| MiniMax | Anthropic Messages (recommended / 推荐) | `https://api.minimax.io/anthropic/v1/messages` | 使用该兼容接口支持的模型；文本块与思考块分开，推理预算可能不足。也有 Chat 接口 `https://api.minimax.io/v1/chat/completions`，但部分模型将 `<think>` 放在 content 中，可能一起显示；优先用 Messages。[Anthropic compatibility](https://platform.minimax.io/docs/api-reference/text-anthropic-api)、[OpenAI compatibility](https://platform.minimax.io/docs/api-reference/text-openai-api) |
| Baidu Qianfan / 百度千帆 v2 | Chat | `https://qianfan.baidubce.com/v2/chat/completions` | 使用 v2 API Key 与当前模型；需要额外应用身份请求头的专用配置未内置；旧版 access_token 原生接口未支持。[Official SDK example](https://cloud.baidu.com/doc/qianfan-docs/s/Fm9l6ocai) |
| Tencent Hunyuan / 腾讯混元 TokenHub | Chat | `https://tokenhub.tencentcloudmaas.com/v1/chat/completions` | 以控制台所在地域地址为准，国际站地址不同；旧混元平台正在迁移，使用其 Key 时需对应旧地址。[TokenHub protocols](https://intl.cloud.tencent.com/zh/document/product/1300/80632)、[Hunyuan guide](https://intl.cloud.tencent.com/zh/document/product/1300/80695) |
| SiliconFlow / 硅基流动 | Chat | `https://api.siliconflow.cn/v1/chat/completions` | Bearer；Model 要完整 ID，免费与收费模型依目录而定。[Chat API](https://docs.siliconflow.cn/docs/api/chat-completions-post) |
| OpenRouter | Chat | `https://openrouter.ai/api/v1/chat/completions` | Bearer；Model 要包含厂商前缀。插件不设置自动模型回退。[API overview](https://openrouter.ai/docs/api_reference/overview) |
| OrcaRouter | Fixed Chat preset / 固定预设 | `https://api.orcarouter.ai/v1/chat/completions` | 可选且配置隔离；默认 `orcarouter/free`，免费可用性不保证，隐私与费用提示见设置页及 README。[Compatibility](https://docs.orcarouter.ai/native-formats/openai-compat) |
| xAI / Grok | Responses | `https://api.x.ai/v1/responses` | Bearer；仅可见文本，无服务端会话续接。慢推理模型可能超过插件的 60 秒等待上限。[Text generation](https://docs.x.ai/developers/model-capabilities/text/generate-text) |
| Mistral | Chat | `https://api.mistral.ai/v1/chat/completions` | Bearer；普通文本聊天路径。[API reference](https://docs.mistral.ai/api) |
| Groq | Chat | `https://api.groq.com/openai/v1/chat/completions` | Bearer；可手动选择 `max_completion_tokens`，旧 `max_tokens` 已弃用但文档仍接受。[API reference](https://console.groq.com/docs/api-reference) |

## Configuration details / 配置细节

- Use a **full request URL**, not just a host or an SDK base URL. Gemini is the explicit exception above. Query parameters required by a provider are preserved. Do not put keys in URLs.
- For unusual proxy paths, select the API Format explicitly. The plugin does not probe endpoints or send a key to alternative services automatically.
- Chat supports either `max_tokens` or `max_completion_tokens`. Automatic selects the latter on official OpenAI, recognized Azure hosts, and the official Kimi Chat route; other hosts use `max_tokens`. Use Advanced → Token parameter if your gateway or model requires otherwise.
- Native request mappings are `system` / `messages` for Anthropic, `systemInstruction` / `contents` for Gemini, and `instructions` / `input` for Responses. Temperature is omitted on all formats.
- Blank generation limits normally use 300 (Brief) / 1500 (Detailed); recognized thinking models below use 8192 to include reasoning. An explicit limit in Advanced always takes precedence. The plugin accepts 64–32768 but a provider can impose a different limit. Increased budgets may raise charges and latency.
- Truncation, blocked output, refusal, and unsupported tool continuations produce an error instead of being written as a completed answer. Structured thinking blocks and separate reasoning fields are not written to the note. Some Chat-compatible vendors embed reasoning in the ordinary text field; prefer a native route that separates it when available.
- Remote URLs require HTTPS; HTTP is allowed only for localhost. Redirects are rejected and cookies omitted. No automatic retry or paid fallback is configured. Waiting normally stops after 60 seconds; recognized thinking models below allow 180 seconds. Timeouts do not guarantee upstream work or billing has stopped.

## Kimi and GLM

0.1.4 adds automatic handling on the official endpoints above; no extra everyday settings are needed. SDK base URLs such as `https://api.moonshot.cn/v1` and `https://open.bigmodel.cn/api/paas/v4` are completed on the same host for Chat only. Explicit routes, other protocols, and custom proxy hosts are preserved. Official Kimi/GLM routes use Bearer authentication even if a previous Azure configuration selected `api-key`.

| Model / 模型 | Automatic behavior / 自动处理 |
| --- | --- |
| Kimi K2.6 (Chat) | Disable optional thinking for short note answers; omit fixed sampling parameters. |
| Kimi K3 | Keep mandatory thinking, use low effort, reserve 8192 generated tokens by default and allow 180 seconds. Chat, Responses and native Messages use their respective effort fields. |
| Kimi K2.7 Code / Highspeed and older thinking models | Do not send a forbidden thinking-off switch; reserve 8192 tokens and allow 180 seconds. |
| GLM 4.5–4.7, 5, 5.1, 5.2 text series (Chat) | Disable optional thinking for note answers. Older models receive no unsupported thinking switch. |
| GLM 5.3 / Flash / FlashX (Chat) | Keep mandatory thinking, use low effort, reserve 8192 tokens and allow 180 seconds. |

For Kimi K2.6 on Responses/Messages, vendor-default thinking is retained with the larger budget. Explicit generation/token-field overrides are respected. These profiles do not inject vendor parameters into unknown gateways or guess settings for future models. Answers still follow Brief/Detailed length instructions; the larger generation budget includes reasoning and **can increase cost**. If a model still exhausts its budget, choose another model or adjust the limit; there is no automatic retry.

这次通用检查修复了基础地址缺少路径、思考预算过小和超时过短的问题，并合并了连续的 user 消息。Kimi Chat 自动使用当前的 `max_completion_tokens`，GLM 保留其 `max_tokens`。GLM 的 `sensitive`、`network_error`、上下文超限等结束原因现在会显示错误，避免把未完成的回复当作答案。已知厂商错误码会转换成简短的本地提示，不复制可能含隐私的上游错误正文。

**Use standard API access for this plugin.** Kimi Code and Kimi API Platform have separate keys and billing; GLM Coding Plan quota is limited to the vendor's supported tools and environments. Coding-plan endpoint errors now explain this distinction, without redirecting requests to a different service or impersonating another client. See [Kimi platform comparison](https://www.kimi.com/code/docs/), [Kimi API errors](https://platform.kimi.com/docs/api/errors), [GLM plan FAQ](https://docs.bigmodel.cn/cn/coding-plan/faq), and [Z.ai supported tools](https://docs.z.ai/devpack/tool/others).

Model constraints were checked against [Kimi parameters](https://platform.kimi.com/docs/api/models-overview), [Kimi Responses](https://platform.kimi.com/docs/api/responses), [Kimi Messages](https://platform.kimi.com/docs/api/messages), [GLM thinking modes](https://docs.bigmodel.cn/cn/guide/capabilities/thinking-mode), and the API references in the table. Verification uses documented contracts and simulated responses; no live vendor key was used. Without a concrete user error report, this does not establish the cause of every reported failure.

## Privacy and OrcaRouter

Questions and up to 2,000 characters of nearby note context are sent to your chosen provider. The plugin does not upload the full PDF or library. Keys are stored locally in Zotero preferences, not an encrypted vault; keep preference files private.

OrcaRouter is an optional third-party gateway. Select it and enter your own key from the [official website](https://www.orcarouter.ai/); the endpoint is fixed, and its key and model are saved separately from Custom. The initial model is `orcarouter/free`. Check [free model availability](https://docs.orcarouter.ai/routing/free-models), quota, and prices before use. No automatic retry or paid fallback is configured by the plugin; a timeout does not guarantee upstream billing has stopped.

OrcaRouter and its upstream providers process your questions and excerpts. Content logging depends on workspace settings, and upstream policies apply separately; disabling gateway logs is not an end-to-end zero-retention guarantee. Review the [retention documentation](https://docs.orcarouter.ai/operations/zero-data-retention), [privacy policy](https://www.orcarouter.ai/privacy.html), and [terms](https://www.orcarouter.ai/terms.html). Avoid confidential, unpublished, and personal information.

问题及最多 2,000 字符的附近笔记上下文会发送到所选服务商；不上传完整 PDF 或整个文献库。API Key 本地保存于 Zotero 偏好设置，遮蔽输入框不等于加密存储。OrcaRouter 会增加一层数据处理方，请确认其与上游的留存政策、免费额度和收费规则，不要发送敏感内容。

This optional integration is not a security or quality endorsement. The maintainer plans to apply to the OrcaRouter open-source partner program. There is currently no partner attribution or revenue-share tracking; any active revenue-sharing arrangement will be disclosed separately.

## Not implemented / 未实现的范围

Streaming/SSE, tools/function calls, image/audio/video input, PDF upload, embeddings, Realtime, multi-turn provider sessions, custom arbitrary headers/bodies, AWS IAM/SigV4 signing, and OAuth/service-account token refresh are not implemented. Native Bedrock, Vertex AI service-account authentication, old Wenxin access_token APIs, and Tencent Cloud signed native APIs are therefore outside the supported configuration. Prefer the provider's documented API-key-compatible route or a gateway you trust.

不支持流式、工具调用、多模态、整篇 PDF 上传、嵌入和实时接口，也不自动处理云厂商 IAM 签名或 OAuth 刷新。因此不能把“厂商有 OpenAI 兼容入口”理解为该厂商全部接口和全部模型都能用。以上是协议兼容审计，并非模型性能或服务信誉评测。

## Validation and release

Zotero 10 compatibility follows the [official Zotero 10 migration guide](https://www.zotero.org/support/dev/zotero_10_for_developers): manifest maximum `10.0.*`. The local app identifies itself as **10.0.4**. The plugin does not use the removed singular collection-selection, search, or database APIs. Its preference-pane registration now awaits the async result and unregisters the returned ID; request cancellation obtains AbortController from the main window when the bootstrap sandbox does not expose it. The Immediate trigger now correctly uses 0 ms.

Automated checks: `node --check bootstrap.js`, `node --test tests/*.test.cjs`, XML/JSON validation, and XPI contents/CRC checks. Tests cover all four protocol payloads and output parsing, credential isolation, privacy-safe failures, timeouts, settings persistence, and lifecycle registration. Mock and localhost tests do not establish live vendor account access or Gecko's exact runtime behavior.

尚未执行真实 Zotero 安装/回填测试，也未使用真实厂商密钥发送请求。安装本地 `paper-partner-0.1.4.xpi` 后，请用公开测试笔记检查：设置页能打开、原配置仍在、写 `Q:` 后按 Enter 能得到 `A[done]`；切换 OrcaRouter 能看到风险提示且 Key 不串用。推理模型如回复为空，先检查预算及费用再重试。

This is a local build, not a published release. `updates.json` intentionally still describes the existing 0.1.1 release. Before publishing 0.1.4, upload the new XPI and then update the feed's version, download URL, and `10.0.*` bound together. Pointing the feed at an unpublished asset would break automatic updates.
